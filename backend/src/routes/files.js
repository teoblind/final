/**
 * Files Routes — Tenant file browser with Google Drive links
 *
 * GET    /api/v1/files            — List files (with category/search filters)
 * GET    /api/v1/files/categories — Get category list with counts
 * POST   /api/v1/files/upload     — Upload file to Google Drive
 * POST   /api/v1/files/sync-drive — Trigger Drive auto-scan
 * GET    /api/v1/files/sync-status — Get sync progress
 */

import express from 'express';
import multer from 'multer';
import { google } from 'googleapis';
import { Readable } from 'stream';
import { authenticate } from '../middleware/auth.js';
import { getTenantFiles, getTenantFileCategories, getTenantFileCount, getTenantEmailConfig, getKeyVaultValue, getDriveSyncStatus, getDriveSyncedFiles, getDriveSyncedFileCount } from '../cache/database.js';
import { runWithTenant } from '../cache/database.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = express.Router();

// All file routes require authentication
router.use(authenticate);

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;

const MIME_TO_TYPE = {
  'application/vnd.google-apps.document': 'doc',
  'application/vnd.google-apps.spreadsheet': 'sheet',
  'application/vnd.google-apps.presentation': 'slides',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
};

const MIME_TO_CATEGORY = {
  'application/vnd.google-apps.document': 'Documents',
  'application/vnd.google-apps.spreadsheet': 'Spreadsheets',
  'application/vnd.google-apps.presentation': 'Presentations',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Documents',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Spreadsheets',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'Presentations',
  'application/pdf': 'PDFs',
  'text/csv': 'Spreadsheets',
};

function resolveIds(req) {
  const tenantId = req.resolvedTenant?.id || 'default';
  return { tenantId };
}

function makeDriveClient(refreshToken) {
  if (!CLIENT_ID || !CLIENT_SECRET || !refreshToken) return null;
  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, 'http://localhost:8099');
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: client });
}

async function fetchDriveFiles(tenantId, { search, limit } = {}) {
  // Try key vault first (onboarding wizard stores here), then email config
  let refreshToken = getKeyVaultValue(tenantId, 'google-docs', 'refresh_token');
  if (!refreshToken) {
    const emailConfig = getTenantEmailConfig(tenantId);
    refreshToken = emailConfig?.gmailRefreshToken || emailConfig?.gmail_refresh_token;
  }
  if (!refreshToken) {
    console.log(`[Files] No refresh token for ${tenantId}`);
    return null;
  }

  const drive = makeDriveClient(refreshToken);
  if (!drive) return null;

  const pageSize = Math.min(limit || 50, 100);
  let q = 'trashed = false';
  // Exclude Google Apps folders
  q += " and mimeType != 'application/vnd.google-apps.folder'";
  if (search) {
    q += ` and name contains '${search.replace(/'/g, "\\'")}'`;
  }

  const res = await drive.files.list({
    q,
    pageSize,
    fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink)',
    orderBy: 'modifiedTime desc',
  });

  const files = (res.data.files || []).map(f => ({
    name: f.name,
    file_type: MIME_TO_TYPE[f.mimeType] || 'other',
    category: MIME_TO_CATEGORY[f.mimeType] || 'Other',
    modified_at: f.modifiedTime,
    size_bytes: f.size ? parseInt(f.size) : 0,
    drive_file_id: f.id,
    drive_url: f.webViewLink,
  }));

  // Build categories
  const catCounts = {};
  for (const f of files) {
    catCounts[f.category] = (catCounts[f.category] || 0) + 1;
  }
  const categories = Object.entries(catCounts)
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return { files, categories, total: files.length };
}

