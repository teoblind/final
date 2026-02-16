import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  getWebhooks,
  createWebhook,
  getWebhook,
  updateWebhook,
  deleteWebhook,
  insertAuditLog
} from '../cache/database.js';
import { WEBHOOK_EVENT_TYPES } from '../services/webhookService.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET / — List webhook configs
router.get('/', async (req, res) => {
  try {
    const webhooks = getWebhooks(req.tenantId);
    res.json({
      webhooks: webhooks.map(wh => ({
        ...wh,
        events: JSON.parse(wh.events_json),
        secret: undefined, // Never expose secret
        events_json: undefined,
      })),
      availableEvents: WEBHOOK_EVENT_TYPES,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — Register webhook
router.post('/', requirePermission('manageSettings'), async (req, res) => {
  try {
    const { url, events } = req.body;
    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'url and events array are required' });
    }

    // Validate URL is HTTPS
    if (!url.startsWith('https://')) {
      return res.status(400).json({ error: 'Webhook URL must use HTTPS' });
    }

    // Validate events
    const invalidEvents = events.filter(e => !WEBHOOK_EVENT_TYPES.includes(e));
    if (invalidEvents.length > 0) {
      return res.status(400).json({ error: `Invalid event types: ${invalidEvents.join(', ')}` });
    }

    const id = uuidv4();
    const secret = crypto.randomBytes(32).toString('hex');

    createWebhook({
      id,
      tenantId: req.tenantId,
      url,
      secret,
      events,
    });

    insertAuditLog({
      tenantId: req.tenantId,
      userId: req.user.id,
      action: 'webhook_created',
      resourceType: 'webhook',
      resourceId: id,
      details: { url, events },
      ipAddress: req.ip,
    });

    // Return secret only on creation
    res.status(201).json({
      id,
      url,
      events,
      secret, // Only shown once!
      status: 'active',
      message: 'Save the secret — it will not be shown again.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /:id — Update webhook
router.put('/:id', requirePermission('manageSettings'), async (req, res) => {
  try {
    const wh = getWebhook(req.params.id);
    if (!wh || wh.tenant_id !== req.tenantId) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    const updates = {};
    if (req.body.url) {
      if (!req.body.url.startsWith('https://')) {
        return res.status(400).json({ error: 'Webhook URL must use HTTPS' });
      }
      updates.url = req.body.url;
    }
    if (req.body.events) updates.events = req.body.events;
    if (req.body.status) updates.status = req.body.status;

    updateWebhook(req.params.id, updates);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id — Remove webhook
router.delete('/:id', requirePermission('manageSettings'), async (req, res) => {
  try {
    const wh = getWebhook(req.params.id);
    if (!wh || wh.tenant_id !== req.tenantId) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    deleteWebhook(req.params.id);

    insertAuditLog({
      tenantId: req.tenantId,
      userId: req.user.id,
      action: 'webhook_deleted',
      resourceType: 'webhook',
      resourceId: req.params.id,
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /test — Send test event
router.post('/test', requirePermission('manageSettings'), async (req, res) => {
  try {
    const { webhookId } = req.body;
    const wh = getWebhook(webhookId);
    if (!wh || wh.tenant_id !== req.tenantId) {
      return res.status(404).json({ error: 'Webhook not found' });
    }

    // Send test payload
    const payload = {
      id: uuidv4(),
      type: 'test',
      timestamp: new Date().toISOString(),
      tenantId: req.tenantId,
      data: { message: 'This is a test webhook delivery from Ampera' },
    };

    const signature = crypto
      .createHmac('sha256', wh.secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(wh.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ampera-Signature': `sha256=${signature}`,
          'X-Ampera-Event': 'test',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      res.json({
        success: response.ok,
        statusCode: response.status,
        message: response.ok ? 'Test webhook delivered successfully' : `Delivery failed with status ${response.status}`,
      });
    } catch (fetchErr) {
      res.json({
        success: false,
        message: `Delivery failed: ${fetchErr.message}`,
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
