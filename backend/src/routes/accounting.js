/**
 * Accounting Routes
 *
 * REST API for invoices, bills, payments, and stats.
 * Pulls from local DB (synced from QuickBooks / Bill.com via accountingPoll).
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getAccountingInvoices,
  getAccountingBills,
  getAccountingPayments,
  getAccountingStats,
} from '../cache/database.js';
import * as qbService from '../services/quickbooksService.js';
import * as billcomService from '../services/billcomService.js';
import { syncAccountingData } from '../jobs/accountingPoll.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── GET /invoices — List invoices ───────────────────────────────────────────

router.get('/invoices', (req, res) => {
  try {
    const { status, source, limit = 100, offset = 0 } = req.query;
    const invoices = getAccountingInvoices(req.user.tenantId, {
      status,
      source,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    res.json({ invoices, total: invoices.length });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bills — List bills ─────────────────────────────────────────────────

router.get('/bills', (req, res) => {
  try {
    const { status, source, limit = 100, offset = 0 } = req.query;
    const bills = getAccountingBills(req.user.tenantId, {
      status,
      source,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    res.json({ bills, total: bills.length });
  } catch (error) {
    console.error('Get bills error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /payments — List payments ───────────────────────────────────────────

router.get('/payments', (req, res) => {
  try {
    const { type, source, limit = 100, offset = 0 } = req.query;
    const payments = getAccountingPayments(req.user.tenantId, {
      type,
      source,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    res.json({ payments, total: payments.length });
  } catch (error) {
    console.error('Get payments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /stats — Dashboard totals ──────────────────────────────────────────

router.get('/stats', (req, res) => {
  try {
    const stats = getAccountingStats(req.user.tenantId);
    const qbConnected = qbService.isConnected(req.user.tenantId);
    const billcomConnected = billcomService.isConnected(req.user.tenantId);

    res.json({
      ...stats,
      connections: {
        quickbooks: qbConnected,
        billcom: billcomConnected,
      },
    });
  } catch (error) {
    console.error('Get accounting stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /sync — Trigger manual sync ────────────────────────────────────────

router.post('/sync', async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const results = await syncAccountingData(tenantId);
    res.json({ success: true, results });
  } catch (error) {
    console.error('Manual sync error:', error);
    res.status(500).json({ error: error.message || 'Sync failed' });
  }
});

export default router;