router.get('/', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { category, search, limit } = req.query;

    // Wrap in runWithTenant to ensure key vault has correct DB context
    const result = await runWithTenant(tenantId, async () => {
      // Try cached files first
      const files = getTenantFiles(tenantId, {
        category: category || undefined,
        search: search || undefined,
        limit: limit ? parseInt(limit) : 100,
      });

      if (files && files.length > 0) {
        const categories = getTenantFileCategories(tenantId);
        const total = getTenantFileCount(tenantId);
        return { files, categories, total };
      }

      // No cached files - fetch live from Google Drive
      const driveResult = await fetchDriveFiles(tenantId, { search, limit: limit ? parseInt(limit) : 100 });
      if (driveResult && driveResult.files.length > 0) {
        let filteredFiles = driveResult.files;
        if (category) {
          filteredFiles = filteredFiles.filter(f => f.category === category);
        }
        return { files: filteredFiles, categories: driveResult.categories, total: driveResult.total, live: true };
      }

      return { files: [], categories: [], total: 0 };
    });

    res.json(result);
  } catch (err) {
    console.error('[Files] List error:', err.message);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

router.get('/categories', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const categories = getTenantFileCategories(tenantId);
    res.json({ categories });
  } catch (err) {
    console.error('Files categories error:', err);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

/**
 * POST /upload — Upload a file to the tenant's Google Drive
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    let refreshToken = getKeyVaultValue(tenantId, 'google-docs', 'refresh_token');
    if (!refreshToken) {
      const emailConfig = getTenantEmailConfig(tenantId);
      refreshToken = emailConfig?.gmail_refresh_token;
    }
    if (!refreshToken) return res.status(400).json({ error: 'Google Drive not connected for this tenant' });

    const drive = makeDriveClient(refreshToken);
    if (!drive) return res.status(500).json({ error: 'Failed to create Drive client' });

    const folder = req.body.folder || null;
    let folderId = null;

    // If a folder name is specified, find or create it
    if (folder) {
      const folderRes = await drive.files.list({
        q: `name = '${folder.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id)',
        pageSize: 1,
      });
      if (folderRes.data.files?.length > 0) {
        folderId = folderRes.data.files[0].id;
      } else {
        const created = await drive.files.create({
          requestBody: { name: folder, mimeType: 'application/vnd.google-apps.folder' },
          fields: 'id',
        });
        folderId = created.data.id;
      }
    }

    const fileMetadata = { name: req.file.originalname };
    if (folderId) fileMetadata.parents = [folderId];

    const media = {
      mimeType: req.file.mimetype,
      body: Readable.from(req.file.buffer),
    };

    const uploaded = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id, name, mimeType, modifiedTime, size, webViewLink',
    });

    const f = uploaded.data;
    res.json({
      name: f.name,
      file_type: MIME_TO_TYPE[f.mimeType] || 'other',
      category: MIME_TO_CATEGORY[f.mimeType] || 'Other',
      modified_at: f.modifiedTime,
      size_bytes: f.size ? parseInt(f.size) : 0,
      drive_file_id: f.id,
      drive_url: f.webViewLink,
    });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

/**
 * POST /sync-drive — Trigger a full Drive sync (runs in background)
 */
router.post('/sync-drive', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);

    // Check if sync is already running
    const status = getDriveSyncStatus(tenantId);
    if (status?.status === 'running') {
      // Check if it's been running for more than 30 min (stale)
      const startedAt = new Date(status.started_at).getTime();
      if (Date.now() - startedAt < 30 * 60 * 1000) {
        return res.json({ status: 'already_running', ...status });
      }
    }

    // Fire and forget — sync runs in background with tenant context
    const { syncDrive } = await import('../services/driveSync.js');
    runWithTenant(tenantId, () => syncDrive(tenantId)).catch(err => {
      console.error(`[DriveSync] Background sync failed for ${tenantId}:`, err.message);
    });

    res.json({ status: 'started', message: 'Drive sync initiated' });
  } catch (err) {
    console.error('Sync drive error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /sync-status — Get current Drive sync status
 */
router.get('/sync-status', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const status = getDriveSyncStatus(tenantId);
    res.json({ syncStatus: status || { status: 'never', last_successful_sync: null } });
  } catch (err) {
    res.json({ syncStatus: { status: 'never', last_successful_sync: null } });
  }
});

/**
 * GET /drive-files — List all synced Drive files
 */
router.get('/drive-files', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { search, limit } = req.query;
    const files = getDriveSyncedFiles(tenantId, { search, limit: parseInt(limit) || 200 });
    const count = getDriveSyncedFileCount(tenantId);
    res.json({ files, total: count });
  } catch (err) {
    res.json({ files: [], total: 0 });
  }
});

export default router;
