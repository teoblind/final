/**
 * QuickBooks Online API Service
 *
 * Handles token refresh, invoice/bill/payment CRUD via QuickBooks API.
 * Uses OAuth2 with Basic auth header for token exchange (not client_secret_post).
 * Refresh tokens expire after 100 days — must handle re-auth prompts.
 */

import axios from 'axios';
import { getKeyVaultValue, upsertKeyVaultEntry } from '../cache/database.js';

const QB_SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com';
const QB_PRODUCTION_BASE = 'https://quickbooks.api.intuit.com';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

function getBaseUrl() {
  return process.env.INTUIT_ENVIRONMENT === 'production' ? QB_PRODUCTION_BASE : QB_SANDBOX_BASE;
}

/**
 * Refresh QuickBooks access token using refresh_token.
 * Intuit uses Basic auth header (base64 client_id:client_secret).
 */
async function refreshAccessToken(tenantId) {
  const refreshToken = getKeyVaultValue(tenantId, 'intuit-quickbooks', 'refresh_token');
  if (!refreshToken) throw new Error('No QuickBooks refresh token found');

  const clientId = process.env.INTUIT_CLIENT_ID;
  const clientSecret = process.env.INTUIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Intuit OAuth credentials not configured');

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const resp = await axios.post(QB_TOKEN_URL, new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }).toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
      Accept: 'application/json',
    },
    timeout: 15000,
  });

  const { access_token, refresh_token, expires_in } = resp.data;

  // Store new tokens
  upsertKeyVaultEntry({
    tenantId,
    service: 'intuit-quickbooks',
    keyName: 'access_token',
    keyValue: access_token,
    addedBy: 'system',
    expiresAt: new Date(Date.now() + expires_in * 1000).toISOString(),
  });

  if (refresh_token) {
    upsertKeyVaultEntry({
      tenantId,
      service: 'intuit-quickbooks',
      keyName: 'refresh_token',
      keyValue: refresh_token,
      addedBy: 'system',
    });
  }

  return access_token;
}

/**
 * Get a valid access token, refreshing if expired.
 */
async function getAccessToken(tenantId) {
  const stored = getKeyVaultValue(tenantId, 'intuit-quickbooks', 'access_token');
  if (stored) {
    // Try using stored token — if it fails with 401, we'll refresh
    return stored;
  }
  return refreshAccessToken(tenantId);
}

/**
 * Make an authenticated QB API request with automatic token refresh on 401.
 */
async function qbRequest(tenantId, method, path, data = null) {
  const realmId = getKeyVaultValue(tenantId, 'intuit-quickbooks', 'realm_id');
  if (!realmId) throw new Error('No QuickBooks realm ID found — reconnect QuickBooks');

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/v3/company/${realmId}${path}`;

  let token = await getAccessToken(tenantId);

  const makeRequest = async (accessToken) => {
    const config = {
      method,
      url,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    };
    if (data && (method === 'post' || method === 'put')) {
      config.data = data;
    }
    return axios(config);
  };

  try {
    const resp = await makeRequest(token);
    return resp.data;
  } catch (err) {
    if (err.response?.status === 401) {
      // Token expired — refresh and retry once
      token = await refreshAccessToken(tenantId);
      const resp = await makeRequest(token);
      return resp.data;
    }
    throw err;
  }
}

// ─── Company Info ────────────────────────────────────────────────────────────

export async function getCompanyInfo(tenantId) {
  const data = await qbRequest(tenantId, 'get', '/companyinfo/' +
    getKeyVaultValue(tenantId, 'intuit-quickbooks', 'realm_id'));
  return data.CompanyInfo;
}

// ─── Invoices ────────────────────────────────────────────────────────────────

export async function fetchInvoices(tenantId, { maxResults = 100, startPosition = 1 } = {}) {
  const query = `SELECT * FROM Invoice ORDERBY MetaData.LastUpdatedTime DESC STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
  const data = await qbRequest(tenantId, 'get', `/query?query=${encodeURIComponent(query)}`);
  return data.QueryResponse?.Invoice || [];
}

export async function fetchInvoice(tenantId, invoiceId) {
  const data = await qbRequest(tenantId, 'get', `/invoice/${invoiceId}`);
  return data.Invoice;
}

// ─── Bills ───────────────────────────────────────────────────────────────────

