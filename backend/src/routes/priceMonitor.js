/**
 * Price Monitor Routes
 *
 * Alert rules CRUD, current prices, history.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getEnergyPrices,
  getPriceAlertRulesForTenant,
  createPriceAlertRule,
  updatePriceAlertRule,
  deletePriceAlertRule,
  getActivities,
} from '../cache/database.js';
import { getLatestPrices } from '../jobs/priceMonitorJob.js';

const router = Router();

router.use(authenticate);

// ─── GET /current - Live prices for monitored nodes ──────────────────────────

router.get('/current', (req, res) => {
  try {
    const prices = getLatestPrices();
    res.json({ prices: Object.values(prices), timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Get current prices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /history - Recent price history ─────────────────────────────────────

router.get('/history', (req, res) => {
  try {
    const { iso = 'ERCOT', node = 'HB_NORTH', hours = 24, marketType = 'realtime' } = req.query;
    const endDate = new Date().toISOString();
    const startDate = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000).toISOString();

    const prices = getEnergyPrices(iso, node, startDate, endDate, marketType);
    res.json({ prices, iso, node, hours: parseInt(hours) });
  } catch (error) {
    console.error('Get price history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /alerts - List alert rules ──────────────────────────────────────────

router.get('/alerts', (req, res) => {
  try {
    const rules = getPriceAlertRulesForTenant(req.user.tenantId);
    res.json({ rules });
  } catch (error) {
    console.error('Get alert rules error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /alerts - Create alert rule ────────────────────────────────────────

router.post('/alerts', (req, res) => {
  try {
    const { iso, node, direction, threshold, cooldownMinutes = 30, notifyWebsocket = true, notifyEmail = false, triggerCurtailment = false } = req.body;

    if (!iso || !node || !direction || threshold === undefined) {
      return res.status(400).json({ error: 'iso, node, direction, and threshold are required' });
    }

    if (!['above', 'below'].includes(direction)) {
      return res.status(400).json({ error: 'direction must be "above" or "below"' });
    }

    const id = createPriceAlertRule({
      tenantId: req.user.tenantId,
      iso,
      node,
      direction,
      threshold: parseFloat(threshold),
      cooldownMinutes: parseInt(cooldownMinutes),
      notifyWebsocket: notifyWebsocket ? 1 : 0,
      notifyEmail: notifyEmail ? 1 : 0,
      triggerCurtailment: triggerCurtailment ? 1 : 0,
    });

    res.status(201).json({ id, success: true });
  } catch (error) {
    console.error('Create alert rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /alerts/:id - Update alert rule ─────────────────────────────────────

router.put('/alerts/:id', (req, res) => {
  try {
    const { enabled, threshold, direction, cooldownMinutes, notifyWebsocket, notifyEmail, triggerCurtailment } = req.body;

    updatePriceAlertRule(req.params.id, req.user.tenantId, {
      enabled,
      threshold,
      direction,
      cooldownMinutes,
      notifyWebsocket,
      notifyEmail,
      triggerCurtailment,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Update alert rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /alerts/:id - Delete alert rule ──────────────────────────────────

router.delete('/alerts/:id', (req, res) => {
  try {
    deletePriceAlertRule(req.params.id, req.user.tenantId);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete alert rule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /alerts/history - Triggered alerts timeline ─────────────────────────

router.get('/alerts/history', (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const activities = getActivities(req.user.tenantId, {
      limit: parseInt(limit),
      offset: parseInt(offset),
      sourceType: 'price-alert',
    });
    res.json({ alerts: activities });
  } catch (error) {
    console.error('Get alert history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
