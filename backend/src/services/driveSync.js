/**
 * Drive Sync Service - Crawls tenant's Google Drive, extracts text, stores for RAG
 *
 * Uses the tenant agent's OAuth token to list all accessible files,
 * export text from Google Docs/Sheets/Slides, and store in SQLite
 * with FTS5 indexing for fast search during chat.
 */

import { google } from 'googleapis';
import {
  getKeyVaultValue,
  getTenantEmailConfig,
  upsertDriveSyncStatus,
  upsertDriveSyncedFile,
  upsertDriveFtsEntry,
  upsertTenantFile,
  getDriveSyncStatus,
} from '../cache/database.js';

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;

const MIME_TO_TYPE = {
  'application/vnd.google-apps.document': 'doc',
  'application/vnd.google-apps.spreadsheet': 'sheet',
  'application/vnd.google-apps.presentation': 'slides',
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'text/plain': 'txt',
};

const MIME_TO_CATEGORY = {
  'application/vnd.google-apps.document': 'Documents',
  'application/vnd.google-apps.spreadsheet': 'Spreadsheets',
  'application/vnd.google-apps.presentation': 'Presentations',
  'application/pdf': 'PDFs',
  'text/csv': 'Spreadsheets',
  'text/plain': 'Documents',
  'application/vnd.google-apps.folder': 'Folders',
};

// MIME types we can extract text from
const EXTRACTABLE_MIMES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
]);

const MAX_CONTENT_CHARS = 50000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function makeDriveClient(refreshToken) {
  if (!CLIENT_ID || !CLIENT_SECRET || !refreshToken) return null;
  const client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, 'http://localhost:8099');
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: client });
}

function getRefreshToken(tenantId) {
  let token = getKeyVaultValue(tenantId, 'google-docs', 'refresh_token');
  if (!token) {
    const emailConfig = getTenantEmailConfig(tenantId);
    token = emailConfig?.gmailRefreshToken || emailConfig?.gmail_refresh_token;
  }
  return token;
}

/**
 * Crawl all files accessible to the tenant's agent account.
 */
async function crawlAllFiles(drive) {
  const allFiles = [];
  let pageToken = null;

  do {
    const res = await drive.files.list({
      q: "trashed = false AND mimeType != 'application/vnd.google-apps.folder'",
      pageSize: 100,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink, parents)',
      pageToken: pageToken || undefined,
    });
    allFiles.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
    if (pageToken) await sleep(100);
  } while (pageToken);

  return allFiles;
}

/**
 * Resolve folder names for parent IDs (batch lookup).
 */
async function resolveFolderNames(drive, files) {
  const parentIds = new Set();
  for (const f of files) {
    if (f.parents?.length) parentIds.add(f.parents[0]);
  }

  const folderMap = {};
  for (const pid of parentIds) {
    try {
      const res = await drive.files.get({ fileId: pid, fields: 'name' });
      folderMap[pid] = res.data.name;
      await sleep(50);
    } catch {
      folderMap[pid] = null;
    }
  }
  return folderMap;
}

/**
 * Extract text content from a file.
 */
async function extractContent(drive, file) {
  const mime = file.mimeType;

  try {
    if (mime === 'application/vnd.google-apps.document') {
      const res = await drive.files.export({ fileId: file.id, mimeType: 'text/plain' });
      return typeof res.data === 'string' ? res.data.substring(0, MAX_CONTENT_CHARS) : '';
    }
    if (mime === 'application/vnd.google-apps.spreadsheet') {
      const res = await drive.files.export({ fileId: file.id, mimeType: 'text/csv' });
      return typeof res.data === 'string' ? res.data.substring(0, MAX_CONTENT_CHARS) : '';
    }
    if (mime === 'application/vnd.google-apps.presentation') {
      const res = await drive.files.export({ fileId: file.id, mimeType: 'text/plain' });
      return typeof res.data === 'string' ? res.data.substring(0, MAX_CONTENT_CHARS) : '';
    }
    if (mime === 'text/plain' || mime === 'text/csv' || mime === 'text/markdown') {
      const res = await drive.files.get({ fileId: file.id, alt: 'media' });
      return typeof res.data === 'string' ? res.data.substring(0, MAX_CONTENT_CHARS) : '';
    }
  } catch (err) {
    console.warn(`[DriveSync] Failed to extract content from ${file.name}: ${err.message}`);
    return null;
  }

  return null;
}