export async function fetchBills(tenantId, { maxResults = 100, startPosition = 1 } = {}) {
  const query = `SELECT * FROM Bill ORDERBY MetaData.LastUpdatedTime DESC STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
  const data = await qbRequest(tenantId, 'get', `/query?query=${encodeURIComponent(query)}`);
  return data.QueryResponse?.Bill || [];
}

export async function fetchBill(tenantId, billId) {
  const data = await qbRequest(tenantId, 'get', `/bill/${billId}`);
  return data.Bill;
}

// ─── Payments ────────────────────────────────────────────────────────────────

export async function fetchPayments(tenantId, { maxResults = 100, startPosition = 1 } = {}) {
  const query = `SELECT * FROM Payment ORDERBY MetaData.LastUpdatedTime DESC STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
  const data = await qbRequest(tenantId, 'get', `/query?query=${encodeURIComponent(query)}`);
  return data.QueryResponse?.Payment || [];
}

export async function fetchBillPayments(tenantId, { maxResults = 100, startPosition = 1 } = {}) {
  const query = `SELECT * FROM BillPayment ORDERBY MetaData.LastUpdatedTime DESC STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
  const data = await qbRequest(tenantId, 'get', `/query?query=${encodeURIComponent(query)}`);
  return data.QueryResponse?.BillPayment || [];
}

// ─── Create Invoice ──────────────────────────────────────────────────────────

export async function createInvoice(tenantId, invoiceData) {
  const data = await qbRequest(tenantId, 'post', '/invoice', invoiceData);
  return data.Invoice;
}

// ─── Sync Helpers ────────────────────────────────────────────────────────────

/**
 * Normalize a QB Invoice into our accounting_invoices schema.
 */
export function normalizeInvoice(inv) {
  return {
    externalId: inv.Id,
    source: 'quickbooks',
    customerName: inv.CustomerRef?.name || 'Unknown',
    invoiceNumber: inv.DocNumber || `INV-${inv.Id}`,
    amount: parseFloat(inv.TotalAmt || 0),
    balanceDue: parseFloat(inv.Balance || 0),
    status: inv.Balance === 0 ? 'paid' : (new Date(inv.DueDate) < new Date() ? 'overdue' : 'open'),
    dueDate: inv.DueDate || null,
    detailJson: JSON.stringify({
      lines: (inv.Line || []).filter(l => l.DetailType === 'SalesItemLineDetail').map(l => ({
        description: l.Description,
        amount: l.Amount,
        qty: l.SalesItemLineDetail?.Qty,
        unitPrice: l.SalesItemLineDetail?.UnitPrice,
      })),
      txnDate: inv.TxnDate,
      email: inv.BillEmail?.Address,
    }),
  };
}

/**
 * Normalize a QB Bill into our accounting_bills schema.
 */
export function normalizeBill(bill) {
  return {
    externalId: bill.Id,
    source: 'quickbooks',
    vendorName: bill.VendorRef?.name || 'Unknown',
    billNumber: bill.DocNumber || `BILL-${bill.Id}`,
    amount: parseFloat(bill.TotalAmt || 0),
    balanceDue: parseFloat(bill.Balance || 0),
    status: bill.Balance === 0 ? 'paid' : (new Date(bill.DueDate) < new Date() ? 'overdue' : 'open'),
    dueDate: bill.DueDate || null,
    detailJson: JSON.stringify({
      lines: (bill.Line || []).filter(l => l.DetailType === 'AccountBasedExpenseLineDetail').map(l => ({
        description: l.Description,
        amount: l.Amount,
        account: l.AccountBasedExpenseLineDetail?.AccountRef?.name,
      })),
      txnDate: bill.TxnDate,
    }),
  };
}

/**
 * Normalize a QB Payment into our accounting_payments schema.
 */
export function normalizePayment(pmt, type = 'received') {
  return {
    externalId: pmt.Id,
    source: 'quickbooks',
    type,
    amount: parseFloat(pmt.TotalAmt || 0),
    paymentDate: pmt.TxnDate || null,
    customerOrVendor: type === 'received'
      ? (pmt.CustomerRef?.name || 'Unknown')
      : (pmt.VendorRef?.name || 'Unknown'),
    detailJson: JSON.stringify({
      paymentMethod: pmt.PaymentMethodRef?.name,
      depositTo: pmt.DepositToAccountRef?.name,
      txnDate: pmt.TxnDate,
    }),
  };
}

/**
 * Check if QB is connected for a tenant.
 */
export function isConnected(tenantId) {
  const refreshToken = getKeyVaultValue(tenantId, 'intuit-quickbooks', 'refresh_token');
  const realmId = getKeyVaultValue(tenantId, 'intuit-quickbooks', 'realm_id');
  return !!(refreshToken && realmId);
}
