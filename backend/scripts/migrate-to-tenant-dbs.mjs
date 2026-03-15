#!/usr/bin/env node
/**
 * Migration Script: Single cache.db → Per-Tenant SQLite DBs
 *
 * Reads all rows from the old cache.db, routes them to the correct
 * per-tenant DB based on tenant_id column, and creates system.db.
 *
 * Usage:
 *   node scripts/migrate-to-tenant-dbs.mjs [--dry-run]
 *
 * This is idempotent — safe to run multiple times.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = join(__dirname, '../data');
const oldDbPath = join(dataDir, 'cache.db');
const systemDbPath = join(dataDir, 'system.db');

const DRY_RUN = process.argv.includes('--dry-run');

if (!fs.existsSync(oldDbPath)) {
  console.log('No cache.db found — nothing to migrate.');
  process.exit(0);
}

if (DRY_RUN) {
  console.log('=== DRY RUN — no changes will be written ===\n');
}

const oldDb = new Database(oldDbPath, { readonly: true });

// Map 'default' tenant to 'sangha' directory
function tenantDirName(tenantId) {
  if (tenantId === 'default') return 'sangha';
  return tenantId;
}

// Get or create a tenant DB
const tenantDbCache = new Map();
function getTenantDb(tenantId) {
  if (!tenantId) tenantId = 'default';
  if (tenantDbCache.has(tenantId)) return tenantDbCache.get(tenantId);

  const dirName = tenantDirName(tenantId);
  const tenantDir = join(dataDir, dirName);
  if (!DRY_RUN && !fs.existsSync(tenantDir)) {
    fs.mkdirSync(tenantDir, { recursive: true });
  }
  const dbPath = join(tenantDir, `${dirName}.db`);

  if (DRY_RUN) {
    // In dry run, don't create files
    tenantDbCache.set(tenantId, null);
    return null;
  }

  const tdb = new Database(dbPath);
  tdb.pragma('journal_mode = WAL');
  tdb.pragma('foreign_keys = ON');
  tenantDbCache.set(tenantId, tdb);
  return tdb;
}

// All tables to migrate with their tenant_id column name
// Some tables may not have tenant_id — they go to default
const TABLES_WITH_TENANT_ID = [
  'tenants',
  'users',
  'cache',
  'manual_data',
  'alerts',
  'alert_history',
  'notes',
  'imec_milestones',
  'datacenter_projects',
  'fiber_deals',
  'btc_wallets',
  'energy_prices',
  'system_load',
  'grid_events',
  'energy_settings',
  'fleet_config',
  'fleet_snapshots',
  'machine_snapshots',
  'curtailment_events',
  'curtailment_performance',
  'curtailment_settings',
  'pool_config',
  'pool_hashrate',
  'pool_earnings',
  'pool_payouts',
  'worker_snapshots',
  'blocks',
  'mempool_snapshots',
  'diagnostic_events',
  'agents',
  'agent_events',
  'agent_approvals',
  'agent_metrics',
  'agent_reports',
  'notifications',
  'workloads',
  'gpu_fleet_config',
  'hpc_contracts',
  'hpc_sla_events',
  'workload_snapshots',
  'gpu_spot_prices',
  'dacp_pricing',
  'dacp_bid_requests',
  'dacp_estimates',
  'dacp_jobs',
  'dacp_field_reports',
  'chat_messages',
  'chat_threads',
  'approval_items',
  'platform_notifications',
  'knowledge_entries',
  'knowledge_entities',
  'knowledge_links',
  'action_items',
  'agent_insights',
  'le_leads',
  'le_contacts',
  'le_outreach_log',
  'le_discovery_config',
  'tenant_files',
  'api_limits',
  'background_jobs',
  'job_messages',
  'key_vault',
  'activity_log',
  'processed_emails',
  'auto_replies',
  'tenant_email_config',
  'report_comments',
  'accounting_invoices',
  'accounting_bills',
  'accounting_payments',
  'price_alert_rules',
  'password_resets',
  // Insurance tables
  'insurance_policies',
  'insurance_claims',
  'insurance_settlements',
  'coverage_zones',
  'parametric_triggers',
  'risk_assessments',
  // HPC/GPU tables
  'sites',
  'site_metrics',
];

// Get all existing tables in old DB
const existingTables = oldDb.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
).all().map(r => r.name);

console.log(`Old DB has ${existingTables.length} tables`);
console.log(`Tables to migrate: ${TABLES_WITH_TENANT_ID.filter(t => existingTables.includes(t)).length}`);

// Discover all tenants from the old DB
const tenantIds = new Set(['default']);
try {
  const rows = oldDb.prepare('SELECT id FROM tenants').all();
  for (const r of rows) tenantIds.add(r.id);
} catch (e) {
  console.log('No tenants table found, using default only');
}
console.log(`Tenants discovered: ${[...tenantIds].join(', ')}`);

// Create system.db with tenants table
if (!DRY_RUN) {
  const sysDb = new Database(systemDbPath);
  sysDb.pragma('journal_mode = WAL');
  sysDb.pragma('foreign_keys = ON');

  sysDb.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL DEFAULT 'trial',
      status TEXT NOT NULL DEFAULT 'trial',
      branding_json TEXT,
      settings_json TEXT,
      limits_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      trial_ends_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      custom_domain TEXT
    )
  `);

  // Copy tenants from old DB
  try {
    const tenantRows = oldDb.prepare('SELECT * FROM tenants').all();
    const insertTenant = sysDb.prepare(`
      INSERT OR REPLACE INTO tenants (id, name, slug, plan, status, branding_json, settings_json, limits_json, created_at, trial_ends_at, updated_at, custom_domain)
      VALUES (@id, @name, @slug, @plan, @status, @branding_json, @settings_json, @limits_json, @created_at, @trial_ends_at, @updated_at, @custom_domain)
    `);
    for (const row of tenantRows) {
      insertTenant.run(row);
    }
    console.log(`System DB: ${tenantRows.length} tenants copied`);
  } catch (e) {
    console.log('Could not copy tenants to system.db:', e.message);
  }
  sysDb.close();
}

// Migrate each table
let totalMigrated = 0;

for (const table of TABLES_WITH_TENANT_ID) {
  if (!existingTables.includes(table)) continue;

  try {
    // Get column info
    const columns = oldDb.pragma(`table_info(${table})`);
    const colNames = columns.map(c => c.name);
    const hasTenantId = colNames.includes('tenant_id');

    // Read all rows
    const rows = oldDb.prepare(`SELECT * FROM "${table}"`).all();
    if (rows.length === 0) {
      console.log(`  ${table}: empty, skipping`);
      continue;
    }

    // Group rows by tenant
    const byTenant = {};
    for (const row of rows) {
      const tid = hasTenantId ? (row.tenant_id || 'default') : 'default';
      if (!byTenant[tid]) byTenant[tid] = [];
      byTenant[tid].push(row);
    }

    for (const [tid, tenantRows] of Object.entries(byTenant)) {
      if (DRY_RUN) {
        console.log(`  ${table}: ${tenantRows.length} rows → tenant '${tid}'`);
        totalMigrated += tenantRows.length;
        continue;
      }

      const tdb = getTenantDb(tid);
      if (!tdb) continue;

      // Ensure table exists (it should from initSchemaForDb, but just in case)
      // Get CREATE TABLE statement from old DB and run it on tenant DB
      const createStmt = oldDb.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table);
      if (createStmt?.sql) {
        try {
          tdb.exec(createStmt.sql);
        } catch (e) {
          // Table already exists
        }
      }

      // Insert rows
      const placeholders = colNames.map(() => '?').join(', ');
      const quotedCols = colNames.map(c => `"${c}"`).join(', ');
      const insertStmt = tdb.prepare(
        `INSERT OR IGNORE INTO "${table}" (${quotedCols}) VALUES (${placeholders})`
      );

      const insertMany = tdb.transaction((rows) => {
        for (const row of rows) {
          const values = colNames.map(c => row[c] ?? null);
          insertStmt.run(...values);
        }
      });

      insertMany(tenantRows);
      console.log(`  ${table}: ${tenantRows.length} rows → tenant '${tid}'`);
      totalMigrated += tenantRows.length;
    }
  } catch (err) {
    console.error(`  ${table}: ERROR — ${err.message}`);
  }
}

// Also copy indices from old DB to tenant DBs
if (!DRY_RUN) {
  const indices = oldDb.prepare(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
  ).all();

  for (const idx of indices) {
    for (const [tid, tdb] of tenantDbCache.entries()) {
      if (!tdb) continue;
      try {
        tdb.exec(idx.sql);
      } catch (e) {
        // Index already exists
      }
    }
  }
  console.log(`Copied ${indices.length} indices to tenant DBs`);
}

// Close all DBs
oldDb.close();
for (const [, tdb] of tenantDbCache) {
  if (tdb) tdb.close();
}

console.log(`\nMigration complete: ${totalMigrated} total rows processed`);
if (!DRY_RUN) {
  console.log(`\nTenant DB files created in ${dataDir}/`);
  console.log('You can now rename cache.db to cache.db.bak and restart the server.');
} else {
  console.log('\nDry run complete. Run without --dry-run to execute migration.');
}
