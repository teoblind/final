/**
 * Files Routes — Tenant file browser with Google Drive links
 *
 * GET /api/v1/files           — List files (with category/search filters)
 * GET /api/v1/files/categories — Get category list with counts
 */

import express from 'express';
import { google } from 'googleapis';
import { getTenantFiles, getTenantFileCategories, getTenantFileCount, getTenantEmailConfig, getKeyVaultValue } from '../cache/database.js';

const router = express.Router();

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
    refreshToken = emailConfig?.gmail_refresh_token;
  }
  if (!refreshToken) return null;

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

    // Try cached files first
    const files = getTenantFiles(tenantId, {
      category: category || undefined,
      search: search || undefined,
      limit: limit ? parseInt(limit) : 100,
    });

    if (files && files.length > 0) {
      const categories = getTenantFileCategories(tenantId);
      const total = getTenantFileCount(tenantId);
      return res.json({ files, categories, total });
    }

    // No cached files — try live Google Drive fetch
    const driveResult = await fetchDriveFiles(tenantId, { search, limit: limit ? parseInt(limit) : 50 });
    if (driveResult && driveResult.files.length > 0) {
      let filteredFiles = driveResult.files;
      if (category) {
        filteredFiles = filteredFiles.filter(f => f.category === category);
      }
      return res.json({ files: filteredFiles, categories: driveResult.categories, total: driveResult.total, live: true });
    }

    // Nothing available
    res.json({ files: [], categories: [], total: 0 });
  } catch (err) {
    console.error('Files list error:', err);
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

export default router;
