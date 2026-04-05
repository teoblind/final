/**
 * User Inbox Monitoring Routes
 *
 * GET    /api/v1/user-inbox/config      - Get inbox monitoring config
 * PUT    /api/v1/user-inbox/config      - Update inbox monitoring config
 * GET    /api/v1/user-inbox/status      - Get polling status
 * POST   /api/v1/user-inbox/disconnect  - Remove personal email tokens
 * GET    /api/v1/user-inbox/recent      - Get recently processed emails
 * GET    /api/v1/user-inbox/stats       - Get ingestion statistics
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getUserInboxConfig,
  upsertUserInboxConfig,
  getUserInboxStats,
  getKeyVaultValue,
  getKeyVaultEntries,
  deleteKeyVaultEntry,
  getTenantDb,
  getDefaultTenantId,
} from '../cache/database.js';
import db from '../cache/database.js';

const router = express.Router();

// All user inbox routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveIds(req) {
  const tenantId = req.tenantId || req.resolvedTenant?.id || getDefaultTenantId();
  const userId = req.user.id;
  return { tenantId, userId };
}

// ---------------------------------------------------------------------------
// GET /config - Get the user's inbox monitoring config
// ---------------------------------------------------------------------------
router.get('/config', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);

    // Get config from tenant DB (including disabled configs)
    const tdb = getTenantDb(tenantId);
    let config = tdb.prepare('SELECT * FROM user_inbox_config WHERE tenant_id = ?').get(tenantId) || null;

    // Check if personal email is connected via key vault
    let personalEmail = null;
    try {
      personalEmail = getKeyVaultValue(tenantId, 'google-gmail-user', 'email');
    } catch (e) {
      // Key vault entry may not exist
    }

    if (!config) {
      // Return a sensible default
      config = {
        enabled: false,
        ingest_mode: 'review',
        max_age_days: 7,
        auto_approve_senders: null,
        auto_skip_senders: null,
        poll_interval_minutes: 5,
        last_polled_at: null,
      };
    }

    res.json({ config, personalEmail });
  } catch (err) {
    console.error('[UserInbox] GET /config error:', err);
    res.status(500).json({ error: 'Failed to fetch inbox config' });
  }
});

// ---------------------------------------------------------------------------
// PUT /config - Update inbox monitoring config
// ---------------------------------------------------------------------------
router.put('/config', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { enabled, ingestMode, maxAgeDays, autoApproveSenders, autoSkipSenders } = req.body;

    // Get existing config to preserve fields not being updated
    const tdb = getTenantDb(tenantId);
    const existing = tdb.prepare('SELECT * FROM user_inbox_config WHERE tenant_id = ?').get(tenantId);

    // Need a user_email for the upsert - pull from key vault or existing config
    let userEmail = existing?.user_email;
    if (!userEmail) {
      try {
        userEmail = getKeyVaultValue(tenantId, 'google-gmail-user', 'email');
      } catch (e) {
        // Ignore
      }
    }
    if (!userEmail) {
      return res.status(400).json({ error: 'No personal email connected. Connect your email first.' });
    }

    const updated = upsertUserInboxConfig(tenantId, {
      id: existing?.id,
      user_email: userEmail,
      enabled: enabled !== undefined ? enabled : (existing?.enabled ?? true),
      ingestMode: ingestMode || existing?.ingest_mode || 'review',
      maxAgeDays: maxAgeDays || existing?.max_age_days || 7,
      autoApproveSenders: autoApproveSenders !== undefined ? autoApproveSenders : (existing?.auto_approve_senders || null),
      autoSkipSenders: autoSkipSenders !== undefined ? autoSkipSenders : (existing?.auto_skip_senders || null),
      last_polled_at: existing?.last_polled_at || null,
      last_history_id: existing?.last_history_id || null,
    });

    res.json({ config: updated });
  } catch (err) {
    console.error('[UserInbox] PUT /config error:', err);
    res.status(500).json({ error: 'Failed to update inbox config' });
  }
});

// ---------------------------------------------------------------------------
// GET /status - Get polling status
// ---------------------------------------------------------------------------
router.get('/status', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);

    const config = getUserInboxConfig(tenantId);
    const stats = getUserInboxStats(tenantId);

    let personalEmail = null;
    try {
      personalEmail = getKeyVaultValue(tenantId, 'google-gmail-user', 'email');
    } catch (e) {
      // Key vault entry may not exist
    }

    res.json({
      connectedEmail: personalEmail,
      enabled: config?.enabled === 1,
      lastPolledAt: config?.last_polled_at || null,
      totalIngested: stats.total,
    });
  } catch (err) {
    console.error('[UserInbox] GET /status error:', err);
    res.status(500).json({ error: 'Failed to fetch inbox status' });
  }
});

// ---------------------------------------------------------------------------
// POST /disconnect - Remove personal email tokens and disable config
// ---------------------------------------------------------------------------
router.post('/disconnect', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);

    // Find and delete all key vault entries for google-gmail-user
    const entries = getKeyVaultEntries(tenantId);
    const userEntries = entries.filter(e => e.service === 'google-gmail-user');
    for (const entry of userEntries) {
      deleteKeyVaultEntry(entry.id, tenantId);
    }

    // Also delete from tenant DB key vault if it exists there
    try {
      const tdb = getTenantDb(tenantId);
      tdb.prepare('DELETE FROM key_vault WHERE tenant_id = ? AND service = ?').run(tenantId, 'google-gmail-user');
    } catch (e) {
      // Tenant DB may not have key_vault table
    }

    // Disable the inbox config
    try {
      const tdb = getTenantDb(tenantId);
      tdb.prepare('UPDATE user_inbox_config SET enabled = 0, updated_at = datetime(\'now\') WHERE tenant_id = ?').run(tenantId);
    } catch (e) {
      // Config may not exist yet
    }

    res.json({ success: true, message: 'Personal email disconnected and inbox monitoring disabled' });
  } catch (err) {
    console.error('[UserInbox] POST /disconnect error:', err);
    res.status(500).json({ error: 'Failed to disconnect personal email' });
  }
});

// ---------------------------------------------------------------------------
// GET /recent - Get recently processed emails
// ---------------------------------------------------------------------------
router.get('/recent', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const tdb = getTenantDb(tenantId);
    const rows = tdb.prepare(`
      SELECT * FROM user_inbox_processed
      WHERE tenant_id = ?
      ORDER BY ingested_at DESC
      LIMIT ? OFFSET ?
    `).all(tenantId, limit, offset);

    const total = tdb.prepare('SELECT COUNT(*) as c FROM user_inbox_processed WHERE tenant_id = ?').get(tenantId).c;

    res.json({ rows, total, limit, offset });
  } catch (err) {
    console.error('[UserInbox] GET /recent error:', err);
    res.status(500).json({ error: 'Failed to fetch recent inbox emails' });
  }
});

// ---------------------------------------------------------------------------
// GET /stats - Get ingestion statistics
// ---------------------------------------------------------------------------
router.get('/stats', async (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const stats = getUserInboxStats(tenantId);
    res.json(stats);
  } catch (err) {
    console.error('[UserInbox] GET /stats error:', err);
    res.status(500).json({ error: 'Failed to fetch inbox stats' });
  }
});

export default router;
