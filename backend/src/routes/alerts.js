import express from 'express';
import axios from 'axios';
import { getAlerts, addAlert, updateAlert, deleteAlert, logAlertTrigger, getCache } from '../cache/database.js';
import db from '../cache/database.js';

const router = express.Router();

// Get all alerts
router.get('/', (req, res) => {
  try {
    const alerts = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC').all();
    res.json({ alerts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get alert history
router.get('/history', (req, res) => {
  try {
    const history = db.prepare(`
      SELECT ah.*, a.metric, a.condition, a.threshold
      FROM alert_history ah
      JOIN alerts a ON ah.alert_id = a.id
      ORDER BY ah.triggered_at DESC
      LIMIT 100
    `).all();
    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create alert
router.post('/', (req, res) => {
  const { metric, condition, threshold, webhook_url } = req.body;

  if (!metric || !condition || threshold === undefined) {
    return res.status(400).json({ error: 'Metric, condition, and threshold are required' });
  }

  const validConditions = ['above', 'below', 'equals', 'crosses_above', 'crosses_below'];
  if (!validConditions.includes(condition)) {
    return res.status(400).json({ error: `Condition must be one of: ${validConditions.join(', ')}` });
  }

  const validMetrics = [
    'hashprice',
    'btc_price',
    'eu_us_ratio',
    'jgb_10y',
    'uranium_spot',
    'ndpr_price',
    'ewz_spy_ratio',
    'glw_qqq_ratio',
    'iran_hashrate_share'
  ];

  if (!validMetrics.includes(metric)) {
    return res.status(400).json({
      error: `Metric must be one of: ${validMetrics.join(', ')}`,
      validMetrics
    });
  }

  try {
    const result = addAlert(metric, condition, parseFloat(threshold), webhook_url);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update alert
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  const validFields = ['metric', 'condition', 'threshold', 'enabled', 'webhook_url'];
  const filteredUpdates = {};

  for (const key of Object.keys(updates)) {
    if (validFields.includes(key)) {
      filteredUpdates[key] = updates[key];
    }
  }

  if (Object.keys(filteredUpdates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    updateAlert(parseInt(id), filteredUpdates);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete alert
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  try {
    deleteAlert(parseInt(id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test webhook
router.post('/test-webhook', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    await axios.post(url, {
      type: 'test',
      message: 'Thesis Dashboard webhook test',
      timestamp: new Date().toISOString()
    }, { timeout: 5000 });

    res.json({ success: true, message: 'Webhook test successful' });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Failed to reach webhook URL'
    });
  }
});

// Check alerts (called by background job)
router.post('/check', async (req, res) => {
  try {
    const alerts = getAlerts();
    const triggered = [];

    for (const alert of alerts) {
      const value = await getCurrentValue(alert.metric);
      if (value === null) continue;

      const shouldTrigger = checkCondition(alert.condition, value, alert.threshold);

      if (shouldTrigger) {
        logAlertTrigger(alert.id, value);
        triggered.push({
          alert,
          value,
          timestamp: new Date().toISOString()
        });

        // Send webhook if configured
        if (alert.webhook_url) {
          try {
            await axios.post(alert.webhook_url, {
              type: 'alert',
              metric: alert.metric,
              condition: alert.condition,
              threshold: alert.threshold,
              value,
              message: `${alert.metric} is ${alert.condition} ${alert.threshold} (current: ${value})`,
              timestamp: new Date().toISOString()
            }, { timeout: 5000 });
          } catch (e) {
            console.error(`Webhook failed for alert ${alert.id}:`, e.message);
          }
        }
      }
    }

    res.json({
      checked: alerts.length,
      triggered: triggered.length,
      alerts: triggered
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function getCurrentValue(metric) {
  switch (metric) {
    case 'hashprice': {
      const cached = getCache('hashprice');
      return cached?.data?.current || null;
    }
    case 'btc_price': {
      const cached = getCache('hashprice-with-btc');
      return cached?.data?.current?.btcPrice || null;
    }
    case 'eu_us_ratio': {
      const cached = getCache('eu-us-ratio-1y');
      return cached?.data?.current || null;
    }
    case 'jgb_10y': {
      const cached = getCache('japan-macro');
      return cached?.data?.jgb?.current?.['10Y'] || null;
    }
    case 'uranium_spot': {
      const cached = getCache('uranium-prices');
      return cached?.data?.spot?.current || null;
    }
    case 'ndpr_price': {
      const cached = getCache('rare-earth-prices');
      return cached?.data?.primary?.current || null;
    }
    case 'ewz_spy_ratio': {
      const cached = getCache('brazil-compute');
      const ratio = cached?.data?.equities?.ewzSpyRatio;
      return ratio?.[ratio.length - 1]?.ratio || null;
    }
    case 'glw_qqq_ratio': {
      const cached = getCache('fiber-basket-1y');
      const ratio = cached?.data?.glwQqqRatio;
      return ratio?.[ratio.length - 1]?.ratio || null;
    }
    case 'iran_hashrate_share': {
      const cached = getCache('hashrate-share');
      return cached?.data?.iran?.current || null;
    }
    default:
      return null;
  }
}

function checkCondition(condition, value, threshold) {
  switch (condition) {
    case 'above':
      return value > threshold;
    case 'below':
      return value < threshold;
    case 'equals':
      return Math.abs(value - threshold) < 0.001;
    case 'crosses_above':
      // Would need previous value tracking
      return value > threshold;
    case 'crosses_below':
      // Would need previous value tracking
      return value < threshold;
    default:
      return false;
  }
}

export default router;
