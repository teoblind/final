/**
 * Accounting Poll Job
 *
 * 15-minute scheduler that syncs invoices, bills, and payments from
 * QuickBooks and Bill.com into the local accounting_* tables.
 * Follows the gmailPoll.js pattern.
 */

import {
  upsertAccountingInvoice,
  upsertAccountingBill,
  upsertAccountingPayment,
  insertActivity,
  getAllTenants,
  getTenantDb,
  runWithTenant,
} from '../cache/database.js';
import * as qbService from '../services/quickbooksService.js';
import * as billcomService from '../services/billcomService.js';

// Track which tenants have been synced recently
const lastSyncMap = new Map();

/**
 * Sync accounting data for a specific tenant.
 * Called by both the scheduler and the manual sync endpoint.
 */
export async function syncAccountingData(tenantId) {
  const results = { quickbooks: null, billcom: null };

  // ─── QuickBooks Sync ──────────────────────────────────────────────────────
  if (qbService.isConnected(tenantId)) {
    try {
      const invoices = await qbService.fetchInvoices(tenantId);
      let invCount = 0;
      for (const inv of invoices) {
        const normalized = qbService.normalizeInvoice(inv);
        upsertAccountingInvoice(tenantId, normalized);
        invCount++;
      }

      const bills = await qbService.fetchBills(tenantId);
      let billCount = 0;
      for (const bill of bills) {
        const normalized = qbService.normalizeBill(bill);
        upsertAccountingBill(tenantId, normalized);
        billCount++;
      }

      const payments = await qbService.fetchPayments(tenantId);
      let pmtCount = 0;
      for (const pmt of payments) {
        const normalized = qbService.normalizePayment(pmt, 'received');
        upsertAccountingPayment(tenantId, normalized);
        pmtCount++;
      }

      const billPayments = await qbService.fetchBillPayments(tenantId);
      for (const pmt of billPayments) {
        const normalized = qbService.normalizePayment(pmt, 'sent');
        upsertAccountingPayment(tenantId, normalized);
        pmtCount++;
      }

      results.quickbooks = { invoices: invCount, bills: billCount, payments: pmtCount };
      console.log(`[AccountingPoll] QB sync for ${tenantId}: ${invCount} invoices, ${billCount} bills, ${pmtCount} payments`);
    } catch (err) {
      console.error(`[AccountingPoll] QB sync error for ${tenantId}:`, err.message);
      results.quickbooks = { error: err.message };
    }
  }

  // ─── Bill.com Sync ────────────────────────────────────────────────────────
  if (billcomService.isConnected(tenantId)) {
    try {
      const invoices = await billcomService.fetchInvoices(tenantId);
      let invCount = 0;
      for (const inv of invoices) {
        const normalized = billcomService.normalizeInvoice(inv);
        upsertAccountingInvoice(tenantId, normalized);
        invCount++;
      }

      const bills = await billcomService.fetchBills(tenantId);
      let billCount = 0;
      for (const bill of bills) {
        const normalized = billcomService.normalizeBill(bill);
        upsertAccountingBill(tenantId, normalized);
        billCount++;
      }

      const sentPmts = await billcomService.fetchSentPayments(tenantId);
      let pmtCount = 0;
      for (const pmt of sentPmts) {
        const normalized = billcomService.normalizePayment(pmt, 'sent');
        upsertAccountingPayment(tenantId, normalized);
        pmtCount++;
      }

      const recPmts = await billcomService.fetchReceivedPayments(tenantId);
      for (const pmt of recPmts) {
        const normalized = billcomService.normalizePayment(pmt, 'received');
        upsertAccountingPayment(tenantId, normalized);
        pmtCount++;
      }

      results.billcom = { invoices: invCount, bills: billCount, payments: pmtCount };
      console.log(`[AccountingPoll] Bill.com sync for ${tenantId}: ${invCount} invoices, ${billCount} bills, ${pmtCount} payments`);
    } catch (err) {
      console.error(`[AccountingPoll] Bill.com sync error for ${tenantId}:`, err.message);
      results.billcom = { error: err.message };
    }
  }

  lastSyncMap.set(tenantId, new Date().toISOString());
  return results;
}

/**
 * Poll all tenants that have accounting integrations.
 */
async function pollAllTenants() {
  // Get tenants with QB or Bill.com connected via key_vault in their tenant DBs
  try {
    const allTenants = getAllTenants();
    const tenantsToSync = [];

    for (const tenant of allTenants) {
      try {
        const tdb = getTenantDb(tenant.id);
        const hasAccounting = tdb.prepare(`
          SELECT 1 FROM key_vault
          WHERE service IN ('intuit-quickbooks', 'billcom')
          AND key_name = 'refresh_token'
          LIMIT 1
        `).get();
        if (hasAccounting) {
          tenantsToSync.push(tenant.id);
        }
      } catch (e) {
        // key_vault table may not exist yet for this tenant
      }
    }

    for (const tenantId of tenantsToSync) {
      try {
        await runWithTenant(tenantId, () => syncAccountingData(tenantId));
      } catch (err) {
        console.error(`[AccountingPoll] Error syncing tenant ${tenantId}:`, err.message);
      }
    }

    if (tenantsToSync.length > 0) {
      console.log(`[AccountingPoll] Synced ${tenantsToSync.length} tenant(s)`);
    }
  } catch (err) {
    console.error('[AccountingPoll] Poll error:', err.message);
  }
}

/**
 * Start the accounting poll scheduler.
 * @param {number} intervalMinutes - Poll interval (default 15 min)
 */
export function startAccountingPollScheduler(intervalMinutes = 15) {
  console.log(`[AccountingPoll] Scheduler started (every ${intervalMinutes} min)`);

  // Initial poll after 10s
  setTimeout(() => pollAllTenants().catch(err => console.error('[AccountingPoll] Initial poll error:', err.message)), 10000);

  // Recurring poll
  setInterval(
    () => pollAllTenants().catch(err => console.error('[AccountingPoll] Poll error:', err.message)),
    intervalMinutes * 60 * 1000
  );
}
