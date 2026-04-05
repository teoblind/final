/**
 * Company Email Stats Job
 *
 * Periodically queries Gmail API for each portfolio company with
 * connected email accounts and records daily send/receive/draft counts.
 */

import { google } from 'googleapis';
import {
  getAllTenants,
  getTenantDb,
  getPortfolioCompanies,
  getCompanyEmailAccounts,
  upsertCompanyEmailStats,
  runWithTenant,
} from '../cache/database.js';

function getClientId() { return process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID; }
function getClientSecret() { return process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET; }

let interval = null;

function makeGmailClient(refreshToken) {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  if (!clientId || !clientSecret || !refreshToken) return null;
  const client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:8099');
  client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: client });
}

async function countMessages(gmail, query) {
  try {
    const res = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 1,
    });
    return res.data.resultSizeEstimate || 0;
  } catch {
    return 0;
  }
}

async function collectStats() {
  const today = new Date().toISOString().slice(0, 10);

  try {
    const tenants = getAllTenants();

    for (const tenant of tenants) {
      // Only process tenants with show_portfolio setting
      const settings = tenant.settings;
      if (!settings?.show_portfolio) continue;

      await runWithTenant(tenant.id, async () => {
        const companies = getPortfolioCompanies(tenant.id);

        for (const company of companies) {
          const accounts = getCompanyEmailAccounts(company.id, tenant.id);
          const activeAccounts = accounts.filter(a => a.is_active && a.oauth_refresh_token);

          let totalSent = 0;
          let totalReceived = 0;
          let totalDrafts = 0;

          for (const account of activeAccounts) {
            const gmail = makeGmailClient(account.oauth_refresh_token);
            if (!gmail) continue;

            try {
              const sent = await countMessages(gmail, 'in:sent newer_than:1d');
              const received = await countMessages(gmail, 'in:inbox newer_than:1d');
              const drafts = await countMessages(gmail, 'in:drafts');

              totalSent += sent;
              totalReceived += received;
              totalDrafts += drafts;
            } catch (err) {
              console.warn(`[CompanyEmailStats] Failed for ${account.gmail_address}:`, err.message);
            }
          }

          if (activeAccounts.length > 0) {
            upsertCompanyEmailStats({
              companyId: company.id,
              date: today,
              sentCount: totalSent,
              receivedCount: totalReceived,
              draftCount: totalDrafts,
              tenantId: tenant.id,
            });
          }
        }
      });
    }
  } catch (err) {
    console.error('[CompanyEmailStats] Collection error:', err.message);
  }
}

export function startCompanyEmailStatsJob(intervalHours = 24) {
  if (interval) {
    console.log('[CompanyEmailStats] Job already running');
    return;
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;
  console.log(`[CompanyEmailStats] Starting job (interval: ${intervalHours}h)`);

  // Run after a short delay on startup
  setTimeout(() => {
    collectStats().catch(err => console.error('[CompanyEmailStats] Initial run failed:', err.message));
  }, 30000); // 30s after startup

  interval = setInterval(() => {
    collectStats().catch(err => console.error('[CompanyEmailStats] Scheduled run failed:', err.message));
  }, intervalMs);
}

export function stopCompanyEmailStatsJob() {
  if (interval) {
    clearInterval(interval);
    interval = null;
    console.log('[CompanyEmailStats] Job stopped');
  }
}