/**
 * Run a full Drive sync for a tenant.
 */
export async function syncDrive(tenantId) {
  const refreshToken = getRefreshToken(tenantId);
  if (!refreshToken) throw new Error('No Google OAuth token configured for this tenant');

  const drive = makeDriveClient(refreshToken);
  if (!drive) throw new Error('Failed to create Drive client');

  console.log(`[DriveSync] Starting sync for tenant ${tenantId}`);

  upsertDriveSyncStatus(tenantId, {
    status: 'running',
    started_at: new Date().toISOString(),
    files_found: 0,
    files_indexed: 0,
    error_message: null,
  });

  try {
    // 1. Crawl all files
    const files = await crawlAllFiles(drive);
    console.log(`[DriveSync] Found ${files.length} files for tenant ${tenantId}`);

    upsertDriveSyncStatus(tenantId, { files_found: files.length });

    // 2. Resolve folder names
    const folderMap = await resolveFolderNames(drive, files);

    // 3. Process each file
    let indexed = 0;
    for (const file of files) {
      const isExtractable = EXTRACTABLE_MIMES.has(file.mimeType);
      let contentText = null;
      let hasContent = false;

      if (isExtractable) {
        contentText = await extractContent(drive, file);
        hasContent = !!contentText && contentText.length > 0;
        if (hasContent) indexed++;
        await sleep(200); // Rate limit
      }

      const parentName = file.parents?.length ? folderMap[file.parents[0]] || null : null;

      // Save to drive_synced_files
      upsertDriveSyncedFile({
        id: file.id,
        tenantId,
        name: file.name,
        mimeType: file.mimeType,
        category: MIME_TO_CATEGORY[file.mimeType] || 'Other',
        fileType: MIME_TO_TYPE[file.mimeType] || 'other',
        sizeBytes: parseInt(file.size || 0),
        modifiedTime: file.modifiedTime,
        driveUrl: file.webViewLink,
        parentFolderName: parentName,
        hasContent,
        contentLength: contentText?.length || 0,
        contentText: contentText || null,
      });

      // Populate FTS5 index for RAG search
      if (hasContent && contentText) {
        try { upsertDriveFtsEntry(file.id, tenantId, file.name, contentText); } catch (e) {}
      }

      // Also upsert into tenant_files for backward compatibility
      upsertTenantFile({
        id: file.id,
        tenant_id: tenantId,
        name: file.name,
        category: MIME_TO_CATEGORY[file.mimeType] || 'Other',
        file_type: MIME_TO_TYPE[file.mimeType] || 'other',
        size_bytes: parseInt(file.size || 0),
        modified_at: file.modifiedTime,
        drive_file_id: file.id,
        drive_url: file.webViewLink,
      });

      // Update progress every 10 files
      if (indexed % 10 === 0) {
        upsertDriveSyncStatus(tenantId, { files_indexed: indexed });
      }
    }

    upsertDriveSyncStatus(tenantId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      files_indexed: indexed,
      last_successful_sync: new Date().toISOString(),
    });

    console.log(`[DriveSync] Completed for tenant ${tenantId}: ${files.length} files, ${indexed} indexed`);
    return { fileCount: files.length, indexedCount: indexed };
  } catch (err) {
    console.error(`[DriveSync] Failed for tenant ${tenantId}:`, err.message);
    upsertDriveSyncStatus(tenantId, {
      status: 'failed',
      error_message: err.message,
      completed_at: new Date().toISOString(),
    });
    throw err;
  }
}
