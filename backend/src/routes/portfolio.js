/**
 * Portfolio Routes - Portfolio companies management for Zhan Capital
 *
 * GET    /api/v1/portfolio/companies          - List all portfolio companies
 * GET    /api/v1/portfolio/companies/:id       - Get single company with accounts + stats
 * POST   /api/v1/portfolio/companies           - Create a new portfolio company
 * PUT    /api/v1/portfolio/companies/:id       - Update a portfolio company
 * POST   /api/v1/portfolio/companies/:id/connect-gmail  - Connect Gmail account
 * POST   /api/v1/portfolio/companies/:id/connect-drive  - Connect Drive folder
 * GET    /api/v1/portfolio/companies/:id/emails - Fetch recent emails from Gmail
 * GET    /api/v1/portfolio/companies/:id/files  - List files from Drive folder
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';
import { google } from 'googleapis';
import {
  getPortfolioCompanies,
  getPortfolioCompany,
  createPortfolioCompany,
  updatePortfolioCompany,
  getCompanyEmailAccounts,
  addCompanyEmailAccount,
  updateCompanyEmailAccountToken,
  getCompanyDriveFolders,
  addCompanyDriveFolder,
  getCompanyEmailStats,
  upsertCompanyEmailStats,
} from '../cache/database.js';

const router = express.Router();
router.use(authenticate);

function getClientId() { return process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID; }
function getClientSecret() { return process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET; }

function makeGmailClient(refreshToken) {
  if (!getClientId() || !getClientSecret() || !refreshToken) return null;
  const client = new google.auth.OAuth2(getClientId(), getClientSecret(), 'http://localhost:8099');
  client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: client });
}

function makeDriveClient(refreshToken) {
  if (!getClientId() || !getClientSecret() || !refreshToken) return null;
  const client = new google.auth.OAuth2(getClientId(), getClientSecret(), 'http://localhost:8099');
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: client });
}

// ─── GET /companies - List all portfolio companies ───────────────────────────

router.get('/companies', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const companies = getPortfolioCompanies(tenantId);

    // Enrich with email account count and drive folder count
    const enriched = companies.map(c => {
      const emailAccounts = getCompanyEmailAccounts(c.id, tenantId);
      const driveFolders = getCompanyDriveFolders(c.id, tenantId);
      const stats = getCompanyEmailStats(c.id, tenantId, 7);
      const totalSent = stats.reduce((sum, s) => sum + s.sent_count, 0);
      const totalReceived = stats.reduce((sum, s) => sum + s.received_count, 0);
      return {
        ...c,
        email_accounts: emailAccounts.length,
        drive_folders: driveFolders.length,
        emails_sent_7d: totalSent,
        emails_received_7d: totalReceived,
      };
    });

    res.json({ companies: enriched });
  } catch (error) {
    console.error('Portfolio GET error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /companies/:id - Single company with full details ───────────────────

router.get('/companies/:id', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const company = getPortfolioCompany(req.params.id, tenantId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const emailAccounts = getCompanyEmailAccounts(company.id, tenantId);
    const driveFolders = getCompanyDriveFolders(company.id, tenantId);
    const stats = getCompanyEmailStats(company.id, tenantId, 30);

    res.json({
      company: {
        ...company,
        email_accounts: emailAccounts,
        drive_folders: driveFolders,
        email_stats: stats,
      },
    });
  } catch (error) {
    console.error('Portfolio company GET error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /companies - Create a new portfolio company ────────────────────────

router.post('/companies', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { name, type, status, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const id = `pc-${uuidv4().slice(0, 8)}`;
    createPortfolioCompany({ id, name, type, status, description, tenantId });

    const company = getPortfolioCompany(id, tenantId);
    res.status(201).json({ company });
  } catch (error) {
    console.error('Portfolio company POST error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /companies/:id - Update a portfolio company ─────────────────────────

router.put('/companies/:id', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const company = getPortfolioCompany(req.params.id, tenantId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { name, type, status, description } = req.body;
    updatePortfolioCompany(req.params.id, { name, type, status, description }, tenantId);

    const updated = getPortfolioCompany(req.params.id, tenantId);
    res.json({ company: updated });
  } catch (error) {
    console.error('Portfolio company PUT error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /companies/:id/connect-gmail - Store Gmail OAuth token ─────────────

router.post('/companies/:id/connect-gmail', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const company = getPortfolioCompany(req.params.id, tenantId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { gmail_address, refresh_token } = req.body;
    if (!gmail_address) {
      return res.status(400).json({ error: 'gmail_address is required' });
    }

    // Check if this email is already connected
    const existing = getCompanyEmailAccounts(company.id, tenantId);
    const match = existing.find(a => a.gmail_address === gmail_address);

    if (match && refresh_token) {
      // Update existing
      updateCompanyEmailAccountToken(match.id, refresh_token, tenantId);
      res.json({ success: true, action: 'updated', id: match.id });
    } else if (!match) {
      // Create new
      const id = `cea-${uuidv4().slice(0, 8)}`;
      addCompanyEmailAccount({
        id,
        companyId: company.id,
        gmailAddress: gmail_address,
        oauthRefreshToken: refresh_token || null,
        tenantId,
      });
      res.status(201).json({ success: true, action: 'created', id });
    } else {
      res.json({ success: true, action: 'already_connected', id: match.id });
    }
  } catch (error) {
    console.error('Connect Gmail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /companies/:id/email-accounts/:accountId - Remove email account ──

router.delete('/companies/:id/email-accounts/:accountId', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const company = getPortfolioCompany(req.params.id, tenantId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const { getTenantDb } = await import('../cache/database.js');
    const db = getTenantDb(tenantId);
    db.prepare('DELETE FROM company_email_accounts WHERE id = ? AND company_id = ? AND tenant_id = ?')
      .run(req.params.accountId, company.id, tenantId);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete email account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /companies/:id/connect-drive - Store Drive folder ──────────────────

router.post('/companies/:id/connect-drive', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const company = getPortfolioCompany(req.params.id, tenantId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { folder_id, folder_name, folder_url } = req.body;
    if (!folder_id) {
      return res.status(400).json({ error: 'folder_id is required' });
    }

    const id = `cdf-${uuidv4().slice(0, 8)}`;
    addCompanyDriveFolder({
      id,
      companyId: company.id,
      folderId: folder_id,
      folderName: folder_name || null,
      folderUrl: folder_url || null,
      tenantId,
    });

    res.status(201).json({ success: true, id });
  } catch (error) {
    console.error('Connect Drive error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /companies/:id/emails - Fetch recent emails from connected Gmail ────

router.get('/companies/:id/emails', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const company = getPortfolioCompany(req.params.id, tenantId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const accounts = getCompanyEmailAccounts(company.id, tenantId);
    const activeAccounts = accounts.filter(a => a.is_active && a.oauth_refresh_token);

    if (activeAccounts.length === 0) {
      return res.json({ emails: [], message: 'No connected Gmail accounts' });
    }

    const allEmails = [];
    const maxResults = Math.min(parseInt(req.query.limit) || 20, 50);

    for (const account of activeAccounts) {
      const gmail = makeGmailClient(account.oauth_refresh_token);
      if (!gmail) continue;

      try {
        const listRes = await gmail.users.messages.list({
          userId: 'me',
          q: 'newer_than:7d',
          maxResults,
        });

        const messages = listRes.data.messages || [];

        for (const msg of messages.slice(0, maxResults)) {
          try {
            const full = await gmail.users.messages.get({
              userId: 'me',
              id: msg.id,
              format: 'metadata',
              metadataHeaders: ['From', 'To', 'Subject', 'Date'],
            });

            const headers = full.data.payload?.headers || [];
            const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

            allEmails.push({
              id: msg.id,
              account: account.gmail_address,
              from: getHeader('From'),
              to: getHeader('To'),
              subject: getHeader('Subject'),
              date: getHeader('Date'),
              snippet: full.data.snippet || '',
              labelIds: full.data.labelIds || [],
            });
          } catch (msgErr) {
            // Skip individual message errors
          }
        }
      } catch (gmailErr) {
        console.warn(`Portfolio email fetch failed for ${account.gmail_address}:`, gmailErr.message);
      }
    }

    // Sort by date descending
    allEmails.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({ emails: allEmails.slice(0, maxResults) });
  } catch (error) {
    console.error('Portfolio emails GET error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /companies/:id/files - List files from connected Drive folders ──────

router.get('/companies/:id/files', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const company = getPortfolioCompany(req.params.id, tenantId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const folders = getCompanyDriveFolders(company.id, tenantId);
    if (folders.length === 0) {
      return res.json({ files: [], message: 'No connected Drive folders' });
    }

    // For Drive API, we need a refresh token. Use the first connected email account.
    const accounts = getCompanyEmailAccounts(company.id, tenantId);
    const activeAccount = accounts.find(a => a.is_active && a.oauth_refresh_token);

    if (!activeAccount) {
      return res.json({ files: [], message: 'No OAuth token available for Drive access' });
    }

    const drive = makeDriveClient(activeAccount.oauth_refresh_token);
    if (!drive) {
      return res.json({ files: [], message: 'Drive client configuration error' });
    }

    const allFiles = [];
    const maxResults = Math.min(parseInt(req.query.limit) || 20, 50);

    for (const folder of folders) {
      try {
        const listRes = await drive.files.list({
          q: `'${folder.folder_id}' in parents and trashed = false`,
          pageSize: maxResults,
          fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink, iconLink)',
          orderBy: 'modifiedTime desc',
        });

        const files = listRes.data.files || [];
        for (const file of files) {
          allFiles.push({
            ...file,
            folderName: folder.folder_name,
            folderId: folder.folder_id,
          });
        }
      } catch (driveErr) {
        console.warn(`Portfolio Drive list failed for folder ${folder.folder_id}:`, driveErr.message);
      }
    }

    res.json({ files: allFiles.slice(0, maxResults) });
  } catch (error) {
    console.error('Portfolio files GET error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
