/**
 * Bill.com API Service
 *
 * Uses v3 sync token auth (no passwords). User generates a sync token
 * in Bill.com Settings > Sync & Integrations > Tokens, then provides
 * token_name + token_value + org_id. Sessions last 48 hours.
 *
 * Falls back to v2 username/password if legacy credentials exist.
 */

import axios from 'axios';
import { getKeyVaultValue } from '../cache/database.js';

const BILLCOM_V3_BASE = 'https://gateway.bill.com/connect/v3';
const BILLCOM_V3_SANDBOX = 'https://gateway.stage.bill.com/connect/v3';
const BILLCOM_V2_BASE = 'https://api.bill.com/api/v2';
const BILLCOM_V2_SANDBOX = 'https://api-sandbox.bill.com/api/v2';

function getV3BaseUrl() {
  return process.env.BILLCOM_ENVIRONMENT === 'production' ? BILLCOM_V3_BASE : BILLCOM_V3_SANDBOX;
}

function getV2BaseUrl() {
  return process.env.BILLCOM_ENVIRONMENT === 'production' ? BILLCOM_V2_BASE : BILLCOM_V2_SANDBOX;
}

let sessionCache = new Map(); // tenantId -> { sessionId, expiresAt, version }

/**
 * Login to Bill.com using v3 sync token (preferred) or v2 username/password (legacy).
 */
async function login(tenantId) {
  const cached = sessionCache.get(tenantId);
  if (cached && Date.now() < cached.expiresAt) {
    return { sessionId: cached.sessionId, version: cached.version };
  }

  // Try v3 sync token first
  const tokenName = getKeyVaultValue(tenantId, 'billcom', 'token_name');
  const tokenValue = getKeyVaultValue(tenantId, 'billcom', 'token_value');
  const orgId = getKeyVaultValue(tenantId, 'billcom', 'org_id');
  const devKey = process.env.BILLCOM_DEV_KEY || getKeyVaultValue(tenantId, 'billcom', 'dev_key');

  if (tokenName && tokenValue && orgId) {
    const resp = await axios.post(`${getV3BaseUrl()}/login`, {
      username: tokenName,
      password: tokenValue,
      organizationId: orgId,
      devKey: devKey || undefined,
    }, { timeout: 15000 });

    if (resp.data?.sessionId) {
      // v3 sync token sessions last 48 hours of inactivity, cache for 24 hours
      sessionCache.set(tenantId, { sessionId: resp.data.sessionId, expiresAt: Date.now() + 24 * 60 * 60 * 1000, version: 'v3' });
      return { sessionId: resp.data.sessionId, version: 'v3' };
    }
    throw new Error(`Bill.com v3 login failed: ${JSON.stringify(resp.data)}`);
  }

  // Fallback to v2 username/password (legacy)
  const userName = getKeyVaultValue(tenantId, 'billcom', 'username');
  const password = getKeyVaultValue(tenantId, 'billcom', 'password');

  if (!userName || !password || !orgId || !devKey) {
    throw new Error('Bill.com credentials not configured - generate a sync token in Bill.com Settings');
  }

  const resp = await axios.post(`${getV2BaseUrl()}/Login.json`, {
    userName,
    password,
    orgId,
    devKey,
  }, { timeout: 15000 });

  if (resp.data.response_status !== 0) {
    throw new Error(`Bill.com login failed: ${resp.data.response_message || 'Unknown error'}`);
  }

  const sessionId = resp.data.response_data.sessionId;
  sessionCache.set(tenantId, { sessionId, expiresAt: Date.now() + 30 * 60 * 1000, version: 'v2' });
  return { sessionId, version: 'v2' };
}

/**
 * Make an authenticated Bill.com API request.
 * Routes to v3 or v2 endpoint based on session version.
 */
async function billcomRequest(tenantId, endpoint, data = {}) {
  let { sessionId, version } = await login(tenantId);
  const devKey = process.env.BILLCOM_DEV_KEY || getKeyVaultValue(tenantId, 'billcom', 'dev_key');

  if (version === 'v3') {
    // v3 uses different URL pattern and session header
    const resp = await axios.post(`${getV3BaseUrl()}/${endpoint}`, data, {
      headers: { sessionId, devKey: devKey || undefined },
      timeout: 20000,
    });
    if (resp.data?.errorCode) {
      // Session expired - clear cache and retry once
      sessionCache.delete(tenantId);
      const fresh = await login(tenantId);
      const retry = await axios.post(`${getV3BaseUrl()}/${endpoint}`, data, {
        headers: { sessionId: fresh.sessionId, devKey: devKey || undefined },
        timeout: 20000,
      });
      if (retry.data?.errorCode) {
        throw new Error(`Bill.com API error: ${retry.data.errorMessage || retry.data.errorCode}`);
      }
      return retry.data;
    }
    return resp.data;
  }

  // v2 path
  const resp = await axios.post(`${getV2BaseUrl()}/${endpoint}.json`, {
    ...data,
    sessionId,
    devKey,
  }, { timeout: 20000 });

  if (resp.data.response_status !== 0) {
    if (resp.data.response_message?.includes('session')) {
      sessionCache.delete(tenantId);
      const fresh = await login(tenantId);
      const retry = await axios.post(`${getV2BaseUrl()}/${endpoint}.json`, {
        ...data,
        sessionId: fresh.sessionId,
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
 * Checks v3 sync token first, then v2 legacy credentials.
 */
export function isConnected(tenantId) {
  const orgId = getKeyVaultValue(tenantId, 'billcom', 'org_id');
  if (!orgId) return false;
  // v3 sync token
  const tokenName = getKeyVaultValue(tenantId, 'billcom', 'token_name');
  const tokenValue = getKeyVaultValue(tenantId, 'billcom', 'token_value');
  if (tokenName && tokenValue) return true;
  // v2 legacy
  const username = getKeyVaultValue(tenantId, 'billcom', 'username');
  return !!username;
}
