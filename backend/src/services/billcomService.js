/**
 * Bill.com API Service
 *
 * Session-based auth (not OAuth) — uses username/password/org_id/dev_key.
 * Credentials stored in key_vault as 'billcom' service entries.
 */

import axios from 'axios';
import { getKeyVaultValue } from '../cache/database.js';

const BILLCOM_API_BASE = 'https://api.bill.com/api/v2';
const BILLCOM_SANDBOX_BASE = 'https://api-sandbox.bill.com/api/v2';

function getBaseUrl() {
  return process.env.BILLCOM_ENVIRONMENT === 'production' ? BILLCOM_API_BASE : BILLCOM_SANDBOX_BASE;
}

let sessionCache = new Map(); // tenantId → { sessionId, expiresAt }

/**
 * Login to Bill.com and get a session ID.
 */
async function login(tenantId) {
  const cached = sessionCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.sessionId;
  }

  const userName = getKeyVaultValue(tenantId, 'billcom', 'username');
  const password = getKeyVaultValue(tenantId, 'billcom', 'password');
  const orgId = getKeyVaultValue(tenantId, 'billcom', 'org_id');
  const devKey = getKeyVaultValue(tenantId, 'billcom', 'dev_key');

  if (!userName || !password || !orgId || !devKey) {
    throw new Error('Bill.com credentials not configured');
  }

  const resp = await axios.post(`${getBaseUrl()}/Login.json`, {
    userName,
    password,
    orgId,
    devKey,
  }, { timeout: 15000 });

  if (resp.data.response_status !== 0) {
    throw new Error(`Bill.com login failed: ${resp.data.response_message || 'Unknown error'}`);
  }

  const sessionId = resp.data.response_data.sessionId;
  // Sessions last ~35 min, cache for 30 min
  sessionCache.set(tenantId, { sessionId, expiresAt: Date.now() + 30 * 60 * 1000 });

  return sessionId;
}

/**
 * Make an authenticated Bill.com API request.
 */
async function billcomRequest(tenantId, endpoint, data = {}) {
  const sessionId = await login(tenantId);
  const devKey = getKeyVaultValue(tenantId, 'billcom', 'dev_key');

  const resp = await axios.post(`${getBaseUrl()}/${endpoint}.json`, {
    ...data,
    sessionId,
    devKey,
  }, { timeout: 20000 });

  if (resp.data.response_status !== 0) {
    // Session expired — clear cache and retry once
    if (resp.data.response_message?.includes('session')) {
      sessionCache.delete(tenantId);
      const newSessionId = await login(tenantId);
      const retry = await axios.post(`${getBaseUrl()}/${endpoint}.json`, {
        ...data,
        sessionId: newSessionId,
        devKey,
      }, { timeout: 20000 });
      if (retry.data.response_status !== 0) {
        throw new Error(`Bill.com API error: ${retry.data.response_message}`);
      }
      return retry.data.response_data;
    }
    throw new Error(`Bill.com API error: ${resp.data.response_message}`);
  }

  return resp.data.response_data;
}

// ─── Bills ───────────────────────────────────────────────────────────────────

export async function fetchBills(tenantId, { start = 0, max = 999 } = {}) {
  const data = await billcomRequest(tenantId, 'ListBills', { start, max });
  return data || [];
}

// ─── Invoices (Sent Invoices) ────────────────────────────────────────────────

export async function fetchInvoices(tenantId, { start = 0, max = 999 } = {}) {
  const data = await billcomRequest(tenantId, 'ListSentInvoices', { start, max });
  return data || [];
}

// ─── Payments ────────────────────────────────────────────────────────────────

export async function fetchSentPayments(tenantId, { start = 0, max = 999 } = {}) {
  const data = await billcomRequest(tenantId, 'ListSentPays', { start, max });
  return data || [];
}

export async function fetchReceivedPayments(tenantId, { start = 0, max = 999 } = {}) {
  const data = await billcomRequest(tenantId, 'ListReceivedPays', { start, max });
  return data || [];
}

// ─── Normalize ───────────────────────────────────────────────────────────────

export function normalizeInvoice(inv) {
  return {
    externalId: inv.id,
    source: 'billcom',
    customerName: inv.customerName || inv.vendorName || 'Unknown',
    invoiceNumber: inv.invoiceNumber || `BC-${inv.id}`,
    amount: parseFloat(inv.amount || 0),
    balanceDue: parseFloat(inv.amountDue || inv.amount || 0),
    status: parseFloat(inv.amountDue || 0) === 0 ? 'paid' : 'open',
    dueDate: inv.dueDate || null,
    detailJson: JSON.stringify({ description: inv.description, createdTime: inv.createdTime }),
  };
}

export function normalizeBill(bill) {
  return {
    externalId: bill.id,
    source: 'billcom',
    vendorName: bill.vendorName || 'Unknown',
    billNumber: bill.invoiceNumber || `BC-BILL-${bill.id}`,
    amount: parseFloat(bill.amount || 0),
    balanceDue: parseFloat(bill.amountDue || bill.amount || 0),
    status: parseFloat(bill.amountDue || 0) === 0 ? 'paid' : 'open',
    dueDate: bill.dueDate || null,
    detailJson: JSON.stringify({ description: bill.description, createdTime: bill.createdTime }),
  };
}

export function normalizePayment(pmt, type = 'sent') {
  return {
    externalId: pmt.id,
    source: 'billcom',
    type,
    amount: parseFloat(pmt.amount || 0),
    paymentDate: pmt.processDate || pmt.createdTime || null,
    customerOrVendor: pmt.vendorName || pmt.customerName || 'Unknown',
    detailJson: JSON.stringify({ description: pmt.description, status: pmt.status }),
  };
}

/**
 * Check if Bill.com is connected for a tenant.
 */
export function isConnected(tenantId) {
  const username = getKeyVaultValue(tenantId, 'billcom', 'username');
  const orgId = getKeyVaultValue(tenantId, 'billcom', 'org_id');
  return !!(username && orgId);
}
