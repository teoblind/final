import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import bcryptPkg from 'bcryptjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dataDir = join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// ─── Per-Tenant DB Infrastructure ──────────────────────────────────────────
const tenantStore = new AsyncLocalStorage();

// Sangha Renewables tenant ID (was 'default' historically)
export const SANGHA_TENANT_ID = 'sangha-renewables';

// Map tenant_id → directory name for DB file paths
function tenantDirName(tenantId) {
  if (tenantId === SANGHA_TENANT_ID || tenantId === 'default') return 'sangha';
  // Sanitize tenantId to prevent path traversal
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// System DB - stores tenants table for routing, always available
const systemDb = new Database(join(dataDir, 'system.db'));
systemDb.pragma('journal_mode = WAL');
systemDb.pragma('busy_timeout = 5000');
systemDb.pragma('synchronous = NORMAL');
systemDb.pragma('foreign_keys = ON');

// Per-tenant DB cache: tenantId → Database instance
const tenantDbCache = new Map();

/**
 * Get or create a Database instance for a specific tenant.
 * DB files live at data/{tenantDir}/{tenantDir}.db
 */
function getTenantDb(tenantId) {
  if (!tenantId) tenantId = SANGHA_TENANT_ID;
  if (tenantDbCache.has(tenantId)) return tenantDbCache.get(tenantId);

  const dirName = tenantDirName(tenantId);
  const tenantDir = join(dataDir, dirName);
  if (!fs.existsSync(tenantDir)) {
    fs.mkdirSync(tenantDir, { recursive: true });
  }
  const dbPath = join(tenantDir, `${dirName}.db`);
  const tdb = new Database(dbPath);
  tdb.pragma('journal_mode = WAL');
  tdb.pragma('busy_timeout = 5000');
  tdb.pragma('synchronous = NORMAL');
  tdb.pragma('foreign_keys = ON');

  tenantDbCache.set(tenantId, tdb);
  return tdb;
}

/**
 * Resolve the correct DB for the current async context.
 * Falls back to default tenant when no tenant context is set
 * (startup, cron jobs, etc.).
 */
function resolveDb() {
  const store = tenantStore.getStore();
  const tenantId = store?.tenantId;
  if (tenantId) {
    return getTenantDb(tenantId);
  }
  // Fallback: Sangha tenant (for startup, cron jobs, etc.)
  return getTenantDb(SANGHA_TENANT_ID);
}

/**
 * Proxy that delegates all property access to the resolved tenant DB.
 * This means all existing code using `db.prepare(...)`, `db.exec(...)`,
 * `db.transaction(...)`, etc. will auto-route to the correct tenant DB.
 */
const db = new Proxy({}, {
  get(target, prop, receiver) {
    const realDb = resolveDb();
    const val = realDb[prop];
    if (typeof val === 'function') {
      return val.bind(realDb);
    }
    return val;
  },
  set(target, prop, value) {
    const realDb = resolveDb();
    realDb[prop] = value;
    return true;
  },
});

// ─── Tenant Context Helpers ──────────────────────────────────────────────────

/**
 * Run a callback with a specific tenant context.
 * Use in middleware: setTenantContext(tenantId, () => next())
 */
export function setTenantContext(tenantId, callback) {
  return tenantStore.run({ tenantId }, callback);
}

/**
 * Run an async function with a specific tenant context.
 * Use in background jobs: await runWithTenant(tenantId, async () => { ... })
 */
export function runWithTenant(tenantId, fn) {
  return new Promise((resolve, reject) => {
    tenantStore.run({ tenantId }, () => {
      Promise.resolve(fn()).then(resolve, reject);
    });
  });
}

/**
 * Get the current tenant ID from async context.
 */
export function getCurrentTenantId() {
  return tenantStore.getStore()?.tenantId || null;
}

/**
 * Get the raw system DB (for tenant management queries).
 */
export function getSystemDb() {
  return systemDb;
}

/**
 * Get a raw tenant DB by ID (for migration scripts, etc.)
 */
export { getTenantDb };

/**
 * Get all tenant DBs as { tenantId: db } object.
 * Used for cross-tenant lookups (e.g. public share links).
 */
export function getAllTenantDbs() {
  const tenants = systemDb.prepare('SELECT id FROM tenants').all();
  const result = {};
  for (const t of tenants) {
    result[t.id] = getTenantDb(t.id);
  }
  return result;
}

// ─── SQL Reserved Word Sanitizer ─────────────────────────────────────────────
// Prevents tenant names or slugs from corrupting sqlite_master if they ever
// leak into DDL (e.g. CHECK constraints, DEFAULT values, index names).
const SQL_RESERVED = new Set([
  'ABORT','ACTION','ADD','AFTER','ALL','ALTER','ALWAYS','ANALYZE','AND','AS',
  'ASC','ATTACH','AUTOINCREMENT','BEFORE','BEGIN','BETWEEN','BY','CASCADE',
  'CASE','CAST','CHECK','COLLATE','COLUMN','COMMIT','CONFLICT','CONSTRAINT',
  'CREATE','CROSS','CURRENT','CURRENT_DATE','CURRENT_TIME','CURRENT_TIMESTAMP',
  'DATABASE','DEFAULT','DEFERRABLE','DEFERRED','DELETE','DESC','DETACH',
  'DISTINCT','DO','DROP','EACH','ELSE','END','ESCAPE','EXCEPT','EXCLUDE',
  'EXCLUSIVE','EXISTS','EXPLAIN','FAIL','FILTER','FIRST','FOLLOWING','FOR',
  'FOREIGN','FROM','FULL','GENERATED','GLOB','GROUP','GROUPS','HAVING','IF',
  'IGNORE','IMMEDIATE','IN','INDEX','INDEXED','INITIALLY','INNER','INSERT',
  'INSTEAD','INTERSECT','INTO','IS','ISNULL','JOIN','KEY','LAST','LEFT',
  'LIKE','LIMIT','MATCH','MATERIALIZED','NATURAL','NO','NOT','NOTHING',
  'NOTNULL','NULL','NULLS','OF','OFFSET','ON','OR','ORDER','OTHERS','OUTER',
  'OVER','PARTITION','PLAN','PRAGMA','PRECEDING','PRIMARY','QUERY','RAISE',
  'RANGE','RECURSIVE','REFERENCES','REGEXP','REINDEX','RELEASE','RENAME',
  'REPLACE','RESTRICT','RETURNING','RIGHT','ROLLBACK','ROW','ROWS','SAVEPOINT',
  'SELECT','SET','TABLE','TEMP','TEMPORARY','THEN','TIES','TO','TRANSACTION',
  'TRIGGER','UNBOUNDED','UNION','UNIQUE','UPDATE','USING','VACUUM','VALUES',
  'VIEW','VIRTUAL','WHEN','WHERE','WINDOW','WITH','WITHOUT',
]);

/**
 * Sanitize a string before it touches any DDL or schema-level SQL.
 * - Strips characters that could break SQL syntax: quotes, semicolons, parens, backslashes
 * - Trims whitespace
 * - Used on tenant name, slug, and id at creation/update time
 */
export function sanitizeTenantField(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/[;'"\\()]/g, '')  // strip SQL-dangerous chars
    .replace(/\s+/g, ' ')       // collapse whitespace
    .trim();
}

/**
 * Check if a string is a SQL reserved word (case-insensitive).
 * Returns true if reserved - callers should reject or quote.
 */
export function isSqlReserved(value) {
  if (typeof value !== 'string') return false;
  return SQL_RESERVED.has(value.toUpperCase().trim());
}

// ─── Schema Initialization ───────────────────────────────────────────────────
// Extracted into a reusable function that takes a db instance.
// This allows us to init schema on each tenant DB independently.

function initSchemaForDb(targetDb) {
  // Cache table for API responses
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);

  // Alerts configuration
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric TEXT NOT NULL,
      condition TEXT NOT NULL,
      threshold REAL NOT NULL,
      enabled INTEGER DEFAULT 1,
      webhook_url TEXT,
      last_triggered TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Alert history
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER,
      value REAL,
      triggered_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alert_id) REFERENCES alerts(id)
    )
  `);

  // Notes/Journal
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      content TEXT NOT NULL,
      panel TEXT,
      tags TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // IMEC milestones
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS imec_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      date TEXT NOT NULL,
      status TEXT DEFAULT 'planned',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Data center projects
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS datacenter_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      location TEXT NOT NULL,
      region TEXT NOT NULL,
      capacity_mw REAL,
      status TEXT DEFAULT 'announced',
      expected_online TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Deal tracker for fiber/infrastructure deals
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS fiber_deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      buyer TEXT NOT NULL,
      seller TEXT NOT NULL,
      value_usd REAL,
      capacity TEXT,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Bitcoin wallet addresses for reserve tracking
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS btc_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert known US government BTC wallets if they don't exist
  const insertWallet = targetDb.prepare(`
    INSERT OR IGNORE INTO btc_wallets (address, label, description) VALUES (?, ?, ?)
  `);

  const knownWallets = [
    ['bc1qa5wkgaew2dkv56kfvj49j0av5nml45x9ek9hz6', 'US DOJ - Silk Road', 'Silk Road seizure wallet'],
    ['bc1qmxjefnuy06v345v6vhwpwt05dztztmx4g3y7wp', 'US DOJ - Bitfinex', 'Bitfinex hack recovery'],
    ['1FfmbHfnpaZjKFvyi1okTjJJusN455paPH', 'FBI Silk Road', 'FBI Silk Road seizure'],
    ['bc1qe7nk2nlnjewghgw4sgm0r89zkjzsurda7z4ckh', 'US Marshals', 'US Marshals Service wallet'],
  ];

  knownWallets.forEach(([address, label, description]) => {
    insertWallet.run(address, label, description);
  });

  // =========================================================================
  // Phase 2: Energy market tables
  // =========================================================================

  // Historical energy prices (LMP data)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS energy_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iso TEXT NOT NULL,
      node TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      market_type TEXT NOT NULL,
      lmp REAL NOT NULL,
      energy_component REAL,
      congestion_component REAL,
      loss_component REAL,
      UNIQUE(iso, node, timestamp, market_type)
    )
  `);

  // Create index for fast time-range queries
  targetDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_energy_prices_lookup
    ON energy_prices(iso, node, market_type, timestamp)
  `);

  // System load data
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS system_load (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iso TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      actual_load REAL,
      forecast_load REAL,
      UNIQUE(iso, timestamp)
    )
  `);

  // Grid events / alerts
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS grid_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      iso TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      description TEXT,
      resolved_at TEXT
    )
  `);

  // Energy settings (user configuration)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS energy_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )
  `);

  // =========================================================================
  // Phase 3: Fleet hashprice tables
  // =========================================================================

  // Fleet configuration (user's ASIC fleet)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS fleet_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )
  `);

  // Fleet profitability snapshots (daily historical tracking)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS fleet_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      btc_price REAL,
      network_hashrate REAL,
      difficulty REAL,
      hashprice REAL,
      fleet_gross_revenue REAL,
      fleet_electricity_cost REAL,
      fleet_net_revenue REAL,
      fleet_profit_margin REAL,
      profitable_machines INTEGER,
      unprofitable_machines INTEGER,
      total_hashrate REAL,
      energy_cost_kwh REAL,
      snapshot_json TEXT
    )
  `);

  targetDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_fleet_snapshots_timestamp
    ON fleet_snapshots(timestamp)
  `);

  // Per-model snapshots (linked to fleet snapshots)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS machine_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fleet_snapshot_id INTEGER REFERENCES fleet_snapshots(id),
      model_id TEXT,
      quantity INTEGER,
      gross_revenue REAL,
      electricity_cost REAL,
      net_revenue REAL,
      profit_margin REAL,
      is_profitable INTEGER
    )
  `);

  // =========================================================================
  // Phase 4: Curtailment optimization tables
  // =========================================================================

  // Curtailment events log
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS curtailment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_type TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      duration_minutes INTEGER,
      machine_classes TEXT,
      energy_price_mwh REAL,
      estimated_savings REAL DEFAULT 0,
      reason TEXT,
      acknowledged INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_curtailment_events_start
    ON curtailment_events(start_time)
  `);

  // Curtailment daily performance tracking
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS curtailment_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      mining_hours REAL,
      curtailed_hours REAL,
      mining_revenue REAL,
      curtailment_savings REAL,
      avg_energy_price_mwh REAL,
      peak_energy_price_mwh REAL,
      curtailment_events INTEGER DEFAULT 0,
      fleet_state_summary TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE INDEX IF NOT EXISTS idx_curtailment_performance_date
    ON curtailment_performance(date)
  `);

  // Curtailment settings (user constraints)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS curtailment_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )
  `);

  // Add missing columns to curtailment_events (idempotent)
  const addColumn = (table, col, type) => {
    try { targetDb.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch (e) { /* already exists */ }
  };
  addColumn('curtailment_events', 'hashrate_online', 'REAL');
  addColumn('curtailment_events', 'hashrate_curtailed', 'REAL');
  addColumn('curtailment_events', 'machines_running', 'INTEGER');
  addColumn('curtailment_events', 'machines_curtailed', 'INTEGER');
  addColumn('curtailment_events', 'power_online_mw', 'REAL');
  addColumn('curtailment_events', 'power_curtailed_mw', 'REAL');
  addColumn('curtailment_events', 'savings_type', 'TEXT');

  // ─── Phase 5: Pool & On-Chain Tables ──────────────────────────────────────

  // Pool configuration (encrypted credentials)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS pool_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )
  `);

  // Pool hashrate history
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS pool_hashrate (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool TEXT NOT NULL,
      timestamp DATETIME NOT NULL,
      reported_hashrate REAL,
      avg_1h REAL,
      avg_24h REAL,
      avg_7d REAL,
      active_workers INTEGER,
      reject_rate REAL,
      stale_rate REAL,
      UNIQUE(pool, timestamp)
    )
  `);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_pool_hashrate_pool_ts ON pool_hashrate(pool, timestamp)`);

  // Pool earnings
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS pool_earnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool TEXT NOT NULL,
      date DATE NOT NULL,
      earned_btc REAL,
      earned_usd REAL,
      subsidy_btc REAL,
      fee_btc REAL,
      hashrate_avg REAL,
      effective_per_th REAL,
      UNIQUE(pool, date)
    )
  `);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_pool_earnings_pool_date ON pool_earnings(pool, date)`);

  // Pool payouts
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS pool_payouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool TEXT NOT NULL,
      timestamp DATETIME NOT NULL,
      amount_btc REAL,
      txid TEXT,
      address TEXT,
      status TEXT,
      confirmations INTEGER
    )
  `);

  // Worker snapshots (periodic)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS worker_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool TEXT NOT NULL,
      timestamp DATETIME NOT NULL,
      worker_id TEXT NOT NULL,
      hashrate REAL,
      status TEXT,
      reject_rate REAL,
      last_share DATETIME
    )
  `);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_worker_snapshots_pool_ts ON worker_snapshots(pool, timestamp)`);

  // On-chain blocks
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      height INTEGER NOT NULL UNIQUE,
      hash TEXT,
      timestamp DATETIME,
      size INTEGER,
      tx_count INTEGER,
      total_fees REAL,
      subsidy REAL,
      total_reward REAL,
      avg_fee_rate REAL,
      miner TEXT,
      time_since_last INTEGER
    )
  `);

  // Mempool snapshots
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS mempool_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME NOT NULL,
      size_bytes INTEGER,
      tx_count INTEGER,
      total_fees REAL,
      fee_next_block REAL,
      fee_half_hour REAL,
      fee_hour REAL,
      fee_economy REAL
    )
  `);

  // Fleet diagnostics log
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS diagnostic_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      details TEXT,
      resolved INTEGER DEFAULT 0,
      resolved_at DATETIME
    )
  `);

  // ─── Phase 6: Agent Framework Tables ──────────────────────────────────────

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      config_json TEXT,
      status TEXT DEFAULT 'stopped',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      timestamp DATETIME NOT NULL,
      phase TEXT NOT NULL,
      event_type TEXT NOT NULL,
      summary TEXT,
      details_json TEXT,
      financial_impact REAL,
      reasoning TEXT
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      created_at DATETIME NOT NULL,
      expires_at DATETIME,
      decision_json TEXT,
      reasoning TEXT,
      estimated_impact REAL,
      status TEXT DEFAULT 'pending',
      resolved_at DATETIME,
      resolved_by TEXT,
      rejection_reason TEXT
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      date DATE NOT NULL,
      observations INTEGER DEFAULT 0,
      recommendations INTEGER DEFAULT 0,
      actions_executed INTEGER DEFAULT 0,
      actions_approved INTEGER DEFAULT 0,
      actions_rejected INTEGER DEFAULT 0,
      actions_skipped INTEGER DEFAULT 0,
      value_generated REAL DEFAULT 0,
      avg_response_ms REAL,
      UNIQUE(agent_id, date)
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      report_type TEXT NOT NULL,
      period TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      data_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME NOT NULL,
      source TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT,
      action_url TEXT,
      read INTEGER DEFAULT 0,
      dismissed INTEGER DEFAULT 0
    )
  `);

  // Create indices for agent tables
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_agent_events_agent_ts ON agent_events(agent_id, timestamp)'); } catch (e) { /* exists */ }
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_agent_approvals_status ON agent_approvals(status)'); } catch (e) { /* exists */ }
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent_date ON agent_metrics(agent_id, date)'); } catch (e) { /* exists */ }
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read, dismissed)'); } catch (e) { /* exists */ }

  // ─── Agent Run History (eval / regression tracking) ─────────────────────────

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT UNIQUE NOT NULL,
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      user_id TEXT,
      thread_id TEXT,
      input TEXT NOT NULL,
      output TEXT,
      model TEXT,
      route TEXT DEFAULT 'api',
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      tools_used TEXT,
      duration_ms INTEGER,
      status TEXT DEFAULT 'completed' CHECK(status IN ('running', 'completed', 'failed', 'timeout')),
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_agent ON agent_runs(tenant_id, agent_id, created_at)'); } catch (e) { /* exists */ }
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_agent_runs_run_id ON agent_runs(run_id)'); } catch (e) { /* exists */ }

  // ─── Phase 7: HPC / AI Compute Abstraction Layer ────────────────────────────

  // Workload configuration (BTC + HPC workloads)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS workloads (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      site TEXT,
      energy_node TEXT,
      power_allocation_mw REAL DEFAULT 0,
      revenue_model_json TEXT,
      fleet_json TEXT,
      curtailment_profile_json TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // GPU fleet configuration
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS gpu_fleet_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config_json TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // HPC contracts
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS hpc_contracts (
      id TEXT PRIMARY KEY,
      customer TEXT NOT NULL,
      contract_type TEXT NOT NULL,
      gpu_model TEXT,
      gpu_count INTEGER,
      power_draw_mw REAL,
      rate_per_gpu_hr REAL,
      monthly_revenue REAL,
      uptime_sla REAL,
      interruptible INTEGER DEFAULT 0,
      curtailment_penalty REAL,
      curtailment_max_hours REAL,
      curtailment_notice_min INTEGER,
      start_date DATE,
      end_date DATE,
      auto_renew INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // HPC SLA tracking events
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS hpc_sla_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contract_id TEXT REFERENCES hpc_contracts(id),
      timestamp DATETIME NOT NULL,
      event_type TEXT NOT NULL,
      duration_minutes REAL,
      cause TEXT,
      penalty_amount REAL
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_hpc_sla_events_contract ON hpc_sla_events(contract_id, timestamp)'); } catch (e) { /* exists */ }

  // Workload daily snapshots (unified BTC + HPC tracking)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS workload_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      workload_id TEXT NOT NULL,
      workload_type TEXT NOT NULL,
      capacity_mw REAL,
      online_mw REAL,
      curtailed_mw REAL,
      gross_revenue REAL,
      energy_cost REAL,
      curtailment_savings REAL,
      curtailment_penalties REAL,
      net_revenue REAL,
      revenue_per_mw REAL,
      margin_percent REAL,
      UNIQUE(date, workload_id)
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_workload_snapshots_date ON workload_snapshots(date, workload_type)'); } catch (e) { /* exists */ }

  // GPU spot pricing history
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS gpu_spot_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME NOT NULL,
      gpu_model TEXT NOT NULL,
      provider TEXT,
      price_per_gpu_hr REAL,
      UNIQUE(timestamp, gpu_model, provider)
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_gpu_spot_prices_model ON gpu_spot_prices(gpu_model, timestamp)'); } catch (e) { /* exists */ }

  // Initialize Phase 8 multi-tenant tables
  initPhase8Tables(targetDb);

  // Initialize Phase 9 insurance tables
  initPhase9Tables(targetDb);

  // Initialize Phase 10 bot tables
  initBotTables(targetDb);

  // Initialize DACP Construction tables (schema only, not seed data)
  initDacpTablesSchema(targetDb);

  // Initialize tenant files table
  initFilesTable(targetDb);

  // Initialize Opus rate limiting table
  initOpusLimitsTable(targetDb);

  // Initialize background jobs + key vault tables
  initBackgroundJobsTables(targetDb);

  // Initialize activity log table
  initActivityLogTableSchema(targetDb);

  // Initialize processed emails dedup table
  initProcessedEmailsTable(targetDb);

  // Initialize auto-replies log table
  initAutoRepliesTable(targetDb);

  // Initialize email trust / anti-spoof tables
  initEmailTrustTables(targetDb);

  // Initialize report comments table
  initReportComments(targetDb);

  // Initialize accounting tables (QuickBooks / Bill.com)
  initAccountingTables(targetDb);

  // Drive sync tables (auto-scan + RAG)
  initDriveSyncTables(targetDb);

  // User Inbox Monitoring tables
  initUserInboxTables(targetDb);


  // =========================================================================
  // Portfolio Companies (Zhan Capital)
  // =========================================================================

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT,
      status TEXT DEFAULT 'active',
      description TEXT,
      tenant_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS company_email_accounts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES portfolio_companies(id),
      gmail_address TEXT NOT NULL,
      oauth_refresh_token TEXT,
      connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_synced_at DATETIME,
      is_active INTEGER DEFAULT 1,
      tenant_id TEXT NOT NULL
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS company_drive_folders (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL REFERENCES portfolio_companies(id),
      folder_id TEXT NOT NULL,
      folder_name TEXT,
      folder_url TEXT,
      connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_synced_at DATETIME,
      tenant_id TEXT NOT NULL
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS company_email_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id TEXT NOT NULL REFERENCES portfolio_companies(id),
      date TEXT NOT NULL,
      sent_count INTEGER DEFAULT 0,
      received_count INTEGER DEFAULT 0,
      draft_count INTEGER DEFAULT 0,
      tenant_id TEXT NOT NULL,
      UNIQUE(company_id, date)
    )
  `);

  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_portfolio_tenant ON portfolio_companies(tenant_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_company_email_company ON company_email_accounts(company_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_company_drive_company ON company_drive_folders(company_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_company_email_stats_company ON company_email_stats(company_id, date)'); } catch (e) {}
  // Initialize price alert rules table
  initPriceAlertRulesTable(targetDb);

  // Password reset tokens
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_pw_reset_hash ON password_resets(token_hash)'); } catch (e) {}

  // Scheduled tasks (cron-based automation)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'hivemind',
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cron_expression TEXT NOT NULL,
      timezone TEXT DEFAULT 'America/Chicago',
      enabled INTEGER DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT,
      run_count INTEGER DEFAULT 0,
      max_runs INTEGER,
      thread_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_tenant ON scheduled_tasks(tenant_id, enabled)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at, enabled)'); } catch (e) {}

  // Agent assignments - overnight autonomous analysis proposals
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_assignments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT 'estimating',
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      priority TEXT NOT NULL DEFAULT 'medium',
      action_prompt TEXT,
      context_json TEXT,
      status TEXT NOT NULL DEFAULT 'proposed',
      result_summary TEXT,
      thread_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      confirmed_at TEXT,
      completed_at TEXT,
      output_artifacts_json TEXT
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_agent_assignments_tenant ON agent_assignments(tenant_id, status)'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN output_artifacts_json TEXT'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN user_id TEXT'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_agent_assignments_user ON agent_assignments(tenant_id, user_id, status)'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN job_id TEXT'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN source_type TEXT'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN source_thread_id TEXT'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN knowledge_entry_ids_json TEXT'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN info_requests_pending INTEGER DEFAULT 0'); } catch (e) {}
  try { targetDb.exec("ALTER TABLE agent_assignments ADD COLUMN visibility TEXT DEFAULT 'private'"); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN full_response TEXT'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN shared_with_json TEXT'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN attached_entity_ids_json TEXT'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN input_fields_json TEXT'); } catch (e) {}
  try { targetDb.exec('ALTER TABLE agent_assignments ADD COLUMN input_values_json TEXT'); } catch (e) {}

  // CC thread tracking - auto-trigger assignments from accumulated observations
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS cc_thread_tracker (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      gmail_thread_id TEXT NOT NULL,
      subject TEXT,
      participants_json TEXT DEFAULT '[]',
      observation_count INTEGER DEFAULT 0,
      attachment_count INTEGER DEFAULT 0,
      first_observed_at TEXT DEFAULT (datetime('now')),
      last_observed_at TEXT DEFAULT (datetime('now')),
      auto_assignment_id TEXT,
      status TEXT DEFAULT 'accumulating'
    )
  `);
  try { targetDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_thread_tenant ON cc_thread_tracker(tenant_id, gmail_thread_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_cc_thread_status ON cc_thread_tracker(tenant_id, status)'); } catch (e) {}

  // MCP server configurations per tenant
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      transport TEXT NOT NULL CHECK(transport IN ('stdio', 'sse')),
      command TEXT,
      args_json TEXT DEFAULT '[]',
      env_json TEXT DEFAULT '{}',
      url TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_mcp_servers_tenant ON mcp_servers(tenant_id, enabled)'); } catch (e) {}

  // Add tenant_id to ALL existing tables (idempotent) - kept for defense-in-depth
  const tablesToMigrate = [
    'cache', 'alerts', 'alert_history', 'notes', 'imec_milestones',
    'datacenter_projects', 'fiber_deals', 'btc_wallets',
    'energy_prices', 'system_load', 'grid_events', 'energy_settings',
    'fleet_config', 'fleet_snapshots', 'machine_snapshots',
    'curtailment_events', 'curtailment_performance', 'curtailment_settings',
    'pool_config', 'pool_hashrate', 'pool_earnings', 'pool_payouts',
    'worker_snapshots', 'blocks', 'mempool_snapshots', 'diagnostic_events',
    'agents', 'agent_events', 'agent_approvals', 'agent_metrics', 'agent_reports',
    'notifications',
    'workloads', 'gpu_fleet_config', 'hpc_contracts', 'hpc_sla_events',
    'workload_snapshots', 'gpu_spot_prices'
  ];

  for (const table of tablesToMigrate) {
    try {
      targetDb.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT DEFAULT '${SANGHA_TENANT_ID}'`);
    } catch (e) {
      // Column already exists
    }
  }

  console.log('[DB] Schema initialized for DB');
}

// ─── System DB Schema ─────────────────────────────────────────────────────────
// The system DB only needs the tenants table for routing.
function initSystemSchema() {
  systemDb.exec(`
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
  systemDb.pragma('journal_mode = WAL');
  console.log('[DB] System schema initialized');
}

// ─── Main Init Entry Point ──────────────────────────────────────────────────
export function initDatabase() {
  // 1. Initialize system DB schema (tenants table)
  initSystemSchema();

  // 2. Ensure default + DACP tenants exist in systemDb
  seedTenantsInSystemDb();

  // 3. Get all tenants from systemDb
  const tenants = systemDb.prepare('SELECT * FROM tenants').all();
  console.log(`[DB] Found ${tenants.length} tenant(s): ${tenants.map(t => t.id).join(', ')}`);

  // 4. For each tenant, init schema + run integrity check
  for (const tenant of tenants) {
    const tdb = getTenantDb(tenant.id);

    // Integrity check
    try {
      const integrityResult = tdb.pragma('integrity_check');
      const isOk = integrityResult.length === 1 && integrityResult[0].integrity_check === 'ok';
      if (!isOk) {
        const errors = integrityResult.map(r => r.integrity_check).join('\n');
        console.error(`[DB] Integrity check FAILED for tenant ${tenant.id}:`, errors);
        process.exit(1);
      }
    } catch (err) {
      console.error(`[DB] Integrity check error for tenant ${tenant.id}:`, err.message);
      process.exit(1);
    }

    // Init all tables
    initSchemaForDb(tdb);

    // Migrate tenant_id = 'default' -> SANGHA_TENANT_ID in Sangha DB
    if (tenant.id === SANGHA_TENANT_ID) {
      migrateSanghaTenantId(tdb);
    }

    // Seed tenant-specific data (users, demo data, etc.)
    seedTenantData(tdb, tenant.id);

    console.log(`[DB] Tenant "${tenant.id}" initialized (${tenantDirName(tenant.id)}/${tenantDirName(tenant.id)}.db)`);
  }

  console.log('[DB] All databases initialized');
}

/** Migrate tenant_id from 'default' to SANGHA_TENANT_ID in existing Sangha DB rows */
function migrateSanghaTenantId(tdb) {
  // Check if any rows still have the old 'default' tenant_id
  const check = tdb.prepare("SELECT COUNT(*) as c FROM users WHERE tenant_id = 'default'").get();
  if (!check || check.c === 0) return; // Already migrated or fresh DB

  console.log(`[DB] Migrating Sangha tenant_id 'default' -> '${SANGHA_TENANT_ID}' ...`);

  // All tables that have a tenant_id column
  const tables = tdb.prepare(`
    SELECT DISTINCT m.name FROM sqlite_master m
    JOIN pragma_table_info(m.name) p ON p.name = 'tenant_id'
    WHERE m.type = 'table'
  `).all().map(r => r.name);

  let totalUpdated = 0;
  for (const table of tables) {
    try {
      const result = tdb.prepare(`UPDATE ${table} SET tenant_id = ? WHERE tenant_id = 'default'`).run(SANGHA_TENANT_ID);
      if (result.changes > 0) {
        console.log(`[DB]   ${table}: ${result.changes} rows updated`);
        totalUpdated += result.changes;
      }
    } catch (e) {
      // Some tables may not exist yet or have constraints
    }
  }

  if (totalUpdated > 0) {
    console.log(`[DB] Migration complete: ${totalUpdated} total rows updated across ${tables.length} tables`);
  }
}

function seedTenantsInSystemDb() {
  // Migrate: rename 'default' tenant to 'sangha-renewables' if old ID still exists
  const oldDefault = systemDb.prepare('SELECT id FROM tenants WHERE id = ?').get('default');
  if (oldDefault) {
    systemDb.prepare(`UPDATE tenants SET id = ?, slug = 'sangha' WHERE id = 'default'`).run(SANGHA_TENANT_ID);
    console.log(`[DB] Migrated tenant 'default' -> '${SANGHA_TENANT_ID}'`);
  }

  // Create Sangha Renewables tenant if not exists
  const sanghaTenant = systemDb.prepare('SELECT id FROM tenants WHERE id = ?').get(SANGHA_TENANT_ID);
  if (!sanghaTenant) {
    systemDb.prepare(`
      INSERT INTO tenants (id, name, slug, plan, status, settings_json, limits_json)
      VALUES (?, 'Sangha Renewables', 'sangha', 'professional', 'active', ?, ?)
    `).run(SANGHA_TENANT_ID,
      JSON.stringify({
        industry: 'mining',
        macro_intelligence: true,
        correlations: true,
        liquidity: true,
        hpc_enabled: false,
        thread_privacy: true,
      }),
      JSON.stringify({
        maxUsers: 50,
        maxSites: 10,
        maxWorkloads: 100,
        maxAgents: 20,
        apiRateLimit: 120,
        dataRetentionDays: 365,
      })
    );
    console.log(`[DB] Sangha tenant created in systemDb: ${SANGHA_TENANT_ID}`);
  }

  // Fix: ensure tenant name is correct
  systemDb.prepare(`UPDATE tenants SET name = 'Sangha Renewables' WHERE id = ? AND name = 'Default Organization'`).run(SANGHA_TENANT_ID);

  // Create DACP tenant if not exists
  const dacpTenant = systemDb.prepare('SELECT id FROM tenants WHERE id = ?').get('dacp-construction-001');
  if (!dacpTenant) {
    systemDb.prepare(`
      INSERT INTO tenants (id, name, slug, plan, status, branding_json, settings_json, limits_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'dacp-construction-001', 'DACP Construction', 'dacp', 'professional', 'active',
      JSON.stringify({ companyName: 'DACP', primaryColor: '#1e3a5f', secondaryColor: '#d4cdc5', hideSanghaBranding: true }),
      JSON.stringify({ industry: 'construction', defaultOverheadPct: 10, defaultProfitPct: 15, region: 'Texas', auto_reply_enabled: true }),
      JSON.stringify({ maxUsers: 25, maxSites: 5, maxWorkloads: 50, maxAgents: 10, apiRateLimit: 120, dataRetentionDays: 365 })
    );
    console.log('[DB] DACP tenant created in systemDb');
  }

  // Create Zhan Capital tenant if not exists
  const zhanTenant = systemDb.prepare('SELECT id FROM tenants WHERE id = ?').get('zhan-capital');
  if (!zhanTenant) {
    systemDb.prepare(`
      INSERT INTO tenants (id, name, slug, plan, status, branding_json, settings_json, limits_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'zhan-capital', 'Zhan Capital', 'zhan', 'enterprise', 'active',
      JSON.stringify({ companyName: 'Zhan Capital', primaryColor: '#141414', sidebarColor: '#0e0e0e', hideSanghaBranding: true }),
      JSON.stringify({ industry: 'venture', show_portfolio: true, auto_reply_enabled: true }),
      JSON.stringify({ maxUsers: 50, maxSites: 10, maxWorkloads: 100, maxAgents: 20, apiRateLimit: 120, dataRetentionDays: 365 })
    );
    console.log('[DB] Zhan Capital tenant created in systemDb');
  }

  // Backfill settings_json for existing Sangha tenant if missing
  const existingSangha = systemDb.prepare('SELECT settings_json FROM tenants WHERE id = ?').get(SANGHA_TENANT_ID);
  if (existingSangha && !existingSangha.settings_json) {
    systemDb.prepare('UPDATE tenants SET settings_json = ? WHERE id = ?').run(
      JSON.stringify({
        industry: 'mining',
        macro_intelligence: true,
        correlations: true,
        liquidity: true,
        hpc_enabled: false,
        thread_privacy: true,
        auto_reply_enabled: true,
      }),
      SANGHA_TENANT_ID
    );
  }

  // Backfill settings_json for Zhan Capital - ensure industry: 'venture' is set
  const existingZhan = systemDb.prepare('SELECT settings_json FROM tenants WHERE id = ?').get('zhan-capital');
  if (existingZhan) {
    const zhanSettings = existingZhan.settings_json ? JSON.parse(existingZhan.settings_json) : {};
    if (!zhanSettings.industry) {
      zhanSettings.industry = 'venture';
      zhanSettings.show_portfolio = true;
      systemDb.prepare('UPDATE tenants SET settings_json = ? WHERE id = ?').run(
        JSON.stringify(zhanSettings),
        'zhan-capital'
      );
      console.log('[DB] Backfilled Zhan Capital settings with industry: venture');
    }
  }
}

function seedTenantData(targetDb, tenantId) {
  // Seed admin users, demo data, etc. into tenant DB
  // This also creates a tenants table in each tenant DB (for joins that reference it)

  // Create tenants table in tenant DB (defense-in-depth - some queries JOIN on it)
  targetDb.exec(`
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

  // Copy this tenant's row from systemDb into tenant DB
  const tenantRow = systemDb.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (tenantRow) {
    targetDb.prepare(`
      INSERT OR REPLACE INTO tenants (id, name, slug, plan, status, branding_json, settings_json, limits_json, created_at, trial_ends_at, updated_at, custom_domain)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tenantRow.id, tenantRow.name, tenantRow.slug, tenantRow.plan, tenantRow.status,
      tenantRow.branding_json, tenantRow.settings_json, tenantRow.limits_json,
      tenantRow.created_at, tenantRow.trial_ends_at, tenantRow.updated_at, tenantRow.custom_domain);
  }

  // Seed admin user for Sangha tenant
  if (tenantId === SANGHA_TENANT_ID) {
    const adminUser = targetDb.prepare('SELECT id FROM users WHERE email = ?').get('teo@zhan.capital');
    if (!adminUser) {
      const salt = bcryptPkg.genSaltSync(12);
      const hash = bcryptPkg.hashSync(process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(24).toString('base64'), salt);
      targetDb.prepare(`
        INSERT OR IGNORE INTO users (id, email, name, password_hash, tenant_id, role, status)
        VALUES ('seed-admin-001', 'teo@zhan.capital', 'Teo Blind', ?, ?, 'sangha_admin', 'active')
      `).run(hash, SANGHA_TENANT_ID);
      console.log('[DB] Seed admin user created: teo@zhan.capital');
    }
  }

  // Seed DACP admin user
  if (tenantId === 'dacp-construction-001') {
    const dacpAdmin = targetDb.prepare('SELECT id FROM users WHERE id = ?').get('dacp-admin-001');
    if (!dacpAdmin) {
      const salt = bcryptPkg.genSaltSync(12);
      const hash = bcryptPkg.hashSync(process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(24).toString('base64'), salt);
      targetDb.prepare(`
        INSERT INTO users (id, email, name, password_hash, tenant_id, role, status)
        VALUES ('dacp-admin-001', 'admin@dacpconstruction.com', 'DACP Admin', ?, 'dacp-construction-001', 'owner', 'active')
      `).run(hash);
      console.log('[DB] DACP admin user created: admin@dacpconstruction.com');
    }
  }

  // Seed Zhan Capital admin user + portfolio companies
  if (tenantId === 'zhan-capital') {
    const zhanAdmin = targetDb.prepare('SELECT id FROM users WHERE email = ?').get('teo@zhan.capital');
    if (!zhanAdmin) {
      const salt = bcryptPkg.genSaltSync(12);
      const hash = bcryptPkg.hashSync(process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(24).toString('base64'), salt);
      targetDb.prepare(`
        INSERT INTO users (id, email, name, password_hash, tenant_id, role, status)
        VALUES ('zhan-admin-001', 'teo@zhan.capital', 'Teo Blind', ?, 'zhan-capital', 'owner', 'active')
      `).run(hash);
      console.log('[DB] Zhan Capital admin user created: teo@zhan.capital');
    }

    // Seed portfolio companies
    const companyCount = targetDb.prepare('SELECT COUNT(*) as c FROM portfolio_companies WHERE tenant_id = ?').get('zhan-capital');
    if (companyCount.c === 0) {
      const insertCompany = targetDb.prepare(`
        INSERT OR IGNORE INTO portfolio_companies (id, name, type, status, description, tenant_id)
        VALUES (?, ?, ?, ?, ?, 'zhan-capital')
      `);
      insertCompany.run('pc-coppice', 'Coppice AI', 'Vertical AI SaaS', 'active', 'AI-powered multi-tenant operations platform for industrial businesses');
      insertCompany.run('pc-volt', 'Volt Charging', 'Portable Charging', 'pilot', 'Rentable portable phone charger kiosks for hospitality and entertainment venues');
      insertCompany.run('pc-sangha', 'Sangha Renewables', 'Bitcoin Mining / Energy', 'partner', 'Behind-the-meter bitcoin mining and renewable energy optimization');
      console.log('[DB] Zhan Capital portfolio companies seeded');
    }
  }

  // Seed demo data via the existing initDacpTables seed logic (called per-tenant)
  initDacpSeedData(targetDb, tenantId);

  // Activity log seed data disabled - dashboards now show EmptyState when empty

  // Seed trusted senders for email guard
  initEmailTrustSeedData(targetDb, tenantId);
}

function initEmailTrustSeedData(targetDb, tenantId) {
  const count = targetDb.prepare('SELECT COUNT(*) as c FROM email_trusted_senders WHERE tenant_id = ?').get(tenantId);
  if (count.c > 0) return;

  const insert = targetDb.prepare(
    'INSERT OR IGNORE INTO email_trusted_senders (tenant_id, email, domain, display_name, trust_level, notes) VALUES (?, ?, ?, ?, ?, ?)'
  );

  // Platform owners - observe-only unless explicitly addressed
  insert.run(tenantId, 'teo@zhan.capital', null, 'Teo Blind', 'owner', 'Platform owner - Zhan Capital');
  insert.run(tenantId, 'teo.blind@gmail.com', null, 'Teo Blind', 'owner', 'Platform owner - personal Gmail');

  if (tenantId === SANGHA_TENANT_ID) {
    // Sangha internal team - trust by domain and key individuals
    insert.run(SANGHA_TENANT_ID, null, 'sanghasystems.com', null, 'trusted', 'Sangha Systems internal domain');
    insert.run(SANGHA_TENANT_ID, null, 'zhan.capital', null, 'trusted', 'Zhan Capital internal domain');
    insert.run(SANGHA_TENANT_ID, 'spencer@sanghasystems.com', null, 'Spencer Marr', 'owner', 'CEO - Sangha');
    console.log('Email trust: Seeded Sangha trusted senders');
  }

  if (tenantId === 'dacp-construction-001') {
    // DACP owner
    insert.run('dacp-construction-001', 'mpineda@dacpholdings.com', null, 'Marcel Pineda', 'owner', 'CEO - DACP Holdings');
    // DACP key GC contacts - trust by domain for known GCs
    insert.run('dacp-construction-001', null, 'turnerconstruction.com', null, 'trusted', 'Turner Construction - active GC partner');
    insert.run('dacp-construction-001', null, 'dpr.com', null, 'trusted', 'DPR Construction - active GC partner');
    insert.run('dacp-construction-001', null, 'austin-ind.com', null, 'trusted', 'Austin Commercial - active GC partner');
    insert.run('dacp-construction-001', null, 'mccarthy.com', null, 'trusted', 'McCarthy Building - prospective GC');
    insert.run('dacp-construction-001', null, 'henselphelps.com', null, 'trusted', 'Hensel Phelps - prospective GC');
    insert.run('dacp-construction-001', null, 'usa.skanska.com', null, 'trusted', 'Skanska USA - prospective GC');
    insert.run('dacp-construction-001', 'admin@dacpconstruction.com', null, 'DACP Admin', 'trusted', 'Internal admin account');
    console.log('Email trust: Seeded DACP trusted senders');
  }
}

// Auto-init on import so tables exist before other modules prepare statements
initDatabase();

// Cache helpers
export function getCache(key) {
  const stmt = db.prepare('SELECT * FROM cache WHERE key = ?');
  const row = stmt.get(key);

  if (!row) return null;

  const now = new Date();
  const expiresAt = new Date(row.expires_at);
  const data = JSON.parse(row.data);

  return {
    data,
    fetchedAt: row.fetched_at,
    stale: now > expiresAt
  };
}

export function setCache(key, data, ttlMinutes = 60) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO cache (key, data, fetched_at, expires_at)
    VALUES (?, ?, ?, ?)
  `);

  stmt.run(key, JSON.stringify(data), now.toISOString(), expiresAt.toISOString());
}

// Manual data helpers
export function addManualData(category, metric, value, date, notes = null) {
  const stmt = db.prepare(`
    INSERT INTO manual_data (category, metric, value, date, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(category, metric, value, date, notes);
}

export function getManualData(category, metric = null, startDate = null, endDate = null) {
  let query = 'SELECT * FROM manual_data WHERE category = ?';
  const params = [category];

  if (metric) {
    query += ' AND metric = ?';
    params.push(metric);
  }

  if (startDate) {
    query += ' AND date >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND date <= ?';
    params.push(endDate);
  }

  query += ' ORDER BY date DESC';

  return db.prepare(query).all(...params);
}

// Alert helpers
export function getAlerts() {
  return db.prepare('SELECT * FROM alerts WHERE enabled = 1').all();
}

export function addAlert(metric, condition, threshold, webhookUrl = null) {
  const stmt = db.prepare(`
    INSERT INTO alerts (metric, condition, threshold, webhook_url)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(metric, condition, threshold, webhookUrl);
}

export function updateAlert(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  const stmt = db.prepare(`UPDATE alerts SET ${fields} WHERE id = ?`);
  return stmt.run(...values, id);
}

export function deleteAlert(id) {
  return db.prepare('DELETE FROM alerts WHERE id = ?').run(id);
}

export function logAlertTrigger(alertId, value) {
  const stmt = db.prepare(`
    INSERT INTO alert_history (alert_id, value)
    VALUES (?, ?)
  `);
  stmt.run(alertId, value);

  db.prepare('UPDATE alerts SET last_triggered = CURRENT_TIMESTAMP WHERE id = ?').run(alertId);
}

// Notes helpers
export function getNotes(panel = null) {
  if (panel) {
    return db.prepare('SELECT * FROM notes WHERE panel = ? ORDER BY created_at DESC').all(panel);
  }
  return db.prepare('SELECT * FROM notes ORDER BY created_at DESC').all();
}

export function addNote(title, content, panel = null, tags = null) {
  const stmt = db.prepare(`
    INSERT INTO notes (title, content, panel, tags)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(title, content, panel, tags);
}

export function updateNote(id, title, content, panel = null, tags = null) {
  const stmt = db.prepare(`
    UPDATE notes SET title = ?, content = ?, panel = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  return stmt.run(title, content, panel, tags, id);
}

export function deleteNote(id) {
  return db.prepare('DELETE FROM notes WHERE id = ?').run(id);
}

// BTC Wallet helpers
export function getBtcWallets() {
  return db.prepare('SELECT * FROM btc_wallets').all();
}

export function addBtcWallet(address, label, description = null) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO btc_wallets (address, label, description)
    VALUES (?, ?, ?)
  `);
  return stmt.run(address, label, description);
}

// IMEC milestone helpers
export function getImecMilestones() {
  return db.prepare('SELECT * FROM imec_milestones ORDER BY date').all();
}

export function addImecMilestone(title, description, date, status = 'planned') {
  const stmt = db.prepare(`
    INSERT INTO imec_milestones (title, description, date, status)
    VALUES (?, ?, ?, ?)
  `);
  return stmt.run(title, description, date, status);
}

export function updateImecMilestone(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  const stmt = db.prepare(`UPDATE imec_milestones SET ${fields} WHERE id = ?`);
  return stmt.run(...values, id);
}

// Data center project helpers
export function getDatacenterProjects(region = null) {
  if (region) {
    return db.prepare('SELECT * FROM datacenter_projects WHERE region = ? ORDER BY expected_online').all(region);
  }
  return db.prepare('SELECT * FROM datacenter_projects ORDER BY region, expected_online').all();
}

export function addDatacenterProject(project) {
  const stmt = db.prepare(`
    INSERT INTO datacenter_projects (company, location, region, capacity_mw, status, expected_online, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(
    project.company,
    project.location,
    project.region,
    project.capacity_mw,
    project.status,
    project.expected_online,
    project.notes
  );
}

// Fiber deal helpers
export function getFiberDeals() {
  return db.prepare('SELECT * FROM fiber_deals ORDER BY date DESC').all();
}

export function addFiberDeal(deal) {
  const stmt = db.prepare(`
    INSERT INTO fiber_deals (date, buyer, seller, value_usd, capacity, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(deal.date, deal.buyer, deal.seller, deal.value_usd, deal.capacity, deal.description);
}

// =========================================================================
// Phase 2: Energy data helpers
// =========================================================================

export function insertEnergyPrices(records) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO energy_prices (iso, node, timestamp, market_type, lmp, energy_component, congestion_component, loss_component)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      stmt.run(r.iso, r.node, r.timestamp, r.market_type, r.lmp, r.energy_component, r.congestion_component, r.loss_component);
    }
  });

  insertMany(records);
  return records.length;
}

export function getEnergyPrices(iso, node, startDate, endDate, marketType = 'realtime') {
  return db.prepare(`
    SELECT * FROM energy_prices
    WHERE iso = ? AND node = ? AND timestamp >= ? AND timestamp <= ? AND market_type = ?
    ORDER BY timestamp ASC
  `).all(iso, node, startDate, endDate, marketType);
}

export function insertSystemLoad(iso, timestamp, actualLoad, forecastLoad = null) {
  return db.prepare(`
    INSERT OR REPLACE INTO system_load (iso, timestamp, actual_load, forecast_load)
    VALUES (?, ?, ?, ?)
  `).run(iso, timestamp, actualLoad, forecastLoad);
}

export function getSystemLoad(iso, startDate, endDate) {
  return db.prepare(`
    SELECT * FROM system_load
    WHERE iso = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(iso, startDate, endDate);
}

export function insertGridEvent(iso, timestamp, eventType, description) {
  return db.prepare(`
    INSERT INTO grid_events (iso, timestamp, event_type, description)
    VALUES (?, ?, ?, ?)
  `).run(iso, timestamp, eventType, description);
}

export function getGridEvents(iso, days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT * FROM grid_events
    WHERE iso = ? AND timestamp >= ?
    ORDER BY timestamp DESC
  `).all(iso, since);
}

export function getEnergySettings() {
  const row = db.prepare('SELECT data FROM energy_settings WHERE id = 1').get();
  return row ? JSON.parse(row.data) : null;
}

export function saveEnergySettings(settings) {
  return db.prepare(`
    INSERT OR REPLACE INTO energy_settings (id, data)
    VALUES (1, ?)
  `).run(JSON.stringify(settings));
}

// =========================================================================
// Phase 3: Fleet hashprice helpers
// =========================================================================

export function getFleetConfig() {
  const row = db.prepare('SELECT data FROM fleet_config WHERE id = 1').get();
  return row ? JSON.parse(row.data) : null;
}

export function saveFleetConfig(config) {
  return db.prepare(`
    INSERT OR REPLACE INTO fleet_config (id, data)
    VALUES (1, ?)
  `).run(JSON.stringify(config));
}

export function insertFleetSnapshot(snapshot, machineDetails = []) {
  const insertSnapshot = db.prepare(`
    INSERT INTO fleet_snapshots (timestamp, btc_price, network_hashrate, difficulty, hashprice,
      fleet_gross_revenue, fleet_electricity_cost, fleet_net_revenue, fleet_profit_margin,
      profitable_machines, unprofitable_machines, total_hashrate, energy_cost_kwh, snapshot_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMachine = db.prepare(`
    INSERT INTO machine_snapshots (fleet_snapshot_id, model_id, quantity, gross_revenue,
      electricity_cost, net_revenue, profit_margin, is_profitable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const result = insertSnapshot.run(
      snapshot.timestamp, snapshot.btcPrice, snapshot.networkHashrate,
      snapshot.difficulty, snapshot.hashprice, snapshot.fleetGrossRevenue,
      snapshot.fleetElectricityCost, snapshot.fleetNetRevenue, snapshot.fleetProfitMargin,
      snapshot.profitableMachines, snapshot.unprofitableMachines,
      snapshot.totalHashrate, snapshot.energyCostKwh, snapshot.snapshotJson
    );

    const snapshotId = result.lastInsertRowid;
    for (const m of machineDetails) {
      insertMachine.run(
        snapshotId, m.model?.id || m.model?.model, m.quantity,
        m.grossRevenue * m.quantity, m.electricityCost * m.quantity,
        m.netRevenue * m.quantity, m.profitMargin, m.isProfitable ? 1 : 0
      );
    }

    return snapshotId;
  });

  return transaction();
}

export function getFleetSnapshots(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT * FROM fleet_snapshots
    WHERE timestamp >= ?
    ORDER BY timestamp ASC
  `).all(since);
}

// =========================================================================
// Phase 4: Curtailment helpers
// =========================================================================

export function getCurtailmentEvents(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT * FROM curtailment_events
    WHERE start_time >= ?
    ORDER BY start_time DESC
  `).all(since);
}

export function insertCurtailmentEvent(event) {
  const stmt = db.prepare(`
    INSERT INTO curtailment_events
      (trigger_type, start_time, end_time, duration_minutes, machine_classes,
       energy_price_mwh, estimated_savings, reason, acknowledged,
       hashrate_online, hashrate_curtailed, machines_running, machines_curtailed,
       power_online_mw, power_curtailed_mw, savings_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    event.triggerType, event.startTime, event.endTime,
    event.durationMinutes, event.machineClasses,
    event.energyPriceMWh, event.estimatedSavings,
    event.reason, event.acknowledged || 0,
    event.hashrateOnline || null, event.hashrateCurtailed || null,
    event.machinesRunning || null, event.machinesCurtailed || null,
    event.powerOnlineMW || null, event.powerCurtailedMW || null,
    event.savingsType || null
  );
  return result.lastInsertRowid;
}

export function acknowledgeCurtailmentEvent(id) {
  return db.prepare(
    'UPDATE curtailment_events SET acknowledged = 1 WHERE id = ?'
  ).run(id);
}

export function getCurtailmentPerformance(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return db.prepare(`
    SELECT * FROM curtailment_performance
    WHERE date >= ?
    ORDER BY date ASC
  `).all(since);
}

export function insertCurtailmentPerformance(perf) {
  return db.prepare(`
    INSERT OR REPLACE INTO curtailment_performance
      (date, mining_hours, curtailed_hours, mining_revenue, curtailment_savings,
       avg_energy_price_mwh, peak_energy_price_mwh, curtailment_events, fleet_state_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    perf.date, perf.miningHours, perf.curtailedHours,
    perf.miningRevenue, perf.curtailmentSavings,
    perf.avgEnergyPriceMWh, perf.peakEnergyPriceMWh,
    perf.curtailmentEvents, perf.fleetStateSummary
  );
}

export function getCurtailmentSettings() {
  const row = db.prepare('SELECT data FROM curtailment_settings WHERE id = 1').get();
  return row ? JSON.parse(row.data) : null;
}

export function saveCurtailmentSettings(settings) {
  return db.prepare(`
    INSERT OR REPLACE INTO curtailment_settings (id, data)
    VALUES (1, ?)
  `).run(JSON.stringify(settings));
}

// ─── Phase 5: Pool & On-Chain Helpers ──────────────────────────────────────

// Pool config
export function getPoolConfig() {
  const row = db.prepare('SELECT data FROM pool_config WHERE id = 1').get();
  return row ? JSON.parse(row.data) : { pools: [], settings: {} };
}

export function savePoolConfig(config) {
  return db.prepare(`
    INSERT OR REPLACE INTO pool_config (id, data) VALUES (1, ?)
  `).run(JSON.stringify(config));
}

// Pool hashrate
export function insertPoolHashrate(record) {
  return db.prepare(`
    INSERT OR REPLACE INTO pool_hashrate
      (pool, timestamp, reported_hashrate, avg_1h, avg_24h, avg_7d, active_workers, reject_rate, stale_rate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(record.pool, record.timestamp, record.reportedHashrate, record.avg1h, record.avg24h, record.avg7d, record.activeWorkers, record.rejectRate, record.staleRate);
}

export function getPoolHashrateHistory(pool, days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT * FROM pool_hashrate WHERE pool = ? AND timestamp >= ? ORDER BY timestamp ASC
  `).all(pool, since);
}

// Pool earnings
export function insertPoolEarning(record) {
  return db.prepare(`
    INSERT OR REPLACE INTO pool_earnings
      (pool, date, earned_btc, earned_usd, subsidy_btc, fee_btc, hashrate_avg, effective_per_th)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(record.pool, record.date, record.earnedBtc, record.earnedUsd, record.subsidyBtc, record.feeBtc, record.hashrateAvg, record.effectivePerTh);
}

export function getPoolEarningsHistory(pool, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return db.prepare(`
    SELECT * FROM pool_earnings WHERE pool = ? AND date >= ? ORDER BY date ASC
  `).all(pool, since);
}

// Pool payouts
export function insertPoolPayout(record) {
  return db.prepare(`
    INSERT INTO pool_payouts (pool, timestamp, amount_btc, txid, address, status, confirmations)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(record.pool, record.timestamp, record.amountBtc, record.txid, record.address, record.status, record.confirmations);
}

export function getPoolPayouts(pool, limit = 50) {
  return db.prepare(`
    SELECT * FROM pool_payouts WHERE pool = ? ORDER BY timestamp DESC LIMIT ?
  `).all(pool, limit);
}

// Worker snapshots
export function insertWorkerSnapshot(record) {
  return db.prepare(`
    INSERT INTO worker_snapshots (pool, timestamp, worker_id, hashrate, status, reject_rate, last_share)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(record.pool, record.timestamp, record.workerId, record.hashrate, record.status, record.rejectRate, record.lastShare);
}

export function getLatestWorkerSnapshots(pool) {
  return db.prepare(`
    SELECT ws.* FROM worker_snapshots ws
    INNER JOIN (
      SELECT worker_id, MAX(timestamp) as max_ts FROM worker_snapshots WHERE pool = ? GROUP BY worker_id
    ) latest ON ws.worker_id = latest.worker_id AND ws.timestamp = latest.max_ts
    WHERE ws.pool = ?
    ORDER BY ws.hashrate DESC
  `).all(pool, pool);
}

// Blocks
export function insertBlock(block) {
  return db.prepare(`
    INSERT OR REPLACE INTO blocks
      (height, hash, timestamp, size, tx_count, total_fees, subsidy, total_reward, avg_fee_rate, miner, time_since_last)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(block.height, block.hash, block.timestamp, block.size, block.txCount, block.totalFees, block.subsidy, block.totalReward, block.avgFeeRate, block.miner, block.timeSinceLast);
}

export function getRecentBlocks(count = 10) {
  return db.prepare(`
    SELECT * FROM blocks ORDER BY height DESC LIMIT ?
  `).all(count);
}

// Mempool snapshots
export function insertMempoolSnapshot(snapshot) {
  return db.prepare(`
    INSERT INTO mempool_snapshots
      (timestamp, size_bytes, tx_count, total_fees, fee_next_block, fee_half_hour, fee_hour, fee_economy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(snapshot.timestamp, snapshot.sizeBytes, snapshot.txCount, snapshot.totalFees, snapshot.feeNextBlock, snapshot.feeHalfHour, snapshot.feeHour, snapshot.feeEconomy);
}

export function getMempoolHistory(hours = 24) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  return db.prepare(`
    SELECT * FROM mempool_snapshots WHERE timestamp >= ? ORDER BY timestamp ASC
  `).all(since);
}

// Diagnostic events
export function insertDiagnosticEvent(event) {
  return db.prepare(`
    INSERT INTO diagnostic_events (timestamp, type, severity, details)
    VALUES (?, ?, ?, ?)
  `).run(event.timestamp, event.type, event.severity, JSON.stringify(event.details));
}

export function getDiagnosticEvents(days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT * FROM diagnostic_events WHERE timestamp >= ? ORDER BY timestamp DESC
  `).all(since);
}

// Grid events also accessible via getGridEvents() above (Phase 2)

// ─── Phase 6: Agent Framework Helpers ────────────────────────────────────────

// Agent CRUD
export function getAgentRow(agentId) {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
}

/**
 * Get the operational mode for an agent: 'autonomous' | 'copilot' | 'off'.
 * Checks agents table first, then falls back to tenant settings_json.agents map.
 */
export function getAgentMode(agentId) {
  // 1. Check agents table (runtime-registered agents)
  const row = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(agentId);
  if (row && row.config_json) {
    try {
      const config = JSON.parse(row.config_json);
      if (config.mode) return config.mode;
    } catch {}
  }

  // 2. Fall back to tenant settings_json.agents map
  const tenantRow = db.prepare('SELECT settings_json FROM tenants LIMIT 1').get();
  if (tenantRow && tenantRow.settings_json) {
    try {
      const settings = JSON.parse(tenantRow.settings_json);
      const agentModes = settings.agents || {};
      if (agentModes[agentId]) return agentModes[agentId];
    } catch {}
  }

  return 'autonomous';
}

export function getAllAgentRows() {
  return db.prepare('SELECT * FROM agents ORDER BY created_at').all();
}

export function upsertAgent(id, name, category, configJson, status = 'stopped') {
  db.prepare(`
    INSERT INTO agents (id, name, category, config_json, status, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      config_json = excluded.config_json,
      status = excluded.status,
      updated_at = datetime('now')
  `).run(id, name, category, JSON.stringify(configJson), status);
}

export function updateAgentStatus(agentId, status) {
  db.prepare('UPDATE agents SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, agentId);
}

export function updateAgentConfig(agentId, configJson) {
  db.prepare('UPDATE agents SET config_json = ?, updated_at = datetime(\'now\') WHERE id = ?').run(JSON.stringify(configJson), agentId);
}

// Agent Events
export function insertAgentEvent(agentId, phase, eventType, summary, detailsJson = null, financialImpact = null, reasoning = null) {
  return db.prepare(`
    INSERT INTO agent_events (agent_id, timestamp, phase, event_type, summary, details_json, financial_impact, reasoning)
    VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?)
  `).run(agentId, phase, eventType, summary, detailsJson ? JSON.stringify(detailsJson) : null, financialImpact, reasoning);
}

export function getAgentEvents(agentId, limit = 50) {
  return db.prepare(`
    SELECT * FROM agent_events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ?
  `).all(agentId, limit);
}

export function getAllAgentEvents(limit = 100, agentFilter = null, typeFilter = null) {
  let sql = 'SELECT * FROM agent_events WHERE 1=1';
  const params = [];
  if (agentFilter) { sql += ' AND agent_id = ?'; params.push(agentFilter); }
  if (typeFilter) { sql += ' AND event_type = ?'; params.push(typeFilter); }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

// Agent Approvals
export function insertAgentApproval(agentId, decisionJson, reasoning, estimatedImpact, expiresAt = null) {
  const result = db.prepare(`
    INSERT INTO agent_approvals (agent_id, created_at, expires_at, decision_json, reasoning, estimated_impact, status)
    VALUES (?, datetime('now'), ?, ?, ?, ?, 'pending')
  `).run(agentId, expiresAt, JSON.stringify(decisionJson), reasoning, estimatedImpact);
  return result.lastInsertRowid;
}

export function getPendingApprovals() {
  return db.prepare(`
    SELECT ap.*, a.name as agent_name FROM agent_approvals ap
    LEFT JOIN agents a ON ap.agent_id = a.id
    WHERE ap.status = 'pending'
    ORDER BY ap.created_at DESC
  `).all();
}

export function getApproval(approvalId) {
  return db.prepare(`
    SELECT ap.*, a.name as agent_name FROM agent_approvals ap
    LEFT JOIN agents a ON ap.agent_id = a.id
    WHERE ap.id = ?
  `).get(approvalId);
}

export function resolveApproval(approvalId, status, resolvedBy = 'operator', rejectionReason = null) {
  db.prepare(`
    UPDATE agent_approvals
    SET status = ?, resolved_at = datetime('now'), resolved_by = ?, rejection_reason = ?
    WHERE id = ?
  `).run(status, resolvedBy, rejectionReason, approvalId);
}

export function insertApprovalItem({ tenantId, agentId, title, description, type, payloadJson }) {
  return db.prepare(`
    INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(tenantId, agentId, title, description, type, payloadJson);
}

export function getApprovalItem(tenantId, id) {
  return db.prepare('SELECT * FROM approval_items WHERE id = ? AND tenant_id = ?').get(id, tenantId);
}

export function updateApprovalPayload(tenantId, id, payloadJson, title) {
  const updates = ['payload_json = ?'];
  const params = [payloadJson];
  if (title) { updates.push('title = ?'); params.push(title); }
  params.push(id, tenantId);
  return db.prepare(`UPDATE approval_items SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ? AND status = 'pending'`).run(...params);
}

export function expireOldApprovals() {
  const result = db.prepare(`
    UPDATE agent_approvals
    SET status = 'expired', resolved_at = datetime('now'), resolved_by = 'auto-expired'
    WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < datetime('now')
  `).run();
  return result.changes;
}

// Agent Metrics
export function upsertAgentMetrics(agentId, date, metrics) {
  db.prepare(`
    INSERT INTO agent_metrics (agent_id, date, observations, recommendations, actions_executed, actions_approved, actions_rejected, actions_skipped, value_generated, avg_response_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id, date) DO UPDATE SET
      observations = observations + excluded.observations,
      recommendations = recommendations + excluded.recommendations,
      actions_executed = actions_executed + excluded.actions_executed,
      actions_approved = actions_approved + excluded.actions_approved,
      actions_rejected = actions_rejected + excluded.actions_rejected,
      actions_skipped = actions_skipped + excluded.actions_skipped,
      value_generated = value_generated + excluded.value_generated,
      avg_response_ms = CASE WHEN excluded.avg_response_ms > 0 THEN excluded.avg_response_ms ELSE avg_response_ms END
  `).run(
    agentId, date,
    metrics.observations || 0, metrics.recommendations || 0,
    metrics.actions_executed || 0, metrics.actions_approved || 0,
    metrics.actions_rejected || 0, metrics.actions_skipped || 0,
    metrics.value_generated || 0, metrics.avg_response_ms || 0
  );
}

export function getAgentMetrics(agentId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return db.prepare(`
    SELECT * FROM agent_metrics WHERE agent_id = ? AND date >= ? ORDER BY date DESC
  `).all(agentId, since);
}

export function getAllAgentMetrics(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return db.prepare(`
    SELECT * FROM agent_metrics WHERE date >= ? ORDER BY date DESC
  `).all(since);
}

// Agent Reports
export function insertAgentReport(agentId, reportType, period, title, content, dataJson = null) {
  return db.prepare(`
    INSERT INTO agent_reports (agent_id, report_type, period, title, content, data_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(agentId, reportType, period, title, content, dataJson ? JSON.stringify(dataJson) : null);
}

export function getAgentReports(limit = 20) {
  return db.prepare('SELECT * FROM agent_reports ORDER BY created_at DESC LIMIT ?').all(limit);
}

export function getAgentReport(reportId) {
  return db.prepare('SELECT * FROM agent_reports WHERE id = ?').get(reportId);
}

// ─── Agent Run History ────────────────────────────────────────────────────────

export function insertAgentRun({ runId, tenantId, agentId, userId, threadId, input, output, model, route, inputTokens, outputTokens, toolsUsed, durationMs, status, errorMessage }) {
  return db.prepare(`
    INSERT INTO agent_runs (run_id, tenant_id, agent_id, user_id, thread_id, input, output, model, route, input_tokens, output_tokens, tools_used, duration_ms, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(runId, tenantId, agentId, userId || null, threadId || null, input, output || null, model || null, route || 'api', inputTokens || 0, outputTokens || 0, toolsUsed ? JSON.stringify(toolsUsed) : null, durationMs || null, status || 'completed', errorMessage || null);
}

export function getAgentRuns(tenantId, agentId, { limit = 50, offset = 0 } = {}) {
  return db.prepare(`
    SELECT * FROM agent_runs WHERE tenant_id = ? AND agent_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(tenantId, agentId, limit, offset);
}

export function getAgentRun(runId) {
  return db.prepare('SELECT * FROM agent_runs WHERE run_id = ?').get(runId);
}

export function getAgentRunsByThread(tenantId, threadId, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT * FROM agent_runs WHERE tenant_id = ? AND thread_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(tenantId, threadId, limit);
}

export function getAllAgentRuns(tenantId, { limit = 100, offset = 0 } = {}) {
  return db.prepare(`
    SELECT * FROM agent_runs WHERE tenant_id = ?
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(tenantId, limit, offset);
}

// Notifications
export function insertNotification(source, type, title, body, actionUrl = null) {
  return db.prepare(`
    INSERT INTO notifications (timestamp, source, type, title, body, action_url)
    VALUES (datetime('now'), ?, ?, ?, ?, ?)
  `).run(source, type, title, body, actionUrl);
}

export function getNotifications(limit = 50, unreadOnly = false) {
  const where = unreadOnly ? 'WHERE read = 0 AND dismissed = 0' : 'WHERE dismissed = 0';
  return db.prepare(`SELECT * FROM notifications ${where} ORDER BY timestamp DESC LIMIT ?`).all(limit);
}

export function getUnreadNotificationCount() {
  return db.prepare('SELECT COUNT(*) as count FROM notifications WHERE read = 0 AND dismissed = 0').get().count;
}

export function markNotificationRead(id) {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(id);
}

export function markAllNotificationsRead() {
  db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
}

export function dismissNotification(id) {
  db.prepare('UPDATE notifications SET dismissed = 1 WHERE id = ?').run(id);
}

// ─── Password Resets ─────────────────────────────────────────────────────────

export function createPasswordReset({ id, userId, tokenHash, expiresAt }) {
  // Invalidate any existing unused reset tokens for this user
  db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').run(userId);
  return db.prepare(
    'INSERT INTO password_resets (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).run(id, userId, tokenHash, expiresAt);
}

export function getPasswordResetByHash(tokenHash) {
  return db.prepare(
    'SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > datetime(\'now\')'
  ).get(tokenHash);
}

export function markPasswordResetUsed(id) {
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(id);
}

// ─── Report Comments ────────────────────────────────────────────────────────

function initReportComments(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS report_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      user_role TEXT DEFAULT 'member',
      message TEXT NOT NULL,
      reactions_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_report_comments_report ON report_comments(tenant_id, report_id, created_at)'); } catch (e) { /* exists */ }
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_report_comments_created ON report_comments(created_at)'); } catch (e) { /* exists */ }
}

export function getReportComments(tenantId, reportId) {
  return db.prepare(
    'SELECT * FROM report_comments WHERE tenant_id = ? AND report_id = ? ORDER BY created_at ASC'
  ).all(tenantId, reportId);
}

export function createReportComment(tenantId, reportId, userId, userName, userRole, message) {
  const result = db.prepare(`
    INSERT INTO report_comments (tenant_id, report_id, user_id, user_name, user_role, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tenantId, reportId, userId, userName, userRole, message);
  return db.prepare('SELECT * FROM report_comments WHERE id = ?').get(result.lastInsertRowid);
}

export function addReportCommentReaction(commentId, userId, emoji) {
  const comment = db.prepare('SELECT reactions_json FROM report_comments WHERE id = ?').get(commentId);
  if (!comment) return null;
  const reactions = JSON.parse(comment.reactions_json || '{}');
  if (!reactions[emoji]) reactions[emoji] = [];
  if (reactions[emoji].includes(userId)) {
    reactions[emoji] = reactions[emoji].filter(id => id !== userId);
    if (reactions[emoji].length === 0) delete reactions[emoji];
  } else {
    reactions[emoji].push(userId);
  }
  db.prepare('UPDATE report_comments SET reactions_json = ? WHERE id = ?').run(JSON.stringify(reactions), commentId);
  return db.prepare('SELECT * FROM report_comments WHERE id = ?').get(commentId);
}

export function getReportCommentCounts(tenantId, reportIds) {
  if (!reportIds.length) return {};
  const placeholders = reportIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT report_id, COUNT(*) as count FROM report_comments WHERE tenant_id = ? AND report_id IN (${placeholders}) GROUP BY report_id`
  ).all(tenantId, ...reportIds);
  const counts = {};
  for (const row of rows) counts[row.report_id] = row.count;
  return counts;
}

// ─── Phase 7: HPC / AI Compute Helpers ──────────────────────────────────────

// Workload CRUD
export function getWorkloads() {
  return db.prepare('SELECT * FROM workloads ORDER BY created_at').all();
}

export function getWorkload(id) {
  return db.prepare('SELECT * FROM workloads WHERE id = ?').get(id);
}

export function createWorkload(workload) {
  return db.prepare(`
    INSERT INTO workloads (id, name, type, site, energy_node, power_allocation_mw,
      revenue_model_json, fleet_json, curtailment_profile_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workload.id, workload.name, workload.type, workload.site || null,
    workload.energyNode || null, workload.powerAllocationMW || 0,
    JSON.stringify(workload.revenueModel || {}),
    JSON.stringify(workload.fleet || {}),
    JSON.stringify(workload.curtailmentProfile || {}),
    workload.status || 'active'
  );
}

export function updateWorkload(id, updates) {
  const sets = [];
  const params = [];
  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.type !== undefined) { sets.push('type = ?'); params.push(updates.type); }
  if (updates.site !== undefined) { sets.push('site = ?'); params.push(updates.site); }
  if (updates.energyNode !== undefined) { sets.push('energy_node = ?'); params.push(updates.energyNode); }
  if (updates.powerAllocationMW !== undefined) { sets.push('power_allocation_mw = ?'); params.push(updates.powerAllocationMW); }
  if (updates.revenueModel !== undefined) { sets.push('revenue_model_json = ?'); params.push(JSON.stringify(updates.revenueModel)); }
  if (updates.fleet !== undefined) { sets.push('fleet_json = ?'); params.push(JSON.stringify(updates.fleet)); }
  if (updates.curtailmentProfile !== undefined) { sets.push('curtailment_profile_json = ?'); params.push(JSON.stringify(updates.curtailmentProfile)); }
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  sets.push("updated_at = datetime('now')");
  params.push(id);
  return db.prepare(`UPDATE workloads SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteWorkload(id) {
  return db.prepare('DELETE FROM workloads WHERE id = ?').run(id);
}

// GPU fleet config
export function getGpuFleetConfig() {
  const row = db.prepare('SELECT config_json FROM gpu_fleet_config WHERE id = 1').get();
  return row ? JSON.parse(row.config_json) : null;
}

export function saveGpuFleetConfig(config) {
  return db.prepare(`
    INSERT OR REPLACE INTO gpu_fleet_config (id, config_json, updated_at)
    VALUES (1, ?, datetime('now'))
  `).run(JSON.stringify(config));
}

// HPC Contracts CRUD
export function getHpcContracts(status = null) {
  if (status) {
    return db.prepare('SELECT * FROM hpc_contracts WHERE status = ? ORDER BY start_date DESC').all(status);
  }
  return db.prepare('SELECT * FROM hpc_contracts ORDER BY start_date DESC').all();
}

export function getHpcContract(id) {
  return db.prepare('SELECT * FROM hpc_contracts WHERE id = ?').get(id);
}

export function createHpcContract(contract) {
  return db.prepare(`
    INSERT INTO hpc_contracts (id, customer, contract_type, gpu_model, gpu_count,
      power_draw_mw, rate_per_gpu_hr, monthly_revenue, uptime_sla, interruptible,
      curtailment_penalty, curtailment_max_hours, curtailment_notice_min,
      start_date, end_date, auto_renew, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    contract.id, contract.customer, contract.contractType,
    contract.gpuModel || null, contract.gpuCount || 0,
    contract.powerDrawMW || 0, contract.ratePerGpuHr || 0,
    contract.monthlyRevenue || 0, contract.uptimeSLA || 99.9,
    contract.interruptible ? 1 : 0,
    contract.curtailmentPenalty || 0, contract.curtailmentMaxHours || 0,
    contract.curtailmentNoticeMin || 0,
    contract.startDate || null, contract.endDate || null,
    contract.autoRenew ? 1 : 0, contract.status || 'active'
  );
}

export function updateHpcContract(id, updates) {
  const sets = [];
  const params = [];
  const fieldMap = {
    customer: 'customer', contractType: 'contract_type', gpuModel: 'gpu_model',
    gpuCount: 'gpu_count', powerDrawMW: 'power_draw_mw', ratePerGpuHr: 'rate_per_gpu_hr',
    monthlyRevenue: 'monthly_revenue', uptimeSLA: 'uptime_sla',
    curtailmentPenalty: 'curtailment_penalty', curtailmentMaxHours: 'curtailment_max_hours',
    curtailmentNoticeMin: 'curtailment_notice_min', startDate: 'start_date',
    endDate: 'end_date', status: 'status',
  };
  for (const [key, col] of Object.entries(fieldMap)) {
    if (updates[key] !== undefined) { sets.push(`${col} = ?`); params.push(updates[key]); }
  }
  if (updates.interruptible !== undefined) { sets.push('interruptible = ?'); params.push(updates.interruptible ? 1 : 0); }
  if (updates.autoRenew !== undefined) { sets.push('auto_renew = ?'); params.push(updates.autoRenew ? 1 : 0); }
  if (sets.length === 0) return;
  params.push(id);
  return db.prepare(`UPDATE hpc_contracts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteHpcContract(id) {
  return db.prepare("UPDATE hpc_contracts SET status = 'archived' WHERE id = ?").run(id);
}

// HPC SLA Events
export function insertSlaEvent(contractId, eventType, durationMinutes, cause, penaltyAmount = 0) {
  return db.prepare(`
    INSERT INTO hpc_sla_events (contract_id, timestamp, event_type, duration_minutes, cause, penalty_amount)
    VALUES (?, datetime('now'), ?, ?, ?, ?)
  `).run(contractId, eventType, durationMinutes, cause, penaltyAmount);
}

export function getSlaEvents(contractId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT * FROM hpc_sla_events WHERE contract_id = ? AND timestamp >= ? ORDER BY timestamp DESC
  `).all(contractId, since);
}

export function getSlaEventsSummary(contractId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT
      COUNT(*) as total_events,
      COALESCE(SUM(duration_minutes), 0) as total_downtime_minutes,
      COALESCE(SUM(penalty_amount), 0) as total_penalties,
      COALESCE(SUM(CASE WHEN event_type = 'sla_breach' THEN 1 ELSE 0 END), 0) as breach_count
    FROM hpc_sla_events WHERE contract_id = ? AND timestamp >= ?
  `).get(contractId, since);
}

export function getAllSlaSummary(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT contract_id,
      COUNT(*) as total_events,
      COALESCE(SUM(duration_minutes), 0) as total_downtime_minutes,
      COALESCE(SUM(penalty_amount), 0) as total_penalties
    FROM hpc_sla_events WHERE timestamp >= ?
    GROUP BY contract_id
  `).all(since);
}

// Workload snapshots
export function insertWorkloadSnapshot(snapshot) {
  return db.prepare(`
    INSERT OR REPLACE INTO workload_snapshots
      (date, workload_id, workload_type, capacity_mw, online_mw, curtailed_mw,
       gross_revenue, energy_cost, curtailment_savings, curtailment_penalties,
       net_revenue, revenue_per_mw, margin_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    snapshot.date, snapshot.workloadId, snapshot.workloadType,
    snapshot.capacityMW, snapshot.onlineMW, snapshot.curtailedMW,
    snapshot.grossRevenue, snapshot.energyCost,
    snapshot.curtailmentSavings, snapshot.curtailmentPenalties,
    snapshot.netRevenue, snapshot.revenuePerMW, snapshot.marginPercent
  );
}

export function getWorkloadSnapshots(workloadId, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return db.prepare(`
    SELECT * FROM workload_snapshots WHERE workload_id = ? AND date >= ? ORDER BY date ASC
  `).all(workloadId, since);
}

export function getAllWorkloadSnapshots(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
  return db.prepare(`
    SELECT * FROM workload_snapshots WHERE date >= ? ORDER BY date ASC
  `).all(since);
}

// GPU Spot Prices
export function insertGpuSpotPrice(record) {
  return db.prepare(`
    INSERT OR REPLACE INTO gpu_spot_prices (timestamp, gpu_model, provider, price_per_gpu_hr)
    VALUES (?, ?, ?, ?)
  `).run(record.timestamp, record.gpuModel, record.provider, record.pricePerGpuHr);
}

export function getGpuSpotPrices(gpuModel, days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return db.prepare(`
    SELECT * FROM gpu_spot_prices WHERE gpu_model = ? AND timestamp >= ? ORDER BY timestamp ASC
  `).all(gpuModel, since);
}

export function getLatestGpuSpotPrices() {
  return db.prepare(`
    SELECT gsp.* FROM gpu_spot_prices gsp
    INNER JOIN (
      SELECT gpu_model, provider, MAX(timestamp) as max_ts FROM gpu_spot_prices GROUP BY gpu_model, provider
    ) latest ON gsp.gpu_model = latest.gpu_model AND gsp.provider = latest.provider AND gsp.timestamp = latest.max_ts
    ORDER BY gsp.gpu_model
  `).all();
}

// ─── Phase 8: Multi-Tenant, Auth, Webhook Tables ────────────────────────────

function initPhase8Tables(targetDb) {
  // Note: tenants table is created in seedTenantData() for each tenant DB,
  // and in initSystemSchema() for systemDb. We still create it here
  // as part of schema init so existing queries that JOIN on it work.
  targetDb.exec(`
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

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      role TEXT NOT NULL DEFAULT 'viewer',
      status TEXT NOT NULL DEFAULT 'invited',
      mfa_enabled INTEGER DEFAULT 0,
      mfa_secret TEXT,
      last_login DATETIME,
      must_change_password INTEGER DEFAULT 0,
      notification_prefs_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(email, tenant_id)
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      refresh_token_hash TEXT NOT NULL,
      device TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      revoked INTEGER DEFAULT 0
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      invited_by TEXT REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      accepted_at DATETIME,
      status TEXT DEFAULT 'pending'
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS partner_access (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      partner_tenant_id TEXT NOT NULL REFERENCES tenants(id),
      granted_by TEXT REFERENCES users(id),
      access_type TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      revoked_at DATETIME
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      permissions_json TEXT,
      rate_limit INTEGER,
      last_used DATETIME,
      expires_at DATETIME,
      revoked INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      user_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details_json TEXT,
      ip_address TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events_json TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      failure_count INTEGER DEFAULT 0,
      last_success DATETIME,
      last_failure DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_id TEXT NOT NULL REFERENCES webhooks(id),
      event_type TEXT NOT NULL,
      payload_json TEXT,
      status TEXT NOT NULL,
      status_code INTEGER,
      response_body TEXT,
      attempts INTEGER DEFAULT 0,
      next_retry DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      location_json TEXT,
      iso TEXT DEFAULT 'ERCOT',
      energy_node TEXT,
      total_capacity_mw REAL DEFAULT 0,
      workload_ids_json TEXT,
      status TEXT DEFAULT 'operational',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Phase 8 indices
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions(refresh_token_hash)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_partner_access_tenant ON partner_access(tenant_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_partner_access_partner ON partner_access(partner_tenant_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id, timestamp)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id)'); } catch (e) {}
}

// ─── Phase 8: Tenant Helpers ────────────────────────────────────────────────

export function getTenant(id) {
  // Always query systemDb for tenant routing data
  const row = systemDb.prepare('SELECT * FROM tenants WHERE id = ?').get(id);
  if (row) {
    row.branding = row.branding_json ? JSON.parse(row.branding_json) : null;
    row.settings = row.settings_json ? JSON.parse(row.settings_json) : null;
    row.limits = row.limits_json ? JSON.parse(row.limits_json) : null;
  }
  return row;
}

export function getTenantBySlug(slug) {
  const row = systemDb.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  if (row) {
    row.branding = row.branding_json ? JSON.parse(row.branding_json) : null;
    row.settings = row.settings_json ? JSON.parse(row.settings_json) : null;
    row.limits = row.limits_json ? JSON.parse(row.limits_json) : null;
  }
  return row;
}

export function getTenantByDomain(domain) {
  const row = systemDb.prepare('SELECT * FROM tenants WHERE custom_domain = ?').get(domain);
  if (row) {
    row.branding = row.branding_json ? JSON.parse(row.branding_json) : null;
    row.settings = row.settings_json ? JSON.parse(row.settings_json) : null;
    row.limits = row.limits_json ? JSON.parse(row.limits_json) : null;
  }
  return row;
}

export function getAllTenants() {
  return systemDb.prepare('SELECT * FROM tenants ORDER BY created_at').all().map(row => ({
    ...row,
    branding: row.branding_json ? JSON.parse(row.branding_json) : null,
    settings: row.settings_json ? JSON.parse(row.settings_json) : null,
    limits: row.limits_json ? JSON.parse(row.limits_json) : null,
  }));
}

export function createTenant(tenant) {
  // Sanitize fields that could touch DDL/schema if misused
  const safeName = sanitizeTenantField(tenant.name);
  const safeSlug = sanitizeTenantField(tenant.slug);
  const safeId = sanitizeTenantField(tenant.id);

  if (isSqlReserved(safeSlug)) {
    throw new Error(`Tenant slug "${safeSlug}" is a SQL reserved word and cannot be used`);
  }

  // Insert into systemDb
  const result = systemDb.prepare(`
    INSERT INTO tenants (id, name, slug, plan, status, branding_json, settings_json, limits_json, trial_ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    safeId, safeName, safeSlug,
    tenant.plan || 'trial', tenant.status || 'trial',
    tenant.branding ? JSON.stringify(tenant.branding) : null,
    tenant.settings ? JSON.stringify(tenant.settings) : null,
    tenant.limits ? JSON.stringify(tenant.limits) : JSON.stringify({
      maxUsers: 10, maxSites: 3, maxWorkloads: 20, maxAgents: 5, apiRateLimit: 60, dataRetentionDays: 90
    }),
    tenant.trialEndsAt || new Date(Date.now() + 14 * 86400000).toISOString()
  );

  // Also create the tenant's DB and init schema
  const tdb = getTenantDb(safeId);
  initSchemaForDb(tdb);
  seedTenantData(tdb, safeId);

  return result;
}

export function updateTenant(id, updates) {
  const sets = [];
  const params = [];
  if (updates.name !== undefined) { sets.push('name = ?'); params.push(sanitizeTenantField(updates.name)); }
  if (updates.slug !== undefined) {
    const safeSlug = sanitizeTenantField(updates.slug);
    if (isSqlReserved(safeSlug)) {
      throw new Error(`Tenant slug "${safeSlug}" is a SQL reserved word and cannot be used`);
    }
    sets.push('slug = ?'); params.push(safeSlug);
  }
  if (updates.plan !== undefined) { sets.push('plan = ?'); params.push(updates.plan); }
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.branding !== undefined) { sets.push('branding_json = ?'); params.push(JSON.stringify(updates.branding)); }
  if (updates.settings !== undefined) { sets.push('settings_json = ?'); params.push(JSON.stringify(updates.settings)); }
  if (updates.limits !== undefined) { sets.push('limits_json = ?'); params.push(JSON.stringify(updates.limits)); }
  if (updates.trialEndsAt !== undefined) { sets.push('trial_ends_at = ?'); params.push(updates.trialEndsAt); }
  sets.push("updated_at = datetime('now')");
  params.push(id);
  // Update in systemDb
  const result = systemDb.prepare(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  // Also update the copy in the tenant's own DB (defense-in-depth)
  try {
    const tdb = getTenantDb(id);
    tdb.prepare(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  } catch (e) { /* tenant DB may not have this row yet */ }

  return result;
}

// ─── Phase 8: User Helpers ──────────────────────────────────────────────────

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);
}

export function getUsersByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').all(email);
}

export function getUserByEmailAndTenant(email, tenantId) {
  return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND tenant_id = ?').get(email, tenantId);
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getUsersByTenant(tenantId) {
  const tdb = getTenantDb(tenantId);
  return tdb.prepare('SELECT id, email, name, tenant_id, role, status, mfa_enabled, last_login, created_at FROM users WHERE tenant_id = ? ORDER BY created_at').all(tenantId);
}

export function createUser(user) {
  return db.prepare(`
    INSERT INTO users (id, email, name, password_hash, tenant_id, role, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(user.id, user.email, user.name, user.passwordHash, user.tenantId, user.role || 'viewer', user.status || 'active');
}

export function updateUser(id, updates) {
  const sets = [];
  const params = [];
  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.email !== undefined) { sets.push('email = ?'); params.push(updates.email); }
  if (updates.role !== undefined) { sets.push('role = ?'); params.push(updates.role); }
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.passwordHash !== undefined) { sets.push('password_hash = ?'); params.push(updates.passwordHash); }
  if (updates.mfaEnabled !== undefined) { sets.push('mfa_enabled = ?'); params.push(updates.mfaEnabled ? 1 : 0); }
  if (updates.mfaSecret !== undefined) { sets.push('mfa_secret = ?'); params.push(updates.mfaSecret); }
  if (updates.lastLogin !== undefined) { sets.push('last_login = ?'); params.push(updates.lastLogin); }
  if (updates.mustChangePassword !== undefined) { sets.push('must_change_password = ?'); params.push(updates.mustChangePassword ? 1 : 0); }
  if (updates.notificationPrefs !== undefined) { sets.push('notification_prefs_json = ?'); params.push(JSON.stringify(updates.notificationPrefs)); }
  sets.push("updated_at = datetime('now')");
  params.push(id);
  return db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteUser(id) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// ─── Phase 8: Session Helpers ───────────────────────────────────────────────

export function createSession(session) {
  return db.prepare(`
    INSERT INTO sessions (id, user_id, refresh_token_hash, device, ip_address, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(session.id, session.userId, session.refreshTokenHash, session.device, session.ipAddress, session.expiresAt);
}

export function getSessionByRefreshHash(hash) {
  return db.prepare('SELECT * FROM sessions WHERE refresh_token_hash = ? AND revoked = 0').get(hash);
}

export function getUserSessions(userId) {
  return db.prepare('SELECT id, device, ip_address, created_at, expires_at FROM sessions WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC').all(userId);
}

export function revokeSession(sessionId) {
  return db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(sessionId);
}

export function revokeUserSessions(userId) {
  return db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ?').run(userId);
}

// ─── Phase 8: Invitation Helpers ────────────────────────────────────────────

export function createInvitation(invitation) {
  return db.prepare(`
    INSERT INTO invitations (id, tenant_id, email, role, invited_by, token, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(invitation.id, invitation.tenantId, invitation.email, invitation.role, invitation.invitedBy, invitation.token, invitation.expiresAt);
}

export function getInvitationByToken(token) {
  return db.prepare("SELECT * FROM invitations WHERE token = ? AND status = 'pending'").get(token);
}

export function getInvitationsByTenant(tenantId) {
  return db.prepare('SELECT * FROM invitations WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function acceptInvitation(token) {
  return db.prepare("UPDATE invitations SET status = 'accepted', accepted_at = datetime('now') WHERE token = ?").run(token);
}

export function revokeInvitation(id) {
  return db.prepare("UPDATE invitations SET status = 'revoked' WHERE id = ?").run(id);
}

// ─── Phase 8: Partner Access Helpers ────────────────────────────────────────

export function getPartnerAccess(tenantId) {
  return db.prepare("SELECT * FROM partner_access WHERE tenant_id = ? AND status = 'active' ORDER BY created_at DESC").all(tenantId);
}

export function getPartnerAccessForPartner(partnerTenantId) {
  return db.prepare("SELECT pa.*, t.name as tenant_name FROM partner_access pa JOIN tenants t ON pa.tenant_id = t.id WHERE pa.partner_tenant_id = ? AND pa.status = 'active'").all(partnerTenantId);
}

export function createPartnerAccess(pa) {
  return db.prepare(`
    INSERT INTO partner_access (id, tenant_id, partner_tenant_id, granted_by, access_type, permissions_json, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(pa.id, pa.tenantId, pa.partnerTenantId, pa.grantedBy, pa.accessType, JSON.stringify(pa.permissions), pa.expiresAt || null);
}

export function updatePartnerAccess(id, updates) {
  const sets = [];
  const params = [];
  if (updates.permissions !== undefined) { sets.push('permissions_json = ?'); params.push(JSON.stringify(updates.permissions)); }
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.expiresAt !== undefined) { sets.push('expires_at = ?'); params.push(updates.expiresAt); }
  if (updates.status === 'revoked') { sets.push("revoked_at = datetime('now')"); }
  params.push(id);
  return db.prepare(`UPDATE partner_access SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// ─── Phase 8: API Key Helpers ───────────────────────────────────────────────

export function getApiKeys(tenantId) {
  return db.prepare('SELECT id, tenant_id, user_id, name, key_prefix, permissions_json, rate_limit, last_used, expires_at, revoked, created_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function getApiKeyByPrefix(prefix) {
  return db.prepare('SELECT * FROM api_keys WHERE key_prefix = ? AND revoked = 0').all(prefix);
}

export function createApiKey(key) {
  return db.prepare(`
    INSERT INTO api_keys (id, tenant_id, user_id, name, key_hash, key_prefix, permissions_json, rate_limit, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(key.id, key.tenantId, key.userId, key.name, key.keyHash, key.keyPrefix, key.permissions ? JSON.stringify(key.permissions) : null, key.rateLimit || null, key.expiresAt || null);
}

export function revokeApiKey(id) {
  return db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').run(id);
}

export function updateApiKeyLastUsed(id) {
  return db.prepare("UPDATE api_keys SET last_used = datetime('now') WHERE id = ?").run(id);
}

// ─── Phase 8: Audit Log Helpers ─────────────────────────────────────────────

export function insertAuditLog(entry) {
  return db.prepare(`
    INSERT INTO audit_log (tenant_id, user_id, action, resource_type, resource_id, details_json, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(entry.tenantId, entry.userId, entry.action, entry.resourceType || null, entry.resourceId || null, entry.details ? JSON.stringify(entry.details) : null, entry.ipAddress || null);
}

export function getAuditLog(tenantId, limit = 100, offset = 0) {
  return db.prepare(`
    SELECT al.*, u.name as user_name, u.email as user_email
    FROM audit_log al LEFT JOIN users u ON al.user_id = u.id
    WHERE al.tenant_id = ? ORDER BY al.timestamp DESC LIMIT ? OFFSET ?
  `).all(tenantId, limit, offset);
}

export function getCrosstenantAuditLog(limit = 100, offset = 0) {
  return db.prepare(`
    SELECT al.*, u.name as user_name, u.email as user_email, t.name as tenant_name
    FROM audit_log al LEFT JOIN users u ON al.user_id = u.id LEFT JOIN tenants t ON al.tenant_id = t.id
    ORDER BY al.timestamp DESC LIMIT ? OFFSET ?
  `).all(limit, offset);
}

// ─── Chat Thread Helpers ────────────────────────────────────────────────────

export function createThread(id, tenantId, agentId, userId, title, visibility = 'private') {
  return db.prepare(`
    INSERT INTO chat_threads (id, tenant_id, agent_id, user_id, title, visibility)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, agentId, userId, title, visibility);
}

export function getThread(id) {
  return db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(id);
}

export function updateThreadVisibility(id, visibility) {
  return db.prepare("UPDATE chat_threads SET visibility = ?, updated_at = datetime('now') WHERE id = ?").run(visibility, id);
}

export function updateThreadTitle(id, title) {
  return db.prepare("UPDATE chat_threads SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, id);
}

export function deleteThread(id) {
  db.prepare('DELETE FROM chat_messages WHERE thread_id = ?').run(id);
  return db.prepare('DELETE FROM chat_threads WHERE id = ?').run(id);
}

export function pinThread(id) {
  return db.prepare("UPDATE chat_threads SET is_pinned = 1, updated_at = datetime('now') WHERE id = ?").run(id);
}

export function unpinThread(id) {
  return db.prepare("UPDATE chat_threads SET is_pinned = 0, updated_at = datetime('now') WHERE id = ?").run(id);
}

export function listThreads(tenantId, agentId, userId, { isAdmin = false, limit = 50, offset = 0 } = {}) {
  if (isAdmin) {
    return db.prepare(`
      SELECT * FROM chat_threads
      WHERE tenant_id = ? AND agent_id = ? AND id NOT LIKE 'help_%'
      ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?
    `).all(tenantId, agentId, limit, offset);
  }
  return db.prepare(`
    SELECT * FROM chat_threads
    WHERE tenant_id = ? AND agent_id = ? AND id NOT LIKE 'help_%'
      AND (user_id = ? OR visibility IN ('team', 'pinned'))
    ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?
  `).all(tenantId, agentId, userId, limit, offset);
}

export function getPinnedThreads(tenantId, { limit = 10 } = {}) {
  return db.prepare(`
    SELECT * FROM chat_threads
    WHERE tenant_id = ? AND visibility = 'pinned'
    ORDER BY updated_at DESC LIMIT ?
  `).all(tenantId, limit);
}

export function getOrphanMessageCount(tenantId, agentId, userId) {
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM chat_messages
    WHERE tenant_id = ? AND agent_id = ? AND user_id = ? AND thread_id IS NULL
  `).get(tenantId, agentId, userId);
  return row.count;
}

export function backfillOrphanMessages(tenantId, agentId, userId, threadId) {
  return db.prepare(`
    UPDATE chat_messages SET thread_id = ?
    WHERE tenant_id = ? AND agent_id = ? AND user_id = ? AND thread_id IS NULL
  `).run(threadId, tenantId, agentId, userId);
}

// ─── Thread Context Summaries (cross-thread awareness) ──────────────────────

export function saveThreadSummary(threadId, tenantId, agentId, userId, summary) {
  return db.prepare(`
    INSERT INTO thread_summaries (thread_id, tenant_id, agent_id, user_id, summary, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(thread_id) DO UPDATE SET summary = ?, updated_at = datetime('now')
  `).run(threadId, tenantId, agentId, userId, summary, summary);
}

export function getSiblingThreadSummaries(tenantId, agentId, currentThreadId, userId, limit = 5) {
  return db.prepare(`
    SELECT ts.thread_id, ts.summary, ts.updated_at, ct.title
    FROM thread_summaries ts
    LEFT JOIN chat_threads ct ON ct.id = ts.thread_id
    WHERE ts.tenant_id = ? AND ts.agent_id = ? AND ts.thread_id != ?
      AND (ts.user_id = ? OR ts.user_id IS NULL)
    ORDER BY ts.updated_at DESC LIMIT ?
  `).all(tenantId, agentId, currentThreadId, userId, limit);
}

// ─── Phase 8: Webhook Helpers ───────────────────────────────────────────────

export function getWebhooks(tenantId) {
  return db.prepare('SELECT * FROM webhooks WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function getWebhook(id) {
  return db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
}

export function createWebhook(wh) {
  return db.prepare(`
    INSERT INTO webhooks (id, tenant_id, url, secret, events_json, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).run(wh.id, wh.tenantId, wh.url, wh.secret, JSON.stringify(wh.events));
}

export function updateWebhook(id, updates) {
  const sets = [];
  const params = [];
  if (updates.url !== undefined) { sets.push('url = ?'); params.push(updates.url); }
  if (updates.events !== undefined) { sets.push('events_json = ?'); params.push(JSON.stringify(updates.events)); }
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.failureCount !== undefined) { sets.push('failure_count = ?'); params.push(updates.failureCount); }
  if (updates.lastSuccess !== undefined) { sets.push('last_success = ?'); params.push(updates.lastSuccess); }
  if (updates.lastFailure !== undefined) { sets.push('last_failure = ?'); params.push(updates.lastFailure); }
  params.push(id);
  return db.prepare(`UPDATE webhooks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteWebhook(id) {
  return db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
}

export function getWebhooksByEvent(tenantId, eventType) {
  return db.prepare(`
    SELECT * FROM webhooks WHERE tenant_id = ? AND status = 'active'
  `).all(tenantId).filter(wh => {
    const events = JSON.parse(wh.events_json);
    return events.includes(eventType);
  });
}

export function insertWebhookDelivery(delivery) {
  return db.prepare(`
    INSERT INTO webhook_deliveries (webhook_id, event_type, payload_json, status, status_code, response_body, attempts, next_retry)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(delivery.webhookId, delivery.eventType, JSON.stringify(delivery.payload), delivery.status, delivery.statusCode || null, delivery.responseBody || null, delivery.attempts || 1, delivery.nextRetry || null);
}

export function getPendingWebhookDeliveries() {
  return db.prepare(`
    SELECT * FROM webhook_deliveries WHERE status = 'pending' AND (next_retry IS NULL OR next_retry <= datetime('now'))
    ORDER BY created_at ASC LIMIT 100
  `).all();
}

// ─── Phase 8: Site Helpers ──────────────────────────────────────────────────

export function getSites(tenantId) {
  return db.prepare('SELECT * FROM sites WHERE tenant_id = ? ORDER BY name').all(tenantId).map(s => ({
    ...s,
    location: s.location_json ? JSON.parse(s.location_json) : null,
    workloadIds: s.workload_ids_json ? JSON.parse(s.workload_ids_json) : [],
  }));
}

export function getSite(id) {
  const s = db.prepare('SELECT * FROM sites WHERE id = ?').get(id);
  if (s) {
    s.location = s.location_json ? JSON.parse(s.location_json) : null;
    s.workloadIds = s.workload_ids_json ? JSON.parse(s.workload_ids_json) : [];
  }
  return s;
}

export function createSite(site) {
  return db.prepare(`
    INSERT INTO sites (id, tenant_id, name, location_json, iso, energy_node, total_capacity_mw, workload_ids_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(site.id, site.tenantId, site.name, site.location ? JSON.stringify(site.location) : null, site.iso || 'ERCOT', site.energyNode || null, site.totalCapacityMW || 0, JSON.stringify(site.workloadIds || []), site.status || 'operational');
}

export function updateSite(id, updates) {
  const sets = [];
  const params = [];
  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.location !== undefined) { sets.push('location_json = ?'); params.push(JSON.stringify(updates.location)); }
  if (updates.iso !== undefined) { sets.push('iso = ?'); params.push(updates.iso); }
  if (updates.energyNode !== undefined) { sets.push('energy_node = ?'); params.push(updates.energyNode); }
  if (updates.totalCapacityMW !== undefined) { sets.push('total_capacity_mw = ?'); params.push(updates.totalCapacityMW); }
  if (updates.workloadIds !== undefined) { sets.push('workload_ids_json = ?'); params.push(JSON.stringify(updates.workloadIds)); }
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  sets.push("updated_at = datetime('now')");
  params.push(id);
  return db.prepare(`UPDATE sites SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function deleteSite(id) {
  return db.prepare('DELETE FROM sites WHERE id = ?').run(id);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 9: Insurance Integration & Network Simulator Bridge
// ═══════════════════════════════════════════════════════════════════════════

function initPhase9Tables(targetDb) {
  // Calibration exports - audit log of telemetry exports to SanghaModel
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS calibration_exports (
      id TEXT PRIMARY KEY,
      tenant_id TEXT DEFAULT 'sangha',
      exported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      export_version TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      tenants_included INTEGER DEFAULT 0,
      total_hashrate_th REAL DEFAULT 0,
      response_status INTEGER,
      response_body TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Risk assessments - cached risk assessments from simulator
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS risk_assessments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      assessment_type TEXT NOT NULL DEFAULT 'full',
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      status TEXT NOT NULL DEFAULT 'pending',
      assessment_json TEXT,
      risk_score REAL,
      prob_below_breakeven_12m REAL,
      suggested_floor_moderate REAL,
      model_version TEXT,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Quote requests - formal quote requests from miners
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS quote_requests (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'submitted',
      desired_floor REAL NOT NULL,
      desired_term INTEGER NOT NULL DEFAULT 12,
      covered_hashrate REAL NOT NULL,
      additional_notes TEXT,
      miner_profile_json TEXT,
      latest_risk_assessment_id TEXT REFERENCES risk_assessments(id),
      indicative_quote_json TEXT,
      formal_quote_json TEXT,
      reviewed_by TEXT,
      reviewed_at DATETIME,
      review_notes TEXT,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insurance policies - active insurance policies
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS insurance_policies (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      quote_request_id TEXT REFERENCES quote_requests(id),
      policy_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      floor_price REAL NOT NULL,
      monthly_premium REAL NOT NULL,
      covered_hashrate REAL NOT NULL,
      term_months INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      upside_share_pct REAL DEFAULT 0.15,
      terms_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insurance claims - monthly claims with verification
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS insurance_claims (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      policy_id TEXT NOT NULL REFERENCES insurance_policies(id),
      claim_month TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      actual_hashprice REAL,
      floor_price REAL,
      shortfall_per_th REAL,
      covered_hashrate REAL,
      gross_claim_amount REAL,
      verification_json TEXT,
      verification_status TEXT DEFAULT 'pending',
      recommended_payout REAL,
      adjustment_reason TEXT,
      paid_amount REAL,
      paid_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insurance upside sharing - upside revenue sharing calculations
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS insurance_upside_sharing (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      policy_id TEXT NOT NULL REFERENCES insurance_policies(id),
      sharing_month TEXT NOT NULL,
      actual_hashprice REAL,
      floor_price REAL,
      upside_per_th REAL,
      share_pct REAL,
      covered_hashrate REAL,
      sangha_share_amount REAL,
      miner_net_amount REAL,
      status TEXT DEFAULT 'calculated',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Indices for Phase 9
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_calibration_exports_exported ON calibration_exports(exported_at)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_risk_assessments_tenant ON risk_assessments(tenant_id, status)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_risk_assessments_expires ON risk_assessments(expires_at)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_quote_requests_tenant ON quote_requests(tenant_id, status)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON quote_requests(status)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_insurance_policies_tenant ON insurance_policies(tenant_id, status)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_insurance_claims_policy ON insurance_claims(policy_id, claim_month)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_insurance_claims_status ON insurance_claims(status)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_upside_sharing_policy ON insurance_upside_sharing(policy_id, sharing_month)`);

  // ── Phase 9b: Three-Party Insurance Structure ──────────────────────────────

  // Balance sheet partners - LP / capital provider entities
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS balance_sheet_partners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'onboarding',
      total_capital_committed REAL DEFAULT 0,
      capital_deployed REAL DEFAULT 0,
      max_single_exposure REAL,
      max_aggregate_exposure REAL,
      accepted_instruments_json TEXT,
      min_premium_rate REAL,
      max_term_months INTEGER DEFAULT 36,
      risk_tier_preference_json TEXT,
      auto_approve_threshold REAL,
      master_agreement_date DATE,
      master_agreement_doc_url TEXT,
      fee_structure_json TEXT NOT NULL DEFAULT '{"structuringFeePercent":5,"performanceFeePercent":10,"managementFeePercent":1}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // LP allocations - tracks which LP backs which quote/policy
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS lp_allocations (
      id TEXT PRIMARY KEY,
      lp_id TEXT NOT NULL REFERENCES balance_sheet_partners(id),
      quote_request_id TEXT NOT NULL REFERENCES quote_requests(id),
      allocated_at DATETIME NOT NULL,
      allocated_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_at DATETIME,
      reviewed_by TEXT,
      review_notes TEXT,
      modification_requested TEXT,
      auto_approved BOOLEAN DEFAULT FALSE,
      structured_terms_json TEXT NOT NULL,
      risk_summary_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add LP columns to insurance_policies (safe IF NOT EXISTS via pragma)
  try {
    targetDb.exec(`ALTER TABLE insurance_policies ADD COLUMN lp_id TEXT REFERENCES balance_sheet_partners(id)`);
  } catch (e) { /* column may already exist */ }
  try {
    targetDb.exec(`ALTER TABLE insurance_policies ADD COLUMN lp_allocation_id TEXT REFERENCES lp_allocations(id)`);
  } catch (e) { /* column may already exist */ }
  try {
    targetDb.exec(`ALTER TABLE insurance_policies ADD COLUMN instrument_type TEXT`);
  } catch (e) { /* column may already exist */ }
  try {
    targetDb.exec(`ALTER TABLE insurance_policies ADD COLUMN structuring_fee_monthly REAL`);
  } catch (e) { /* column may already exist */ }
  try {
    targetDb.exec(`ALTER TABLE insurance_policies ADD COLUMN management_fee_monthly REAL`);
  } catch (e) { /* column may already exist */ }

  // Add LP/settlement columns to insurance_claims
  try {
    targetDb.exec(`ALTER TABLE insurance_claims ADD COLUMN lp_id TEXT REFERENCES balance_sheet_partners(id)`);
  } catch (e) { /* column may already exist */ }
  try {
    targetDb.exec(`ALTER TABLE insurance_claims ADD COLUMN settlement_status TEXT DEFAULT 'pending'`);
  } catch (e) { /* column may already exist */ }
  try {
    targetDb.exec(`ALTER TABLE insurance_claims ADD COLUMN settled_at DATETIME`);
  } catch (e) { /* column may already exist */ }
  try {
    targetDb.exec(`ALTER TABLE insurance_claims ADD COLUMN settlement_reference TEXT`);
  } catch (e) { /* column may already exist */ }

  // Add instrument_type and structured_terms to quote_requests
  try {
    targetDb.exec(`ALTER TABLE quote_requests ADD COLUMN instrument_type TEXT`);
  } catch (e) { /* column may already exist */ }
  try {
    targetDb.exec(`ALTER TABLE quote_requests ADD COLUMN structured_terms_json TEXT`);
  } catch (e) { /* column may already exist */ }
  try {
    targetDb.exec(`ALTER TABLE quote_requests ADD COLUMN structured_by TEXT`);
  } catch (e) { /* column may already exist */ }
  try {
    targetDb.exec(`ALTER TABLE quote_requests ADD COLUMN structured_at DATETIME`);
  } catch (e) { /* column may already exist */ }

  // Indices for Phase 9b
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_lp_allocations_lp ON lp_allocations(lp_id, status)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_lp_allocations_quote ON lp_allocations(quote_request_id)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_bsp_status ON balance_sheet_partners(status)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_policies_lp ON insurance_policies(lp_id)`);
  targetDb.exec(`CREATE INDEX IF NOT EXISTS idx_claims_lp ON insurance_claims(lp_id)`);
}

// ─── Phase 9: Calibration Export Helpers ────────────────────────────────────

export function createCalibrationExport(exp) {
  return db.prepare(`
    INSERT INTO calibration_exports (id, tenant_id, export_version, payload_hash, tenants_included, total_hashrate_th, response_status, response_body)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(exp.id, exp.tenantId || 'sangha', exp.exportVersion, exp.payloadHash, exp.tenantsIncluded || 0, exp.totalHashrateTH || 0, exp.responseStatus || null, exp.responseBody || null);
}

export function getCalibrationExports(limit = 20) {
  return db.prepare('SELECT * FROM calibration_exports ORDER BY exported_at DESC LIMIT ?').all(limit);
}

export function getLatestCalibrationExport() {
  return db.prepare('SELECT * FROM calibration_exports ORDER BY exported_at DESC LIMIT 1').get();
}

// ─── Phase 9: Risk Assessment Helpers ───────────────────────────────────────

export function createRiskAssessment(ra) {
  return db.prepare(`
    INSERT INTO risk_assessments (id, tenant_id, assessment_type, status, model_version, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(ra.id, ra.tenantId, ra.assessmentType || 'full', ra.status || 'pending', ra.modelVersion || null, ra.expiresAt || null);
}

export function updateRiskAssessment(id, updates) {
  const sets = [];
  const params = [];
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.completedAt !== undefined) { sets.push('completed_at = ?'); params.push(updates.completedAt); }
  if (updates.assessmentJson !== undefined) { sets.push('assessment_json = ?'); params.push(typeof updates.assessmentJson === 'string' ? updates.assessmentJson : JSON.stringify(updates.assessmentJson)); }
  if (updates.riskScore !== undefined) { sets.push('risk_score = ?'); params.push(updates.riskScore); }
  if (updates.probBelowBreakeven12m !== undefined) { sets.push('prob_below_breakeven_12m = ?'); params.push(updates.probBelowBreakeven12m); }
  if (updates.suggestedFloorModerate !== undefined) { sets.push('suggested_floor_moderate = ?'); params.push(updates.suggestedFloorModerate); }
  if (updates.modelVersion !== undefined) { sets.push('model_version = ?'); params.push(updates.modelVersion); }
  if (updates.expiresAt !== undefined) { sets.push('expires_at = ?'); params.push(updates.expiresAt); }
  if (sets.length === 0) return;
  params.push(id);
  return db.prepare(`UPDATE risk_assessments SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function getRiskAssessment(id) {
  const ra = db.prepare('SELECT * FROM risk_assessments WHERE id = ?').get(id);
  if (ra && ra.assessment_json) ra.assessment = JSON.parse(ra.assessment_json);
  return ra;
}

export function getLatestRiskAssessment(tenantId) {
  const ra = db.prepare(`
    SELECT * FROM risk_assessments WHERE tenant_id = ? AND status = 'completed'
    ORDER BY completed_at DESC LIMIT 1
  `).get(tenantId);
  if (ra && ra.assessment_json) ra.assessment = JSON.parse(ra.assessment_json);
  return ra;
}

export function getRiskAssessmentHistory(tenantId, limit = 10) {
  return db.prepare(`
    SELECT * FROM risk_assessments WHERE tenant_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(tenantId, limit).map(ra => {
    if (ra.assessment_json) ra.assessment = JSON.parse(ra.assessment_json);
    return ra;
  });
}

// ─── Phase 9: Quote Request Helpers ─────────────────────────────────────────

export function createQuoteRequest(qr) {
  return db.prepare(`
    INSERT INTO quote_requests (id, tenant_id, requested_by, status, desired_floor, desired_term, covered_hashrate, additional_notes, miner_profile_json, latest_risk_assessment_id, indicative_quote_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(qr.id, qr.tenantId, qr.requestedBy, qr.status || 'submitted', qr.desiredFloor, qr.desiredTerm || 12, qr.coveredHashrate, qr.additionalNotes || null, qr.minerProfileJson ? JSON.stringify(qr.minerProfileJson) : null, qr.latestRiskAssessmentId || null, qr.indicativeQuoteJson ? JSON.stringify(qr.indicativeQuoteJson) : null);
}

export function getQuoteRequest(id) {
  const qr = db.prepare('SELECT * FROM quote_requests WHERE id = ?').get(id);
  if (qr) {
    if (qr.miner_profile_json) qr.minerProfile = JSON.parse(qr.miner_profile_json);
    if (qr.indicative_quote_json) qr.indicativeQuote = JSON.parse(qr.indicative_quote_json);
    if (qr.formal_quote_json) qr.formalQuote = JSON.parse(qr.formal_quote_json);
  }
  return qr;
}

export function getQuoteRequests(tenantId, status = null) {
  let sql = 'SELECT * FROM quote_requests WHERE tenant_id = ?';
  const params = [tenantId];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY requested_at DESC';
  return db.prepare(sql).all(...params).map(qr => {
    if (qr.miner_profile_json) qr.minerProfile = JSON.parse(qr.miner_profile_json);
    if (qr.indicative_quote_json) qr.indicativeQuote = JSON.parse(qr.indicative_quote_json);
    if (qr.formal_quote_json) qr.formalQuote = JSON.parse(qr.formal_quote_json);
    return qr;
  });
}

export function getAllQuoteRequests(status = null) {
  let sql = 'SELECT * FROM quote_requests';
  const params = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY requested_at DESC';
  return db.prepare(sql).all(...params).map(qr => {
    if (qr.miner_profile_json) qr.minerProfile = JSON.parse(qr.miner_profile_json);
    if (qr.indicative_quote_json) qr.indicativeQuote = JSON.parse(qr.indicative_quote_json);
    if (qr.formal_quote_json) qr.formalQuote = JSON.parse(qr.formal_quote_json);
    return qr;
  });
}

export function updateQuoteRequest(id, updates) {
  const sets = [];
  const params = [];
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.formalQuoteJson !== undefined) { sets.push('formal_quote_json = ?'); params.push(typeof updates.formalQuoteJson === 'string' ? updates.formalQuoteJson : JSON.stringify(updates.formalQuoteJson)); }
  if (updates.reviewedBy !== undefined) { sets.push('reviewed_by = ?'); params.push(updates.reviewedBy); }
  if (updates.reviewedAt !== undefined) { sets.push('reviewed_at = ?'); params.push(updates.reviewedAt); }
  if (updates.reviewNotes !== undefined) { sets.push('review_notes = ?'); params.push(updates.reviewNotes); }
  if (updates.expiresAt !== undefined) { sets.push('expires_at = ?'); params.push(updates.expiresAt); }
  sets.push("updated_at = datetime('now')");
  params.push(id);
  return db.prepare(`UPDATE quote_requests SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// ─── Phase 9: Insurance Policy Helpers ──────────────────────────────────────

export function createInsurancePolicy(policy) {
  return db.prepare(`
    INSERT INTO insurance_policies (id, tenant_id, quote_request_id, policy_number, status, floor_price, monthly_premium, covered_hashrate, term_months, start_date, end_date, upside_share_pct, terms_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(policy.id, policy.tenantId, policy.quoteRequestId, policy.policyNumber, policy.status || 'active', policy.floorPrice, policy.monthlyPremium, policy.coveredHashrate, policy.termMonths, policy.startDate, policy.endDate, policy.upsideSharePct || 0.15, policy.termsJson ? JSON.stringify(policy.termsJson) : null);
}

export function getInsurancePolicy(id) {
  const p = db.prepare('SELECT * FROM insurance_policies WHERE id = ?').get(id);
  if (p && p.terms_json) p.terms = JSON.parse(p.terms_json);
  return p;
}

export function getInsurancePolicies(tenantId, status = null) {
  let sql = 'SELECT * FROM insurance_policies WHERE tenant_id = ?';
  const params = [tenantId];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params).map(p => {
    if (p.terms_json) p.terms = JSON.parse(p.terms_json);
    return p;
  });
}

export function getAllInsurancePolicies(status = null) {
  let sql = 'SELECT * FROM insurance_policies';
  const params = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params).map(p => {
    if (p.terms_json) p.terms = JSON.parse(p.terms_json);
    return p;
  });
}

export function updateInsurancePolicy(id, updates) {
  const sets = [];
  const params = [];
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.termsJson !== undefined) { sets.push('terms_json = ?'); params.push(JSON.stringify(updates.termsJson)); }
  sets.push("updated_at = datetime('now')");
  params.push(id);
  return db.prepare(`UPDATE insurance_policies SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// ─── Phase 9: Insurance Claims Helpers ──────────────────────────────────────

export function createInsuranceClaim(claim) {
  return db.prepare(`
    INSERT INTO insurance_claims (id, tenant_id, policy_id, claim_month, status, actual_hashprice, floor_price, shortfall_per_th, covered_hashrate, gross_claim_amount, verification_json, verification_status, recommended_payout, adjustment_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(claim.id, claim.tenantId, claim.policyId, claim.claimMonth, claim.status || 'pending', claim.actualHashprice || null, claim.floorPrice || null, claim.shortfallPerTH || null, claim.coveredHashrate || null, claim.grossClaimAmount || null, claim.verificationJson ? JSON.stringify(claim.verificationJson) : null, claim.verificationStatus || 'pending', claim.recommendedPayout || null, claim.adjustmentReason || null);
}

export function getInsuranceClaims(tenantId, policyId = null) {
  let sql = 'SELECT * FROM insurance_claims WHERE tenant_id = ?';
  const params = [tenantId];
  if (policyId) { sql += ' AND policy_id = ?'; params.push(policyId); }
  sql += ' ORDER BY claim_month DESC';
  return db.prepare(sql).all(...params).map(c => {
    if (c.verification_json) c.verification = JSON.parse(c.verification_json);
    return c;
  });
}

export function getInsuranceClaim(id) {
  const c = db.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(id);
  if (c && c.verification_json) c.verification = JSON.parse(c.verification_json);
  return c;
}

export function getClaimsByMonth(tenantId, month) {
  return db.prepare(`
    SELECT * FROM insurance_claims WHERE tenant_id = ? AND claim_month = ?
  `).all(tenantId, month).map(c => {
    if (c.verification_json) c.verification = JSON.parse(c.verification_json);
    return c;
  });
}

export function getAllPendingClaims() {
  return db.prepare(`
    SELECT ic.*, ip.policy_number, ip.floor_price as policy_floor, t.name as tenant_name
    FROM insurance_claims ic
    JOIN insurance_policies ip ON ic.policy_id = ip.id
    LEFT JOIN tenants t ON ic.tenant_id = t.id
    WHERE ic.status IN ('pending', 'verified')
    ORDER BY ic.claim_month DESC
  `).all().map(c => {
    if (c.verification_json) c.verification = JSON.parse(c.verification_json);
    return c;
  });
}

export function updateInsuranceClaim(id, updates) {
  const sets = [];
  const params = [];
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.verificationJson !== undefined) { sets.push('verification_json = ?'); params.push(typeof updates.verificationJson === 'string' ? updates.verificationJson : JSON.stringify(updates.verificationJson)); }
  if (updates.verificationStatus !== undefined) { sets.push('verification_status = ?'); params.push(updates.verificationStatus); }
  if (updates.recommendedPayout !== undefined) { sets.push('recommended_payout = ?'); params.push(updates.recommendedPayout); }
  if (updates.adjustmentReason !== undefined) { sets.push('adjustment_reason = ?'); params.push(updates.adjustmentReason); }
  if (updates.paidAmount !== undefined) { sets.push('paid_amount = ?'); params.push(updates.paidAmount); }
  if (updates.paidAt !== undefined) { sets.push('paid_at = ?'); params.push(updates.paidAt); }
  if (updates.actualHashprice !== undefined) { sets.push('actual_hashprice = ?'); params.push(updates.actualHashprice); }
  if (updates.shortfallPerTH !== undefined) { sets.push('shortfall_per_th = ?'); params.push(updates.shortfallPerTH); }
  if (updates.grossClaimAmount !== undefined) { sets.push('gross_claim_amount = ?'); params.push(updates.grossClaimAmount); }
  sets.push("updated_at = datetime('now')");
  params.push(id);
  return db.prepare(`UPDATE insurance_claims SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// ─── Phase 9: Upside Sharing Helpers ────────────────────────────────────────

export function createUpsideSharing(us) {
  return db.prepare(`
    INSERT INTO insurance_upside_sharing (id, tenant_id, policy_id, sharing_month, actual_hashprice, floor_price, upside_per_th, share_pct, covered_hashrate, sangha_share_amount, miner_net_amount, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(us.id, us.tenantId, us.policyId, us.sharingMonth, us.actualHashprice, us.floorPrice, us.upsidePerTH, us.sharePct, us.coveredHashrate, us.sanghaShareAmount, us.minerNetAmount, us.status || 'calculated');
}

export function getUpsideSharing(tenantId, policyId = null) {
  let sql = 'SELECT * FROM insurance_upside_sharing WHERE tenant_id = ?';
  const params = [tenantId];
  if (policyId) { sql += ' AND policy_id = ?'; params.push(policyId); }
  sql += ' ORDER BY sharing_month DESC';
  return db.prepare(sql).all(...params);
}

// ─── Phase 9: Portfolio Aggregate Helpers ───────────────────────────────────

export function getPortfolioMetrics() {
  const activePolicies = db.prepare(`SELECT COUNT(*) as count, SUM(covered_hashrate) as totalHashrate, SUM(monthly_premium) as totalPremium FROM insurance_policies WHERE status = 'active'`).get();
  const totalClaims = db.prepare(`SELECT COUNT(*) as count, SUM(paid_amount) as totalPaid FROM insurance_claims WHERE status = 'paid'`).get();
  const pendingClaims = db.prepare(`SELECT COUNT(*) as count, SUM(gross_claim_amount) as totalPending FROM insurance_claims WHERE status IN ('pending', 'verified')`).get();
  const byRiskTier = db.prepare(`
    SELECT
      CASE
        WHEN ra.risk_score <= 30 THEN 'low'
        WHEN ra.risk_score <= 60 THEN 'medium'
        ELSE 'high'
      END as tier,
      COUNT(*) as count,
      SUM(ip.covered_hashrate) as hashrate,
      SUM(ip.monthly_premium) as premium
    FROM insurance_policies ip
    LEFT JOIN risk_assessments ra ON ip.tenant_id = ra.tenant_id AND ra.status = 'completed'
    WHERE ip.status = 'active'
    GROUP BY tier
  `).all();

  return {
    activePolicies: activePolicies.count || 0,
    totalCoveredHashrate: activePolicies.totalHashrate || 0,
    monthlyPremiumIncome: activePolicies.totalPremium || 0,
    totalClaimsPaid: totalClaims.totalPaid || 0,
    claimCount: totalClaims.count || 0,
    pendingClaimsCount: pendingClaims.count || 0,
    pendingClaimsAmount: pendingClaims.totalPending || 0,
    lossRatio: activePolicies.totalPremium ? (totalClaims.totalPaid || 0) / (activePolicies.totalPremium * 12) : 0,
    byRiskTier,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 9b: Balance Sheet Partner (LP) Helpers
// ═══════════════════════════════════════════════════════════════════════════

export function createBalanceSheetPartner(lp) {
  return db.prepare(`
    INSERT INTO balance_sheet_partners (id, name, short_name, contact_email, status, total_capital_committed, capital_deployed, max_single_exposure, max_aggregate_exposure, accepted_instruments_json, min_premium_rate, max_term_months, risk_tier_preference_json, auto_approve_threshold, master_agreement_date, master_agreement_doc_url, fee_structure_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(lp.id, lp.name, lp.shortName, lp.contactEmail, lp.status || 'onboarding', lp.totalCapitalCommitted || 0, lp.capitalDeployed || 0, lp.maxSingleExposure || null, lp.maxAggregateExposure || null, lp.acceptedInstruments ? JSON.stringify(lp.acceptedInstruments) : null, lp.minPremiumRate || null, lp.maxTermMonths || 36, lp.riskTierPreference ? JSON.stringify(lp.riskTierPreference) : null, lp.autoApproveThreshold || null, lp.masterAgreementDate || null, lp.masterAgreementDocUrl || null, JSON.stringify(lp.feeStructure || { structuringFeePercent: 5, performanceFeePercent: 10, managementFeePercent: 1 }));
}

export function getBalanceSheetPartner(id) {
  const lp = db.prepare('SELECT * FROM balance_sheet_partners WHERE id = ?').get(id);
  if (lp) {
    if (lp.accepted_instruments_json) lp.acceptedInstruments = JSON.parse(lp.accepted_instruments_json);
    if (lp.risk_tier_preference_json) lp.riskTierPreference = JSON.parse(lp.risk_tier_preference_json);
    if (lp.fee_structure_json) lp.feeStructure = JSON.parse(lp.fee_structure_json);
    lp.capitalAvailable = (lp.total_capital_committed || 0) - (lp.capital_deployed || 0);
  }
  return lp;
}

export function getAllBalanceSheetPartners(status = null) {
  let sql = 'SELECT * FROM balance_sheet_partners';
  const params = [];
  if (status) { sql += ' WHERE status = ?'; params.push(status); }
  sql += ' ORDER BY name ASC';
  return db.prepare(sql).all(...params).map(lp => {
    if (lp.accepted_instruments_json) lp.acceptedInstruments = JSON.parse(lp.accepted_instruments_json);
    if (lp.risk_tier_preference_json) lp.riskTierPreference = JSON.parse(lp.risk_tier_preference_json);
    if (lp.fee_structure_json) lp.feeStructure = JSON.parse(lp.fee_structure_json);
    lp.capitalAvailable = (lp.total_capital_committed || 0) - (lp.capital_deployed || 0);
    return lp;
  });
}

export function updateBalanceSheetPartner(id, updates) {
  const sets = [];
  const params = [];
  const fieldMap = {
    name: 'name', shortName: 'short_name', contactEmail: 'contact_email', status: 'status',
    totalCapitalCommitted: 'total_capital_committed', capitalDeployed: 'capital_deployed',
    maxSingleExposure: 'max_single_exposure', maxAggregateExposure: 'max_aggregate_exposure',
    minPremiumRate: 'min_premium_rate', maxTermMonths: 'max_term_months',
    autoApproveThreshold: 'auto_approve_threshold',
    masterAgreementDate: 'master_agreement_date', masterAgreementDocUrl: 'master_agreement_doc_url',
  };
  for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
    if (updates[jsKey] !== undefined) { sets.push(`${dbCol} = ?`); params.push(updates[jsKey]); }
  }
  if (updates.acceptedInstruments !== undefined) { sets.push('accepted_instruments_json = ?'); params.push(JSON.stringify(updates.acceptedInstruments)); }
  if (updates.riskTierPreference !== undefined) { sets.push('risk_tier_preference_json = ?'); params.push(JSON.stringify(updates.riskTierPreference)); }
  if (updates.feeStructure !== undefined) { sets.push('fee_structure_json = ?'); params.push(JSON.stringify(updates.feeStructure)); }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  params.push(id);
  return db.prepare(`UPDATE balance_sheet_partners SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// ─── Phase 9b: LP Allocation Helpers ────────────────────────────────────────

export function createLPAllocation(alloc) {
  return db.prepare(`
    INSERT INTO lp_allocations (id, lp_id, quote_request_id, allocated_at, allocated_by, status, auto_approved, structured_terms_json, risk_summary_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(alloc.id, alloc.lpId, alloc.quoteRequestId, alloc.allocatedAt, alloc.allocatedBy, alloc.status || 'pending', alloc.autoApproved ? 1 : 0, JSON.stringify(alloc.structuredTerms), JSON.stringify(alloc.riskSummary));
}

export function getLPAllocation(id) {
  const a = db.prepare('SELECT * FROM lp_allocations WHERE id = ?').get(id);
  if (a) {
    if (a.structured_terms_json) a.structuredTerms = JSON.parse(a.structured_terms_json);
    if (a.risk_summary_json) a.riskSummary = JSON.parse(a.risk_summary_json);
  }
  return a;
}

export function getLPAllocationByQuote(quoteRequestId) {
  const a = db.prepare('SELECT * FROM lp_allocations WHERE quote_request_id = ? ORDER BY created_at DESC LIMIT 1').get(quoteRequestId);
  if (a) {
    if (a.structured_terms_json) a.structuredTerms = JSON.parse(a.structured_terms_json);
    if (a.risk_summary_json) a.riskSummary = JSON.parse(a.risk_summary_json);
  }
  return a;
}

export function getLPAllocations(lpId, status = null) {
  let sql = 'SELECT * FROM lp_allocations WHERE lp_id = ?';
  const params = [lpId];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY allocated_at DESC';
  return db.prepare(sql).all(...params).map(a => {
    if (a.structured_terms_json) a.structuredTerms = JSON.parse(a.structured_terms_json);
    if (a.risk_summary_json) a.riskSummary = JSON.parse(a.risk_summary_json);
    return a;
  });
}

export function updateLPAllocation(id, updates) {
  const sets = [];
  const params = [];
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.reviewedAt !== undefined) { sets.push('reviewed_at = ?'); params.push(updates.reviewedAt); }
  if (updates.reviewedBy !== undefined) { sets.push('reviewed_by = ?'); params.push(updates.reviewedBy); }
  if (updates.reviewNotes !== undefined) { sets.push('review_notes = ?'); params.push(updates.reviewNotes); }
  if (updates.modificationRequested !== undefined) { sets.push('modification_requested = ?'); params.push(updates.modificationRequested); }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  params.push(id);
  return db.prepare(`UPDATE lp_allocations SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// ─── Phase 9b: LP Portfolio Helpers ─────────────────────────────────────────

export function getLPPortfolioMetrics(lpId) {
  const policies = db.prepare(`SELECT COUNT(*) as count, SUM(covered_hashrate) as totalHashrate, SUM(monthly_premium) as totalPremium FROM insurance_policies WHERE lp_id = ? AND status = 'active'`).get(lpId);
  const claims = db.prepare(`SELECT COUNT(*) as count, SUM(paid_amount) as totalPaid FROM insurance_claims WHERE lp_id = ? AND status = 'paid'`).get(lpId);
  const pendingClaims = db.prepare(`SELECT COUNT(*) as count, SUM(gross_claim_amount) as totalPending FROM insurance_claims WHERE lp_id = ? AND status IN ('pending', 'verified')`).get(lpId);
  const lp = getBalanceSheetPartner(lpId);
  return {
    activePolicies: policies.count || 0,
    totalCoveredHashrate: policies.totalHashrate || 0,
    monthlyPremiumIncome: policies.totalPremium || 0,
    totalClaimsPaid: claims.totalPaid || 0,
    pendingClaimsCount: pendingClaims.count || 0,
    pendingClaimsAmount: pendingClaims.totalPending || 0,
    lossRatio: policies.totalPremium ? (claims.totalPaid || 0) / ((policies.totalPremium || 1) * 12) : 0,
    capitalCommitted: lp?.total_capital_committed || 0,
    capitalDeployed: lp?.capital_deployed || 0,
    capitalAvailable: lp?.capitalAvailable || 0,
  };
}

export function getLPPolicies(lpId) {
  return db.prepare(`
    SELECT ip.*, t.name as tenant_name
    FROM insurance_policies ip
    LEFT JOIN tenants t ON ip.tenant_id = t.id
    WHERE ip.lp_id = ? AND ip.status = 'active'
    ORDER BY ip.created_at DESC
  `).all(lpId).map(p => {
    if (p.terms_json) p.terms = JSON.parse(p.terms_json);
    return p;
  });
}

export function getLPClaims(lpId, status = null) {
  let sql = `SELECT ic.*, ip.policy_number, ip.floor_price as policy_floor
    FROM insurance_claims ic
    JOIN insurance_policies ip ON ic.policy_id = ip.id
    WHERE ic.lp_id = ?`;
  const params = [lpId];
  if (status) { sql += ' AND ic.settlement_status = ?'; params.push(status); }
  sql += ' ORDER BY ic.claim_month DESC';
  return db.prepare(sql).all(...params).map(c => {
    if (c.verification_json) c.verification = JSON.parse(c.verification_json);
    return c;
  });
}

export function getPortfolioMetricsByLP() {
  return db.prepare(`
    SELECT bsp.id as lp_id, bsp.name as lp_name, bsp.short_name,
      COUNT(ip.id) as policy_count,
      COALESCE(SUM(ip.covered_hashrate), 0) as total_hashrate,
      COALESCE(SUM(ip.monthly_premium), 0) as monthly_premium,
      bsp.total_capital_committed, bsp.capital_deployed
    FROM balance_sheet_partners bsp
    LEFT JOIN insurance_policies ip ON ip.lp_id = bsp.id AND ip.status = 'active'
    WHERE bsp.status = 'active'
    GROUP BY bsp.id
    ORDER BY bsp.name
  `).all();
}

export function getSanghaRevenueBreakdown() {
  const fees = db.prepare(`
    SELECT
      COALESCE(SUM(monthly_premium), 0) as total_miner_premiums,
      COALESCE(SUM(structuring_fee_monthly), 0) as total_structuring_fees,
      COALESCE(SUM(management_fee_monthly), 0) as total_management_fees,
      COALESCE(SUM(monthly_premium - COALESCE(structuring_fee_monthly, 0) - COALESCE(management_fee_monthly, 0)), 0) as total_lp_premium_share
    FROM insurance_policies
    WHERE status = 'active'
  `).get();
  return {
    totalMinerPremiums: fees.total_miner_premiums || 0,
    totalStructuringFees: fees.total_structuring_fees || 0,
    totalManagementFees: fees.total_management_fees || 0,
    totalLPPremiumShare: fees.total_lp_premium_share || 0,
    sanghaNetRevenue: (fees.total_structuring_fees || 0) + (fees.total_management_fees || 0),
  };
}

// ─── Phase 10: Bot Registration & Team Collaboration Tables ─────────────────

function initBotTables(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS bot_registrations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      bot_type TEXT NOT NULL,
      config_json TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS bot_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      event_key TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_bot_reg_tenant ON bot_registrations(tenant_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_bot_reg_user ON bot_registrations(user_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_bot_comments_event ON bot_comments(event_key)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_bot_comments_tenant ON bot_comments(tenant_id)'); } catch (e) {}
}

// ─── Bot Registration Helpers ───────────────────────────────────────────────

export function createBotRegistration({ id, tenantId, userId, name, botType, configJson }) {
  return db.prepare(
    `INSERT INTO bot_registrations (id, tenant_id, user_id, name, bot_type, config_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, tenantId, userId, name, botType, configJson || null);
}

export function getBotRegistrationsByTenant(tenantId) {
  return db.prepare(
    `SELECT br.*, u.name as owner_name, u.email as owner_email
     FROM bot_registrations br
     LEFT JOIN users u ON br.user_id = u.id
     WHERE br.tenant_id = ?
     ORDER BY br.created_at DESC`
  ).all(tenantId);
}

export function getBotRegistrationsByUser(userId) {
  return db.prepare(
    'SELECT * FROM bot_registrations WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
}

export function updateBotRegistration(id, userId, { name, configJson, status }) {
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (configJson !== undefined) { fields.push('config_json = ?'); values.push(configJson); }
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(id, userId);
  return db.prepare(
    `UPDATE bot_registrations SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`
  ).run(...values);
}

export function deleteBotRegistration(id, userId) {
  return db.prepare('DELETE FROM bot_registrations WHERE id = ? AND user_id = ?').run(id, userId);
}

// ─── Bot Comment Helpers ────────────────────────────────────────────────────

export function addBotComment({ tenantId, userId, userName, eventKey, text }) {
  return db.prepare(
    `INSERT INTO bot_comments (tenant_id, user_id, user_name, event_key, text)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tenantId, userId, userName, eventKey, text);
}

export function getBotComments(eventKey, tenantId) {
  return db.prepare(
    'SELECT * FROM bot_comments WHERE event_key = ? AND tenant_id = ? ORDER BY created_at ASC'
  ).all(eventKey, tenantId);
}

export function getBotCommentCounts(eventKeys, tenantId) {
  if (!eventKeys.length) return {};
  const placeholders = eventKeys.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT event_key, COUNT(*) as count FROM bot_comments
     WHERE event_key IN (${placeholders}) AND tenant_id = ?
     GROUP BY event_key`
  ).all(...eventKeys, tenantId);
  const counts = {};
  for (const row of rows) counts[row.event_key] = row.count;
  return counts;
}

// ─── DACP Construction Tables & Helpers ──────────────────────────────────────

function initDacpTablesSchema(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_pricing (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      category TEXT NOT NULL,
      item TEXT NOT NULL,
      unit TEXT NOT NULL,
      material_cost REAL,
      labor_cost REAL,
      equipment_cost REAL,
      unit_price REAL,
      notes TEXT
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_bid_requests (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      from_email TEXT,
      from_name TEXT,
      gc_name TEXT,
      subject TEXT,
      body TEXT,
      attachments_json TEXT,
      scope_json TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'new',
      urgency TEXT DEFAULT 'medium',
      missing_info_json TEXT,
      received_at TEXT,
      workflow_step INTEGER DEFAULT 0,
      pass_reason TEXT,
      itb_analysis_json TEXT,
      scope_breakdown_json TEXT,
      plan_checklist_json TEXT
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_prequal_packages (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      gc_name TEXT NOT NULL,
      gc_contact_name TEXT,
      gc_contact_email TEXT,
      status TEXT DEFAULT 'not_sent',
      sent_date TEXT,
      received_date TEXT,
      expiry_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_estimates (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bid_request_id TEXT,
      project_name TEXT,
      gc_name TEXT,
      status TEXT DEFAULT 'draft',
      line_items_json TEXT,
      subtotal REAL,
      overhead_pct REAL DEFAULT 10,
      profit_pct REAL DEFAULT 15,
      mobilization REAL DEFAULT 0,
      total_bid REAL,
      confidence TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_jobs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      estimate_id TEXT,
      project_name TEXT,
      gc_name TEXT,
      project_type TEXT,
      location TEXT,
      status TEXT DEFAULT 'active',
      estimated_cost REAL,
      actual_cost REAL,
      bid_amount REAL,
      margin_pct REAL,
      start_date TEXT,
      end_date TEXT,
      notes TEXT
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_field_reports (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      job_id TEXT,
      date TEXT,
      reported_by TEXT,
      work_json TEXT,
      materials_json TEXT,
      labor_json TEXT,
      equipment_json TEXT,
      weather TEXT,
      notes TEXT,
      issues_json TEXT
    )
  `);

  // ─── Bid Documents (uploaded ITB attachments, specs, plans) ─────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_bid_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bid_request_id TEXT NOT NULL,
      filename TEXT,
      file_type TEXT,
      file_path TEXT,
      drive_file_id TEXT,
      drive_url TEXT,
      parsed_text TEXT,
      page_count INTEGER,
      csi_divisions_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── Plan Analyses (plan images + PlanSwift quantity exports) ──────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_plan_analyses (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bid_request_id TEXT NOT NULL,
      filename TEXT,
      file_type TEXT,
      file_path TEXT,
      analysis_json TEXT,
      quantities_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ─── Concrete Pumping Operations ────────────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_pumping_equipment (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('boom_pump', 'line_pump')),
      model TEXT,
      year INTEGER,
      status TEXT DEFAULT 'available' CHECK(status IN ('available', 'in_use', 'maintenance', 'out_of_service')),
      hourly_rate REAL,
      daily_rate REAL,
      last_service_date TEXT,
      next_service_date TEXT,
      notes TEXT
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_pumping_jobs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      equipment_id TEXT,
      customer_name TEXT NOT NULL,
      customer_email TEXT,
      customer_phone TEXT,
      job_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      concrete_type TEXT,
      estimated_yards INTEGER,
      actual_yards INTEGER,
      status TEXT DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show')),
      invoice_amount REAL,
      invoice_status TEXT DEFAULT 'pending' CHECK(invoice_status IN ('pending', 'sent', 'paid', 'overdue', 'void')),
      invoice_sent_date TEXT,
      payment_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_pumping_jobs_tenant ON dacp_pumping_jobs(tenant_id, job_date)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_pumping_jobs_status ON dacp_pumping_jobs(tenant_id, status)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_pumping_equip_tenant ON dacp_pumping_equipment(tenant_id)'); } catch (e) {}

  // ─── Marketing / Business Development ───────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_marketing_leads (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      source TEXT CHECK(source IN ('web_scrape', 'linkedin', 'referral', 'cold_outreach', 'inbound', 'news_alert')),
      company_name TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      project_name TEXT,
      project_value REAL,
      project_location TEXT,
      gc_name TEXT,
      status TEXT DEFAULT 'new' CHECK(status IN ('new', 'contacted', 'responded', 'qualified', 'proposal_sent', 'won', 'lost', 'stale')),
      last_contact_date TEXT,
      next_followup_date TEXT,
      outreach_count INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_marketing_campaigns (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('email_outreach', 'linkedin', 'event', 'referral_program', 'content')),
      status TEXT DEFAULT 'active' CHECK(status IN ('draft', 'active', 'paused', 'completed')),
      leads_generated INTEGER DEFAULT 0,
      responses INTEGER DEFAULT 0,
      meetings_booked INTEGER DEFAULT 0,
      deals_won INTEGER DEFAULT 0,
      total_pipeline_value REAL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_marketing_leads_tenant ON dacp_marketing_leads(tenant_id, status)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_tenant ON dacp_marketing_campaigns(tenant_id, status)'); } catch (e) {}

  // ─── Compliance & Permits ───────────────────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_compliance_items (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('license', 'permit', 'insurance', 'certification', 'osha', 'bonding', 'vehicle_reg')),
      name TEXT NOT NULL,
      issuing_authority TEXT,
      number TEXT,
      state TEXT,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'expiring_soon', 'expired', 'pending_renewal', 'suspended')),
      issue_date TEXT,
      expiry_date TEXT,
      renewal_cost REAL,
      responsible_person TEXT,
      notes TEXT,
      last_checked TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_compliance_incidents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT CHECK(type IN ('osha_violation', 'safety_incident', 'inspection_failure', 'audit_finding', 'insurance_claim', 'permit_violation')),
      severity TEXT CHECK(severity IN ('low', 'medium', 'high', 'critical')),
      description TEXT NOT NULL,
      job_id TEXT,
      reported_by TEXT,
      reported_date TEXT,
      resolution TEXT,
      resolved_date TEXT,
      cost REAL,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'investigating', 'resolved', 'escalated')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_compliance_items_tenant ON dacp_compliance_items(tenant_id, category)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_compliance_items_expiry ON dacp_compliance_items(tenant_id, expiry_date)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_compliance_incidents_tenant ON dacp_compliance_incidents(tenant_id, status)'); } catch (e) {}

  // ─── CEO Dashboard Reports ─────────────────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS ceo_department_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      department TEXT NOT NULL CHECK(department IN ('estimating', 'pumping', 'marketing', 'compliance', 'overall')),
      period TEXT NOT NULL,
      kpi_data_json TEXT,
      red_flags_json TEXT,
      summary TEXT,
      generated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_ceo_reports_tenant ON ceo_department_reports(tenant_id, department, generated_at)'); } catch (e) {}

  // ─── DACP Suppliers ─────────────────────────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_suppliers (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      supplier_type TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      lat REAL,
      lng REAL,
      website TEXT,
      pricing_json TEXT,
      delivery_radius_miles INTEGER,
      response_rate REAL DEFAULT 0,
      avg_lead_days INTEGER,
      last_quote_date TEXT,
      notes TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_suppliers_tenant ON dacp_suppliers(tenant_id, supplier_type)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_suppliers_region ON dacp_suppliers(tenant_id, state, city)'); } catch (e) {}

  // ─── DACP RFIs ──────────────────────────────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_rfis (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bid_request_id TEXT,
      job_id TEXT,
      gc_name TEXT,
      gc_email TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      category TEXT DEFAULT 'scope',
      status TEXT DEFAULT 'draft',
      sent_date TEXT,
      response_body TEXT,
      response_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_rfis_tenant ON dacp_rfis(tenant_id, status)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_rfis_bid ON dacp_rfis(tenant_id, bid_request_id)'); } catch (e) {}

  // ─── DACP Project Specs ─────────────────────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_project_specs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bid_request_id TEXT,
      job_id TEXT,
      project_name TEXT,
      tax_status TEXT,
      tax_details TEXT,
      labor_requirements_json TEXT,
      bond_required INTEGER DEFAULT 0,
      bond_type TEXT,
      concrete_specs_json TEXT,
      rebar_specs_json TEXT,
      special_conditions_json TEXT,
      vbe_sblvb_required INTEGER DEFAULT 0,
      vbe_sblvb_details TEXT,
      parsed_from_doc_id TEXT,
      raw_extracted_text TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_specs_tenant ON dacp_project_specs(tenant_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_specs_bid ON dacp_project_specs(tenant_id, bid_request_id)'); } catch (e) {}

  // ─── Construction Tax Rules (multi-state) ──────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS construction_tax_rules (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      state TEXT NOT NULL,
      state_name TEXT NOT NULL,
      base_sales_tax_rate REAL NOT NULL,
      max_combined_rate REAL,
      contractor_classification TEXT NOT NULL,
      contractor_model_description TEXT,
      govt_project_exempt INTEGER DEFAULT 0,
      govt_exemption_mechanism TEXT,
      govt_exemption_form TEXT,
      bond_threshold INTEGER,
      bond_amount_pct REAL DEFAULT 100,
      bond_tiers_json TEXT,
      prevailing_wage INTEGER DEFAULT 0,
      prevailing_wage_threshold INTEGER,
      prevailing_wage_notes TEXT,
      labor_taxable INTEGER DEFAULT 0,
      labor_tax_notes TEXT,
      use_tax_rate REAL,
      special_taxes_json TEXT,
      mpc_details_json TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { targetDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_rules_state ON construction_tax_rules(tenant_id, state)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_tax_rules_tenant ON construction_tax_rules(tenant_id)'); } catch (e) {}

  // ─── DACP Bid Distributions ─────────────────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_bid_distributions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bid_request_id TEXT,
      estimate_id TEXT,
      project_name TEXT NOT NULL,
      gc_name TEXT NOT NULL,
      gc_email TEXT,
      gc_contact TEXT,
      gc_reputation TEXT,
      adjusted_total REAL,
      adjustment_reason TEXT,
      bid_status TEXT DEFAULT 'draft',
      sent_date TEXT,
      response_date TEXT,
      response_amount REAL,
      award_status TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_distributions_tenant ON dacp_bid_distributions(tenant_id, bid_status)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_distributions_bid ON dacp_bid_distributions(tenant_id, bid_request_id)'); } catch (e) {}

  // ─── DACP Bond Program ──────────────────────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_bond_program (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      surety_company TEXT NOT NULL,
      surety_contact TEXT,
      surety_email TEXT,
      surety_phone TEXT,
      total_capacity REAL,
      current_utilization REAL DEFAULT 0,
      tiers_json TEXT,
      current_rate_pct REAL,
      market_benchmark_pct REAL,
      rate_flag TEXT,
      effective_date TEXT,
      expiry_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_bond_tenant ON dacp_bond_program(tenant_id)'); } catch (e) {}

  // ─── DACP GC Offices (Sales Trip Planner) ─────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_gc_offices (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      gc_name TEXT NOT NULL,
      address TEXT,
      city TEXT,
      state TEXT,
      zip TEXT,
      lat REAL,
      lng REAL,
      phone TEXT,
      website TEXT,
      office_type TEXT DEFAULT 'main',
      notes TEXT,
      geocoded_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_gc_offices_tenant ON dacp_gc_offices(tenant_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_gc_offices_gc ON dacp_gc_offices(tenant_id, gc_name)'); } catch (e) {}

  // ─── DACP Sales Trips ─────────────────────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS dacp_sales_trips (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      date TEXT,
      status TEXT DEFAULT 'planned',
      stops_json TEXT,
      route_url TEXT,
      total_distance_mi REAL,
      total_duration_min REAL,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_sales_trips_tenant ON dacp_sales_trips(tenant_id, status)'); } catch (e) {}

  // Chat messages
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_chat_tenant_agent_user ON chat_messages(tenant_id, agent_id, user_id, created_at)'); } catch (e) {}

  // Chat threads
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT,
      visibility TEXT NOT NULL DEFAULT 'private'
        CHECK(visibility IN ('private', 'team', 'pinned')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_threads_tenant_agent ON chat_threads(tenant_id, agent_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_threads_visibility ON chat_threads(tenant_id, visibility)'); } catch (e) {}

  // Add thread_id column to chat_messages (idempotent)
  try { targetDb.exec('ALTER TABLE chat_messages ADD COLUMN thread_id TEXT REFERENCES chat_threads(id)'); } catch (e) { /* already exists */ }

  // Add is_pinned column to chat_threads (idempotent)
  try { targetDb.exec('ALTER TABLE chat_threads ADD COLUMN is_pinned INTEGER DEFAULT 0'); } catch (e) { /* already exists */ }

  // Thread context summaries - shared across sibling threads for cross-thread awareness
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS thread_summaries (
      thread_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      user_id TEXT,
      summary TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_thread_summaries_agent ON thread_summaries(tenant_id, agent_id)'); } catch (e) {}

  // Approval queue
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS approval_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL CHECK(type IN ('email_draft', 'curtailment', 'estimate', 'report', 'config_change', 'document', 'tool_action', 'meeting_instruction')),
      payload_json TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      required_role TEXT DEFAULT 'admin',
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_approval_tenant_status ON approval_items(tenant_id, status, created_at)'); } catch (e) {}

  // Platform notifications (multi-tenant)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS platform_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      user_id TEXT,
      agent_id TEXT,
      title TEXT NOT NULL,
      body TEXT,
      type TEXT DEFAULT 'info' CHECK(type IN ('info', 'warning', 'action', 'success')),
      link_tab TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_notif_tenant_user ON platform_notifications(tenant_id, user_id, read, created_at)'); } catch (e) {}

  // Leads sheet shares (per-user leads sheet sharing + consolidation)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS leads_sheet_shares (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      from_user_id TEXT NOT NULL,
      from_user_name TEXT,
      to_user_id TEXT NOT NULL,
      sheet_id TEXT NOT NULL,
      sheet_title TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined')),
      notification_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_leads_shares_to_user ON leads_sheet_shares(tenant_id, to_user_id, status)'); } catch (e) {}

  // Indices
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_pricing_tenant ON dacp_pricing(tenant_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_bids_tenant ON dacp_bid_requests(tenant_id, status)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_estimates_tenant ON dacp_estimates(tenant_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_jobs_tenant ON dacp_jobs(tenant_id, status)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_reports_tenant ON dacp_field_reports(tenant_id, job_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_bid_docs_tenant ON dacp_bid_documents(tenant_id, bid_request_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dacp_plan_analyses_tenant ON dacp_plan_analyses(tenant_id, bid_request_id)'); } catch (e) {}

  // Migrate dacp_bid_requests - add workflow columns (idempotent)
  try { targetDb.exec("ALTER TABLE dacp_bid_requests ADD COLUMN workflow_step INTEGER DEFAULT 0"); } catch (e) { /* already exists */ }
  try { targetDb.exec("ALTER TABLE dacp_bid_requests ADD COLUMN pass_reason TEXT"); } catch (e) { /* already exists */ }
  try { targetDb.exec("ALTER TABLE dacp_bid_requests ADD COLUMN itb_analysis_json TEXT"); } catch (e) { /* already exists */ }
  try { targetDb.exec("ALTER TABLE dacp_bid_requests ADD COLUMN scope_breakdown_json TEXT"); } catch (e) { /* already exists */ }
  try { targetDb.exec("ALTER TABLE dacp_bid_requests ADD COLUMN plan_checklist_json TEXT"); } catch (e) { /* already exists */ }

  // ─── Knowledge Graph Tables ─────────────────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      transcript TEXT,
      content TEXT,
      source TEXT,
      source_agent TEXT,
      duration_seconds INTEGER,
      recorded_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      processed INTEGER DEFAULT 0,
      drive_file_id TEXT,
      drive_url TEXT
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_tenant ON knowledge_entries(tenant_id, type, created_at)'); } catch (e) {}

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entities (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      metadata_json TEXT
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_kn_entities_tenant ON knowledge_entities(tenant_id, entity_type)'); } catch (e) {}

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_links (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      relationship TEXT,
      FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id),
      FOREIGN KEY (entity_id) REFERENCES knowledge_entities(id)
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_kn_links_entry ON knowledge_links(entry_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_kn_links_entity ON knowledge_links(entity_id)'); } catch (e) {}

  // HubSpot contact classifications (local - not pushed to HubSpot)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS hubspot_classifications (
      hubspot_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      company TEXT,
      title TEXT,
      domain TEXT,
      industry TEXT,
      reason TEXT,
      materials TEXT,
      reasoning TEXT,
      confidence INTEGER DEFAULT 50,
      classified_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (hubspot_id, tenant_id)
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_hs_class_tenant ON hubspot_classifications(tenant_id, industry)'); } catch (e) {}

  // Context pins - items pinned to chat threads (entities, files, notes, threads)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS context_pins (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      pin_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      label TEXT,
      metadata_json TEXT,
      pinned_by TEXT NOT NULL DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_context_pins_thread ON context_pins(tenant_id, thread_id)'); } catch (e) {}

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS action_items (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      title TEXT NOT NULL,
      assignee TEXT,
      due_date TEXT,
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_action_items_tenant ON action_items(tenant_id, status)'); } catch (e) {}

  // Add completed_at / completed_by columns to action_items (idempotent)
  try { targetDb.exec("ALTER TABLE action_items ADD COLUMN completed_at TEXT"); } catch (e) { /* already exists */ }
  try { targetDb.exec("ALTER TABLE action_items ADD COLUMN completed_by TEXT"); } catch (e) { /* already exists */ }

  // Agent memory - per-tenant persistent memory for CLI agent context
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_memory_tenant_key ON agent_memory(tenant_id, key)'); } catch (e) {}
  // Add visibility column for two-tier info access (default 'internal' - only 'public' entries visible to external emails)
  try { targetDb.exec("ALTER TABLE agent_memory ADD COLUMN visibility TEXT DEFAULT 'internal'"); } catch (e) {}

  // Add visibility column to knowledge_entries for two-tier info access
  try { targetDb.exec("ALTER TABLE knowledge_entries ADD COLUMN visibility TEXT DEFAULT 'internal'"); } catch (e) {}
  try { targetDb.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_visibility ON knowledge_entries(tenant_id, visibility)"); } catch (e) {}

  // Meeting experience columns (Fireflies-like sharing, audio, diarized transcript)
  try { targetDb.exec("ALTER TABLE knowledge_entries ADD COLUMN audio_url TEXT"); } catch (e) {}
  try { targetDb.exec("ALTER TABLE knowledge_entries ADD COLUMN share_token TEXT"); } catch (e) {}
  try { targetDb.exec("ALTER TABLE knowledge_entries ADD COLUMN share_enabled INTEGER DEFAULT 0"); } catch (e) {}
  try { targetDb.exec("ALTER TABLE knowledge_entries ADD COLUMN transcript_json TEXT"); } catch (e) {}
  try { targetDb.exec("ALTER TABLE knowledge_entries ADD COLUMN shared_emails TEXT DEFAULT '[]'"); } catch (e) {}
  try { targetDb.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_share_token ON knowledge_entries(share_token)"); } catch (e) {}

  // Agent insights table (for Command dashboard)
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_insights (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'insight',
      category TEXT,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'medium',
      actions_json TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_insights_tenant ON agent_insights(tenant_id, status, created_at)'); } catch (e) {}

  // ─── Lead Engine Tables ──────────────────────────────────────────────
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS le_leads (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      venue_name TEXT NOT NULL,
      region TEXT, industry TEXT, trigger_news TEXT,
      priority_score INTEGER DEFAULT 0,
      website TEXT,
      status TEXT DEFAULT 'new',
      source TEXT DEFAULT 'discovery',
      source_query TEXT,
      discovered_at TEXT DEFAULT CURRENT_TIMESTAMP,
      contacted_at TEXT, responded_at TEXT,
      notes TEXT, agent_notes TEXT,
      UNIQUE(tenant_id, venue_name)
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS le_contacts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      lead_id TEXT NOT NULL REFERENCES le_leads(id),
      name TEXT, email TEXT NOT NULL,
      title TEXT, phone TEXT,
      source TEXT DEFAULT 'discovery',
      mx_valid INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(lead_id, email)
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS le_outreach_log (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      lead_id TEXT NOT NULL REFERENCES le_leads(id),
      contact_id TEXT REFERENCES le_contacts(id),
      email_type TEXT DEFAULT 'initial',
      subject TEXT, body TEXT,
      status TEXT DEFAULT 'draft',
      sent_at TEXT, opened_at TEXT, responded_at TEXT,
      bounce_reason TEXT,
      gmail_message_id TEXT, gmail_thread_id TEXT,
      approved_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS le_discovery_config (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL UNIQUE,
      queries_json TEXT,
      regions_json TEXT,
      current_position INTEGER DEFAULT 0,
      queries_per_cycle INTEGER DEFAULT 2,
      max_emails_per_cycle INTEGER DEFAULT 10,
      followup_delay_days INTEGER DEFAULT 5,
      max_followups INTEGER DEFAULT 2,
      min_send_interval_seconds INTEGER DEFAULT 300,
      last_full_cycle TEXT, last_inbox_check TEXT,
      enabled INTEGER DEFAULT 0,
      mode TEXT DEFAULT 'copilot',
      sender_name TEXT, sender_email TEXT,
      email_signature TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_le_leads_tenant ON le_leads(tenant_id, status)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_le_contacts_lead ON le_contacts(lead_id)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_le_outreach_tenant ON le_outreach_log(tenant_id, status)'); } catch (e) {}

  console.log('DACP tables schema initialized');
}

function initDacpSeedData(targetDb, tenantId) {
  // Seed knowledge entities
  const knEntCount = targetDb.prepare('SELECT COUNT(*) as c FROM knowledge_entities').get();
  if (knEntCount.c === 0) {
    const seedEntities = targetDb.prepare('INSERT OR IGNORE INTO knowledge_entities (id, tenant_id, entity_type, name, metadata_json) VALUES (?, ?, ?, ?, ?)');
    const sanghaId = SANGHA_TENANT_ID;
    const dacpId = 'dacp-construction-001';

    // Sangha people
    seedEntities.run('ent-s-p1', sanghaId, 'person', 'Spencer Marr', '{"role":"CEO"}');
    seedEntities.run('ent-s-p2', sanghaId, 'person', 'Mihir Bhangley', '{"role":"Operations"}');
    seedEntities.run('ent-s-p3', sanghaId, 'person', 'Marcel Pineda', '{"role":"Engineering"}');
    seedEntities.run('ent-s-p4', sanghaId, 'person', 'Teo Blind', '{"role":"CTO"}');
    seedEntities.run('ent-s-p5', sanghaId, 'person', 'Adam Reeve', '{"role":"Insurance"}');
    seedEntities.run('ent-s-p6', sanghaId, 'person', 'Miguel Alvarez', '{"role":"Modeling"}');
    seedEntities.run('ent-s-p7', sanghaId, 'person', 'Jason Gunderson', '{"role":"LP Relations"}');

    // Sangha companies
    seedEntities.run('ent-s-c1', sanghaId, 'company', 'Sangha Renewables', null);
    seedEntities.run('ent-s-c2', sanghaId, 'company', 'Reassurity', null);
    seedEntities.run('ent-s-c3', sanghaId, 'company', 'Total Energies', null);
    seedEntities.run('ent-s-c4', sanghaId, 'company', 'Meridian Renewables', null);
    seedEntities.run('ent-s-c5', sanghaId, 'company', 'GridScale Partners', null);
    seedEntities.run('ent-s-c6', sanghaId, 'company', 'SunPeak Energy', null);

    // Sangha projects
    seedEntities.run('ent-s-pr1', sanghaId, 'project', 'Oberon Solar', null);
    seedEntities.run('ent-s-pr2', sanghaId, 'project', 'Insurance Product', null);
    seedEntities.run('ent-s-pr3', sanghaId, 'project', 'SanghaModel', null);

    // Sangha sites
    seedEntities.run('ent-s-si1', sanghaId, 'site', 'ERCOT West', null);
    seedEntities.run('ent-s-si2', sanghaId, 'site', 'HB_WEST', null);
    seedEntities.run('ent-s-si3', sanghaId, 'site', 'HB_NORTH', null);

    // DACP people
    seedEntities.run('ent-d-p1', dacpId, 'person', 'David Castillo', '{"role":"Owner"}');
    seedEntities.run('ent-d-p2', dacpId, 'person', 'Mike Rodriguez', '{"role":"Superintendent"}');
    seedEntities.run('ent-d-p3', dacpId, 'person', 'Sarah Williams', '{"role":"Estimator"}');
    seedEntities.run('ent-d-p4', dacpId, 'person', 'James Park', '{"role":"Project Manager"}');
    seedEntities.run('ent-d-p5', dacpId, 'person', 'Lisa Chen', '{"role":"Office Manager"}');
    seedEntities.run('ent-d-p6', dacpId, 'person', 'Robert Torres', '{"role":"Foreman"}');

    // DACP companies
    seedEntities.run('ent-d-c1', dacpId, 'company', 'DACP Construction', null);
    seedEntities.run('ent-d-c2', dacpId, 'company', 'Turner Construction', null);
    seedEntities.run('ent-d-c3', dacpId, 'company', 'McCarthy Building', null);
    seedEntities.run('ent-d-c4', dacpId, 'company', 'Hensel Phelps', null);
    seedEntities.run('ent-d-c5', dacpId, 'company', 'DPR Construction', null);
    seedEntities.run('ent-d-c6', dacpId, 'company', 'Skanska', null);

    // DACP projects
    seedEntities.run('ent-d-pr1', dacpId, 'project', 'Memorial Hermann Phase 1', null);
    seedEntities.run('ent-d-pr2', dacpId, 'project', 'Memorial Hermann Phase 2', null);
    seedEntities.run('ent-d-pr3', dacpId, 'project', 'Westpark Retail', null);
    seedEntities.run('ent-d-pr4', dacpId, 'project', "St. Luke's Parking", null);

    // DACP sites
    seedEntities.run('ent-d-si1', dacpId, 'site', 'Houston', null);
    seedEntities.run('ent-d-si2', dacpId, 'site', 'Austin', null);
    seedEntities.run('ent-d-si3', dacpId, 'site', 'Dallas', null);
    seedEntities.run('ent-d-si4', dacpId, 'site', 'San Antonio', null);

    console.log('Knowledge entities seeded (Sangha + DACP)');
  }

  // Seed data from JSON files
  const dacpDataDir = join(__dirname, '../data/dacp');
  const existing = targetDb.prepare('SELECT COUNT(*) as c FROM dacp_pricing WHERE tenant_id = ?').get('dacp-construction-001');
  if (existing.c === 0 && fs.existsSync(join(dacpDataDir, 'pricing_master.json'))) {
    const TENANT_ID = 'dacp-construction-001';
    const loadJson = (f) => JSON.parse(fs.readFileSync(join(dacpDataDir, f), 'utf-8'));

    const pricing = loadJson('pricing_master.json');
    const insertPricing = targetDb.prepare(`INSERT OR IGNORE INTO dacp_pricing (id, tenant_id, category, item, unit, material_cost, labor_cost, equipment_cost, unit_price, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of pricing) insertPricing.run(p.id, TENANT_ID, p.category, p.item, p.unit, p.material_cost, p.labor_cost, p.equipment_cost, p.unit_price, p.notes);

    const jobs = loadJson('jobs_history.json');
    const insertJob = targetDb.prepare(`INSERT OR IGNORE INTO dacp_jobs (id, tenant_id, estimate_id, project_name, gc_name, project_type, location, status, estimated_cost, actual_cost, bid_amount, margin_pct, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const j of jobs) insertJob.run(j.id, TENANT_ID, null, j.project_name, j.gc_name, j.project_type, j.location, j.status, j.estimated_cost, j.actual_cost, j.bid_amount, j.margin_pct, j.start_date, j.end_date, j.notes);

    const bidRequests = loadJson('bid_requests_inbox.json');
    const insertBid = targetDb.prepare(`INSERT OR IGNORE INTO dacp_bid_requests (id, tenant_id, from_email, from_name, gc_name, subject, body, attachments_json, scope_json, due_date, status, urgency, missing_info_json, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const b of bidRequests) insertBid.run(b.id, TENANT_ID, b.from_email, b.from_name, b.gc_name, b.subject, b.body, JSON.stringify(b.attachments), JSON.stringify(b.scope), b.due_date, b.status, b.urgency, JSON.stringify(b.missing_info), b.received_at);

    const fieldLogs = loadJson('field_logs.json');
    const insertReport = targetDb.prepare(`INSERT OR IGNORE INTO dacp_field_reports (id, tenant_id, job_id, date, reported_by, work_json, materials_json, labor_json, equipment_json, weather, notes, issues_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const f of fieldLogs) insertReport.run(f.id, TENANT_ID, f.job_id, f.date, f.reported_by, JSON.stringify(f.work_performed), JSON.stringify(f.materials_used), JSON.stringify(f.labor), JSON.stringify(f.equipment), f.weather, f.notes, JSON.stringify(f.issues));

    console.log(`DACP: Seeded ${pricing.length} pricing, ${jobs.length} jobs, ${bidRequests.length} bids, ${fieldLogs.length} field reports`);

    // Generate demo estimates for first 5 bid requests (Step 10)
    const pricingMap = {};
    for (const p of pricing) pricingMap[p.id] = p;

    const KEYWORD_MAP = {
      'slab on grade': 'FW-002', 'sog': 'FW-002', 'slab': 'FW-002', 'strip footing': 'FN-001',
      'spread footing': 'FN-002', 'grade beam': 'FN-003', 'pier': 'FN-004', 'drilled': 'FN-004',
      'curb': 'CG-001', 'sidewalk': 'CG-003', 'retaining wall': 'WL-002', 'cast in place wall': 'WL-002',
      'elevated deck': 'ST-001', 'pt slab': 'ST-001', 'equipment pad': 'FW-003', 'containment': 'WL-003',
      'demo': 'DM-001', 'removal': 'DM-001', 'trench drain': 'AC-004', 'housekeeping': 'FW-001',
      'approach slab': 'FW-003', 'barrier rail': 'CG-001', 'mat foundation': 'FW-003',
      'elevator pit': 'WL-002', 'stair': 'ST-004', 'loading dock': 'FW-003', 'apparatus bay': 'FW-003',
      'drive apron': 'FW-003', 'ada ramp': 'CG-003', 'foundation': 'FN-001',
    };

    for (let i = 0; i < 5 && i < bidRequests.length; i++) {
      const br = bidRequests[i];
      const scope = br.scope || {};
      const items = scope.items || [];
      const lineItems = [];

      for (const item of items) {
        const norm = item.toLowerCase().replace(/[^a-z0-9 ]/g, '');
        const qtyMatch = item.match(/([\d,]+(?:\.\d+)?)\s*(sf|lf|cy|ea|lb|cf)/i);
        const qty = qtyMatch ? parseFloat(qtyMatch[1].replace(/,/g, '')) : 0;
        const unit = qtyMatch ? qtyMatch[2].toUpperCase() : 'EA';

        let matchedId = null;
        for (const [kw, pid] of Object.entries(KEYWORD_MAP)) {
          if (norm.includes(kw)) { matchedId = pid; break; }
        }

        const p = matchedId ? pricingMap[matchedId] : null;
        if (p && qty > 0) {
          lineItems.push({
            description: item, pricingId: p.id, pricingItem: p.item, category: p.category,
            quantity: qty, unit: unit || p.unit, unitPrice: p.unit_price,
            extended: Math.round(qty * p.unit_price * 100) / 100,
          });
        }
      }

      const subtotal = lineItems.reduce((s, li) => s + li.extended, 0);
      const overhead = subtotal * 0.10;
      const profit = (subtotal + overhead) * 0.15;
      let mobilization = subtotal >= 150000 ? 3500 : subtotal >= 50000 ? 2500 : 1500;
      let testing = subtotal >= 100000 ? 2400 : 1200;
      const totalBid = Math.round((subtotal + overhead + profit + mobilization + testing) / 500) * 500;

      const estId = `EST-DEMO-${String(i + 1).padStart(3, '0')}`;
      const projectName = br.subject.replace(/^(RFQ|ITB|RFP|Pricing Request|Budget Pricing|Budget Request|Quick Turn|Bid|Pre-Qual \+ RFQ|FYI):?\s*/i, '').trim();

      targetDb.prepare(`INSERT OR IGNORE INTO dacp_estimates (id, tenant_id, bid_request_id, project_name, gc_name, status, line_items_json, subtotal, overhead_pct, profit_pct, mobilization, total_bid, confidence, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(estId, TENANT_ID, br.id, projectName, br.gc_name, 'draft', JSON.stringify(lineItems), subtotal, 10, 15, mobilization + testing, totalBid,
          lineItems.filter(li => !li.pricingId).length > 0 ? 'medium' : 'high',
          `Auto-generated demo estimate. ${lineItems.length} line items matched.`);

      // Mark bid request as estimated
      targetDb.prepare('UPDATE dacp_bid_requests SET status = ? WHERE id = ? AND tenant_id = ?').run('estimated', br.id, TENANT_ID);
    }
    console.log('DACP: Generated 5 demo estimates');
  }

  // ─── Seed pumping / marketing / compliance (separate check) ──────────
  const TENANT_SEED_ID = 'dacp-construction-001';
  const pumpingCount = targetDb.prepare('SELECT COUNT(*) as c FROM dacp_pumping_equipment WHERE tenant_id = ?').get(TENANT_SEED_ID);
  if (pumpingCount.c === 0) {
    const TENANT_ID = TENANT_SEED_ID;

    // ─── Seed pumping equipment & jobs ───────────────────────────────────
    const insertEquip = targetDb.prepare(`INSERT OR IGNORE INTO dacp_pumping_equipment (id, tenant_id, name, type, model, year, status, hourly_rate, daily_rate, last_service_date, next_service_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertEquip.run('PE-001', TENANT_ID, 'Boom Pump #1', 'boom_pump', 'Putzmeister 47Z', 2021, 'available', 275, 2200, '2026-03-15', '2026-06-15', '47m reach, 5-section boom');
    insertEquip.run('PE-002', TENANT_ID, 'Boom Pump #2', 'boom_pump', 'Schwing S43SX', 2019, 'available', 250, 2000, '2026-02-28', '2026-05-28', '43m reach, recently serviced');
    insertEquip.run('PE-003', TENANT_ID, 'Line Pump #1', 'line_pump', 'Putzmeister TK50', 2022, 'available', 150, 1200, '2026-03-20', '2026-06-20', 'Trailer-mounted, 50 CY/hr');
    insertEquip.run('PE-004', TENANT_ID, 'Line Pump #2', 'line_pump', 'Schwing SP305', 2020, 'maintenance', 140, 1100, '2026-01-10', '2026-04-10', 'Hydraulic seal replacement scheduled');
    insertEquip.run('PE-005', TENANT_ID, 'Line Pump #3', 'line_pump', 'Reed C50HP', 2023, 'available', 160, 1300, '2026-03-10', '2026-06-10', 'High-pressure residential specialist');

    const insertPumpJob = targetDb.prepare(`INSERT OR IGNORE INTO dacp_pumping_jobs (id, tenant_id, equipment_id, customer_name, customer_email, customer_phone, job_date, start_time, end_time, location, concrete_type, estimated_yards, actual_yards, status, invoice_amount, invoice_status, invoice_sent_date, payment_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertPumpJob.run('PJ-001', TENANT_ID, 'PE-001', 'Martinez Concrete', 'jobs@martinezconcrete.com', '713-555-0122', '2026-03-28', '06:00', '14:00', '4500 Westheimer Rd, Houston', '4000 PSI', 180, 175, 'completed', 4400, 'sent', '2026-03-29', null, 'Commercial foundation pour');
    insertPumpJob.run('PJ-002', TENANT_ID, 'PE-002', 'Allied Builders', 'dispatch@alliedbuilders.com', '713-555-0188', '2026-03-29', '07:00', '12:00', '12200 Hwy 290, Cypress', '3500 PSI', 120, 115, 'completed', 3200, 'paid', '2026-03-30', '2026-03-30', 'Retail slab pour');
    insertPumpJob.run('PJ-003', TENANT_ID, 'PE-003', 'Garcia Foundations', 'oscar@garciafdn.com', '832-555-0145', '2026-03-30', '06:30', '11:00', '8800 Memorial Dr, Houston', '5000 PSI', 45, 42, 'completed', 1800, 'pending', null, null, 'Residential foundation');
    insertPumpJob.run('PJ-004', TENANT_ID, 'PE-001', 'Renegade Construction', 'dispatch@renegadeconstruction.com', '281-555-0199', '2026-03-31', '06:00', null, '15000 JFK Blvd, Houston', '4500 PSI', 200, null, 'in_progress', null, 'pending', null, null, 'Data center foundation - Phase 2');
    insertPumpJob.run('PJ-005', TENANT_ID, 'PE-005', 'HomeFirst Builders', 'scheduling@homefirst.com', '713-555-0234', '2026-04-01', '07:00', null, '2200 Kirby Dr, Houston', '3000 PSI', 35, null, 'scheduled', 1400, 'pending', null, null, 'Residential patio pour');
    insertPumpJob.run('PJ-006', TENANT_ID, 'PE-002', 'Clark Construction', 'mike.clark@clarkcon.com', '281-555-0167', '2026-04-01', '06:00', null, '9000 Katy Fwy, Houston', '4000 PSI', 250, null, 'confirmed', null, 'pending', null, null, 'Office tower elevated deck');
    insertPumpJob.run('PJ-007', TENANT_ID, 'PE-003', 'Sunset Homes', 'builds@sunsethomes.com', '832-555-0189', '2026-04-02', '08:00', null, '3400 Bellaire Blvd, Houston', '3500 PSI', 28, null, 'scheduled', 1100, 'pending', null, null, 'Residential driveway + sidewalk');
    // Overdue invoices for red flag demo
    insertPumpJob.run('PJ-008', TENANT_ID, 'PE-001', 'Apex Commercial', 'ap@apexcommercial.com', '713-555-0211', '2026-02-15', '06:00', '15:00', '6600 Richmond Ave, Houston', '4000 PSI', 300, 295, 'completed', 6800, 'overdue', '2026-02-20', null, 'Invoice 45+ days outstanding');
    insertPumpJob.run('PJ-009', TENANT_ID, 'PE-002', 'BuildRight Inc', 'accounting@buildright.com', '281-555-0234', '2026-02-28', '07:00', '13:00', '11000 Louetta Rd, Spring', '3500 PSI', 150, 148, 'completed', 3600, 'overdue', '2026-03-01', null, 'Invoice 30+ days outstanding');

    console.log('DACP: Seeded 5 pumping equipment, 9 pumping jobs');

    // ─── Seed marketing leads & campaigns ────────────────────────────────
    const insertMktLead = targetDb.prepare(`INSERT OR IGNORE INTO dacp_marketing_leads (id, tenant_id, source, company_name, contact_name, contact_email, contact_phone, project_name, project_value, project_location, gc_name, status, last_contact_date, next_followup_date, outreach_count, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertMktLead.run('ML-001', TENANT_ID, 'news_alert', 'Texas Health Resources', 'James Wilson', 'jwilson@texashealth.org', '214-555-0122', 'THR Frisco Medical Campus', 85000000, 'Frisco, TX', 'Turner Construction', 'qualified', '2026-03-28', '2026-04-02', 3, 'Large medical campus - concrete subcontract est. $4-6M');
    insertMktLead.run('ML-002', TENANT_ID, 'linkedin', 'Amazon Web Services', 'Sarah Chen', 'schen@aws.amazon.com', null, 'AWS HOU Data Center Phase 3', 120000000, 'Humble, TX', null, 'contacted', '2026-03-25', '2026-03-30', 2, 'Data center expansion - concrete foundations');
    insertMktLead.run('ML-003', TENANT_ID, 'referral', 'ExxonMobil', null, null, null, 'Baytown Refinery Expansion', 45000000, 'Baytown, TX', 'Kiewit', 'new', null, null, 0, 'Referred by Tom - heavy civil concrete work');
    insertMktLead.run('ML-004', TENANT_ID, 'cold_outreach', 'Hines Development', 'Mark Johnson', 'mjohnson@hines.com', '713-555-0188', 'Midtown Mixed-Use Tower', 200000000, 'Houston, TX', null, 'responded', '2026-03-27', '2026-04-01', 4, 'Interested in structural concrete bid');
    insertMktLead.run('ML-005', TENANT_ID, 'news_alert', 'TXDOT', null, null, null, 'I-45 North Expansion - Segment 3', 340000000, 'Houston, TX', 'Webber LLC', 'new', null, null, 0, 'Highway expansion - curb/gutter/barriers');
    insertMktLead.run('ML-006', TENANT_ID, 'web_scrape', 'Meta Platforms', 'David Kim', 'dkim@meta.com', null, 'Meta Temple Data Center', 800000000, 'Temple, TX', 'Holder Construction', 'proposal_sent', '2026-03-20', '2026-04-05', 5, 'Massive data center - concrete package $12-18M');
    insertMktLead.run('ML-007', TENANT_ID, 'cold_outreach', 'Houston Methodist', 'Linda Park', 'lpark@houstonmethodist.org', '713-555-0199', 'Sugar Land Campus Expansion', 65000000, 'Sugar Land, TX', 'McCarthy Building', 'stale', '2026-02-10', null, 2, 'No response after 2 follow-ups - 45+ days');
    insertMktLead.run('ML-008', TENANT_ID, 'inbound', 'Riot Platforms', 'Bill Stevens', 'bstevens@riotplatforms.com', '512-555-0234', 'Corsicana Phase 2 Expansion', 150000000, 'Corsicana, TX', null, 'qualified', '2026-03-29', '2026-04-03', 1, 'Existing relationship - Phase 1 complete');

    const insertCampaign = targetDb.prepare(`INSERT OR IGNORE INTO dacp_marketing_campaigns (id, tenant_id, name, type, status, leads_generated, responses, meetings_booked, deals_won, total_pipeline_value, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertCampaign.run('MC-001', TENANT_ID, 'TX Data Center Outreach', 'email_outreach', 'active', 12, 4, 2, 0, 320000000, '2026-03-01', null, 'Targeting data center GCs and developers in Texas');
    insertCampaign.run('MC-002', TENANT_ID, 'Houston Medical Expansion', 'linkedin', 'active', 8, 2, 1, 0, 150000000, '2026-03-10', null, 'Medical facility concrete subcontracting');
    insertCampaign.run('MC-003', TENANT_ID, 'TXDOT Highway Projects', 'cold_outreach', 'draft', 0, 0, 0, 0, 0, null, null, 'Heavy civil - highway concrete work');

    console.log('DACP: Seeded 8 marketing leads, 3 campaigns');

    // ─── Seed compliance items ───────────────────────────────────────────
    const insertCompliance = targetDb.prepare(`INSERT OR IGNORE INTO dacp_compliance_items (id, tenant_id, category, name, issuing_authority, number, state, status, issue_date, expiry_date, renewal_cost, responsible_person, notes, last_checked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    // Licenses
    insertCompliance.run('CL-001', TENANT_ID, 'license', 'Building Construction License', 'Louisiana State Licensing Board', 'BC-2021-4458', 'LA', 'active', '2025-07-01', '2026-07-01', 450, 'Danny Cruz', 'Annual renewal', '2026-03-15');
    insertCompliance.run('CL-002', TENANT_ID, 'license', 'Highway/Street/Bridge License', 'Louisiana State Licensing Board', 'HSB-2021-4459', 'LA', 'active', '2025-07-01', '2026-07-01', 450, 'Danny Cruz', 'Annual renewal', '2026-03-15');
    insertCompliance.run('CL-003', TENANT_ID, 'license', 'Heavy Construction License', 'Louisiana State Licensing Board', 'HC-2021-4460', 'LA', 'active', '2025-07-01', '2026-07-01', 450, 'Danny Cruz', 'Annual renewal', '2026-03-15');
    insertCompliance.run('CL-004', TENANT_ID, 'license', 'Texas General Contractor Registration', 'Texas Dept of Licensing', 'TX-GC-88921', 'TX', 'expiring_soon', '2025-04-15', '2026-04-15', 800, 'Franchesca Cox', 'EXPIRES IN 15 DAYS - renewal submitted', '2026-03-31');
    // Insurance
    insertCompliance.run('CL-005', TENANT_ID, 'insurance', 'General Liability Insurance', 'Liberty Mutual', 'GLI-2026-00412', 'TX', 'active', '2026-01-01', '2027-01-01', 28000, 'Franchesca Cox', '$2M per occurrence, $4M aggregate', '2026-03-01');
    insertCompliance.run('CL-006', TENANT_ID, 'insurance', 'Workers Compensation', 'Texas Mutual', 'WC-2026-18834', 'TX', 'active', '2026-01-01', '2027-01-01', 45000, 'Franchesca Cox', 'Experience mod 0.92', '2026-03-01');
    insertCompliance.run('CL-007', TENANT_ID, 'insurance', 'Commercial Auto Policy', 'Progressive', 'CA-2025-77291', 'TX', 'expiring_soon', '2025-05-01', '2026-05-01', 12000, 'Franchesca Cox', 'Covers 8 vehicles + 5 pumps - renewal quote pending', '2026-03-20');
    // Certifications
    insertCompliance.run('CL-008', TENANT_ID, 'certification', 'DBE Certification', 'Texas Unified Certification', 'DBE-TX-2024-1187', 'TX', 'active', '2024-09-01', '2027-09-01', 0, 'Danny Cruz', 'Disadvantaged Business Enterprise - 3yr cycle', '2026-02-15');
    insertCompliance.run('CL-009', TENANT_ID, 'certification', 'OSHA 30-Hour (Tom Mangan)', 'OSHA', 'OSHA30-TM-2024', 'TX', 'active', '2024-06-15', '2029-06-15', 250, 'Tom Mangan', '5-year validity', '2026-01-10');
    insertCompliance.run('CL-010', TENANT_ID, 'certification', 'OSHA 10-Hour (Field Crew)', 'OSHA', null, 'TX', 'expired', '2023-03-01', '2026-03-01', 150, 'Mike Rodriguez', '3 crew members need renewal - OVERDUE', '2026-03-31');
    // Bonding
    insertCompliance.run('CL-011', TENANT_ID, 'bonding', 'Surety Bond - Performance', 'Travelers', 'SB-2026-44102', 'TX', 'active', '2026-01-15', '2027-01-15', 15000, 'Franchesca Cox', '$5M bonding capacity', '2026-03-01');
    // Permits
    insertCompliance.run('CL-012', TENANT_ID, 'permit', 'City of Houston Concrete Contractor Permit', 'City of Houston', 'HOU-CC-2025-3891', 'TX', 'active', '2025-10-01', '2026-10-01', 350, 'Javier Fernandez', 'Annual city permit', '2026-03-15');

    const insertIncident = targetDb.prepare(`INSERT OR IGNORE INTO dacp_compliance_incidents (id, tenant_id, type, severity, description, job_id, reported_by, reported_date, resolution, resolved_date, cost, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insertIncident.run('CI-001', TENANT_ID, 'safety_incident', 'medium', 'Worker twisted ankle stepping off formwork - missed 2 days', 'JOB-015', 'Mike Rodriguez', '2026-03-18', 'Worker returned to light duty, safety briefing conducted', '2026-03-22', 1200, 'resolved');
    insertIncident.run('CI-002', TENANT_ID, 'osha_violation', 'high', 'Missing fall protection on elevated deck pour - warning issued', 'JOB-022', 'OSHA Inspector', '2026-03-25', null, null, null, 'open');

    console.log('DACP: Seeded 12 compliance items, 2 incidents');
  }

  // ─── Seed pre-qualification packages (GC watchlist) ─────────────────────
  const prequalCount = targetDb.prepare('SELECT COUNT(*) as c FROM dacp_prequal_packages WHERE tenant_id = ?').get(TENANT_SEED_ID);
  if (prequalCount.c === 0) {
    const TENANT_ID = TENANT_SEED_ID;
    const insertPrequal = targetDb.prepare(`INSERT OR IGNORE INTO dacp_prequal_packages (id, tenant_id, gc_name, status) VALUES (?, ?, ?, 'not_sent')`);
    const gcWatchlist = [
      'Turner Construction', 'Renegade', 'JE Dunn', 'Hensel Phelps',
      'McCarthy Building Companies', 'Skanska', 'Balfour Beatty', 'Rogers-O\'Brien',
      'Manhattan Construction', 'Austin Commercial', 'Whiting-Turner', 'Brasfield & Gorrie',
      'Granite Construction', 'DPR Construction', 'Primoris', 'Zachry Group',
    ];
    for (let i = 0; i < gcWatchlist.length; i++) {
      insertPrequal.run(`PQ-${String(i + 1).padStart(3, '0')}`, TENANT_ID, gcWatchlist[i]);
    }
    console.log(`DACP: Seeded ${gcWatchlist.length} pre-qualification packages`);
  }

  // ─── Seed GC offices (Sales Trip Planner) ─────────────────────────────
  const gcOfficeCount = targetDb.prepare('SELECT COUNT(*) as c FROM dacp_gc_offices WHERE tenant_id = ?').get(TENANT_SEED_ID);
  if (gcOfficeCount.c === 0) {
    const TENANT_ID = TENANT_SEED_ID;
    const insertOffice = targetDb.prepare(`INSERT OR IGNORE INTO dacp_gc_offices (id, tenant_id, gc_name, address, city, state, zip, office_type, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 'main', ?)`);
    const gcOffices = [
      ['GCO-SEED-001', 'Turner Construction', '2711 N Haskell Ave', 'Dallas', 'TX', '75204', null],
      ['GCO-SEED-002', 'JE Dunn Construction', '1341 W Mockingbird Ln', 'Dallas', 'TX', '75247', null],
      ['GCO-SEED-003', 'Hensel Phelps', '1340 Empire Central Dr', 'Dallas', 'TX', '75247', null],
      ['GCO-SEED-004', 'McCarthy Building Companies', '12001 N Central Expy', 'Dallas', 'TX', '75243', null],
      ['GCO-SEED-005', 'Skanska USA', '1601 Elm St', 'Dallas', 'TX', '75201', null],
      ['GCO-SEED-006', 'Balfour Beatty', '3100 McKinnon St', 'Dallas', 'TX', '75201', null],
      ['GCO-SEED-007', 'Rogers-O\'Brien Construction', '3131 McKinney Ave', 'Dallas', 'TX', '75204', null],
      ['GCO-SEED-008', 'Manhattan Construction', '2120 N Central Expy', 'Dallas', 'TX', '75080', null],
      ['GCO-SEED-009', 'Austin Commercial', '6001 Bollinger Canyon Rd', 'Dallas', 'TX', '75240', null],
      ['GCO-SEED-010', 'Whiting-Turner', '2000 McKinney Ave', 'Dallas', 'TX', '75201', null],
      ['GCO-SEED-011', 'Brasfield & Gorrie', '3500 Maple Ave', 'Dallas', 'TX', '75219', null],
      ['GCO-SEED-012', 'Granite Construction', '585 W Beach St', 'Watsonville', 'CA', '95076', 'No DFW office'],
      ['GCO-SEED-013', 'DPR Construction', '1919 McKinney Ave', 'Dallas', 'TX', '75201', null],
      ['GCO-SEED-014', 'Primoris Services', '2100 McKinney Ave', 'Dallas', 'TX', '75201', null],
      ['GCO-SEED-015', 'Zachry Group', '527 Logwood Ave', 'San Antonio', 'TX', '78221', 'San Antonio-based - no DFW office'],
      ['GCO-SEED-016', 'Renegade Construction', null, 'Dallas', 'TX', null, 'Address TBD'],
    ];
    for (const [id, gcName, address, city, state, zip, notes] of gcOffices) {
      insertOffice.run(id, TENANT_ID, gcName, address, city, state, zip, notes);
    }
    console.log(`DACP: Seeded ${gcOffices.length} GC offices for Sales Trip Planner`);
  }

  // ─── Lead Engine Seed Data ──────────────────────────────────────────────
  const leCount = targetDb.prepare('SELECT COUNT(*) as c FROM le_leads WHERE tenant_id = ?').get(SANGHA_TENANT_ID);
  if (leCount.c === 0) {
    const insertLead = targetDb.prepare(`INSERT OR IGNORE INTO le_leads (id, tenant_id, venue_name, region, industry, trigger_news, priority_score, website, status, source, source_query, discovered_at, contacted_at, responded_at, notes, agent_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertContact = targetDb.prepare(`INSERT OR IGNORE INTO le_contacts (id, tenant_id, lead_id, name, email, title, phone, source, mx_valid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertOutreach = targetDb.prepare(`INSERT OR IGNORE INTO le_outreach_log (id, tenant_id, lead_id, contact_id, email_type, subject, body, status, sent_at, responded_at, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    // Sangha leads
    const S = SANGHA_TENANT_ID;
    insertLead.run('le-s-001', S, 'Meridian Renewables', 'ERCOT', 'Solar IPP', 'Crane County portfolio facing negative LMPs', 92, 'meridianrenewables.com', 'responded', 'discovery', 'solar IPP Texas ERCOT', '2026-02-20', '2026-03-02', '2026-03-07', null, 'Strong interest - exploring BTM mining for Crane County');
    insertLead.run('le-s-002', S, 'GridScale Partners', 'PJM', 'Wind IPP', 'Reviewing underperforming PJM wind assets', 85, 'gridscalepartners.com', 'responded', 'discovery', 'wind IPP PJM underperforming', '2026-02-22', '2026-03-03', '2026-03-05', null, 'Wants partnership structure details');
    insertLead.run('le-s-003', S, 'Nexus Solar', 'MISO', 'Solar IPP', '95 MW portfolio in MISO', 60, 'nexussolar.com', 'contacted', 'discovery', 'solar developer MISO', '2026-02-25', '2026-03-04', null, null, 'Not right time - revisit Q3');
    insertLead.run('le-s-004', S, 'SunPeak Energy', 'ERCOT', 'Solar IPP', '240 MW West Texas solar portfolio', 88, 'sunpeakenergy.com', 'meeting', 'discovery', 'solar IPP ERCOT West Texas', '2026-02-18', '2026-02-28', '2026-03-02', null, 'Call scheduled - two sites may fit');
    insertLead.run('le-s-005', S, 'Apex Clean Energy Partners', 'SPP', 'Wind/Solar', '400 MW mixed portfolio struggling with negative LMPs in Oklahoma', 90, 'apexcleanenergy.com', 'responded', 'discovery', 'renewable IPP SPP negative LMP', '2026-02-15', '2026-02-26', '2026-03-01', null, 'Looping in energy team - strong signal');
    insertLead.run('le-s-006', S, 'Clearway Energy', 'ERCOT', 'Wind IPP', '520 MW wind portfolio in ERCOT', 75, 'clearwayenergy.com', 'contacted', 'discovery', 'wind energy ERCOT large portfolio', '2026-03-01', '2026-03-04', null, null, null);
    insertLead.run('le-s-007', S, 'EDP Renewables', 'MISO', 'Solar IPP', '350 MW solar development in MISO', 70, 'edprenewables.com', 'new', 'discovery', 'solar developer MISO 2026', '2026-03-07', null, null, null, null);
    insertLead.run('le-s-008', S, 'NextEra Partners', 'ERCOT', 'Wind/Solar', '1.2 GW mixed portfolio', 95, 'nextera.com', 'new', 'discovery', 'large IPP ERCOT portfolio', '2026-03-07', null, null, null, null);

    // Sangha contacts
    insertContact.run('lc-s-001', S, 'le-s-001', 'Sarah Chen', 'schen@meridianrenewables.com', 'CFO', null, 'discovery', 1);
    insertContact.run('lc-s-002', S, 'le-s-002', 'Mark Liu', 'mliu@gridscalepartners.com', 'VP Strategy', null, 'discovery', 1);
    insertContact.run('lc-s-003', S, 'le-s-003', 'David Park', 'dpark@nexussolar.com', 'Director BD', null, 'discovery', 1);
    insertContact.run('lc-s-004', S, 'le-s-004', 'James Torres', 'jtorres@sunpeakenergy.com', 'VP Operations', null, 'discovery', 1);
    insertContact.run('lc-s-005', S, 'le-s-005', 'Linda Pham', 'lpham@apexcleanenergy.com', 'CEO', null, 'discovery', 1);
    insertContact.run('lc-s-006', S, 'le-s-006', 'Ryan Brooks', 'rbrooks@clearwayenergy.com', 'BD Manager', null, 'discovery', 1);
    insertContact.run('lc-s-007', S, 'le-s-007', 'Carlos Ruiz', 'cruiz@edprenewables.com', 'Head of BD', null, 'discovery', 1);
    insertContact.run('lc-s-008', S, 'le-s-008', 'Amanda Foster', 'afoster@nextera.com', 'VP Partnerships', null, 'discovery', 1);

    // Sangha outreach
    insertOutreach.run('lo-s-001', S, 'le-s-001', 'lc-s-001', 'initial', 'Behind-the-meter mining for Crane County', 'Hi Sarah,\n\nI came across Meridian\'s Crane County solar portfolio and noticed your assets have been facing some of the same negative LMP challenges that many ERCOT operators are dealing with right now.\n\nWe\'ve been working with renewable operators to co-locate behind-the-meter Bitcoin mining on underperforming sites - effectively creating an additional revenue stream from the same infrastructure.\n\nWould be happy to share how this has worked on similar assets.\n\nBest,\nSangha Renewables', 'sent', '2026-03-02T09:14:00', '2026-03-07T11:42:00', 'auto', '2026-03-02');
    insertOutreach.run('lo-s-002', S, 'le-s-002', 'lc-s-002', 'initial', 'Hashrate co-location for underperforming wind assets', 'Hi Mark,\n\nGridScale\'s PJM wind portfolio caught our attention - we work with operators who are turning curtailed or low-price hours into reliable mining revenue.\n\nWould love to share our approach if relevant.\n\nBest,\nSangha Renewables', 'sent', '2026-03-03T10:22:00', '2026-03-05T14:18:00', 'auto', '2026-03-03');
    insertOutreach.run('lo-s-003', S, 'le-s-004', 'lc-s-004', 'initial', 'Mining + solar in West Texas', 'Hi James,\n\nSunPeak\'s West Texas solar sites are exactly the kind of assets where behind-the-meter mining adds the most value.\n\nWe have 8 years of operational data to back it up. Happy to walk through the numbers.\n\nBest,\nSangha Renewables', 'sent', '2026-02-28T08:45:00', '2026-03-02T16:30:00', 'auto', '2026-02-28');
    insertOutreach.run('lo-s-004', S, 'le-s-001', 'lc-s-001', 'followup_1', 'Re: Behind-the-meter mining for Crane County', 'Hi Sarah,\n\nGreat to hear there\'s alignment. I\'ll put together a brief overview of our typical project structure for a site in your capacity range.\n\nWould Thursday or Friday afternoon work for a quick call?\n\nBest,\nSangha Renewables', 'draft', null, null, null, '2026-03-07');

    // Sangha discovery config
    targetDb.prepare(`INSERT OR IGNORE INTO le_discovery_config (id, tenant_id, queries_json, regions_json, current_position, queries_per_cycle, max_emails_per_cycle, followup_delay_days, max_followups, min_send_interval_seconds, enabled, mode, sender_name, sender_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'ldc-default', S,
      JSON.stringify(['solar IPP ERCOT negative LMP', 'wind energy developer PJM underperforming', 'renewable IPP curtailment MISO', 'solar farm operator SPP Oklahoma', 'wind portfolio ERCOT West Texas', 'IPP behind-the-meter colocation', 'renewable energy merchant risk', 'solar developer CAISO California', 'wind IPP Texas market', 'renewable energy asset optimization', 'curtailed wind farm operator', 'solar IPP revenue floor', 'wind energy hedge strategy', 'renewable portfolio optimization 2026', 'IPP alternative revenue stream']),
      JSON.stringify(['ERCOT', 'PJM', 'MISO', 'SPP', 'CAISO']),
      4, 2, 10, 5, 2, 300, 1, 'copilot', 'Sangha Renewables', 'outreach@sangha.io'
    );

    console.log('Lead Engine: Seeded 8 Sangha leads + contacts + outreach');
  }

  // DACP lead engine seed
  const leDacpCount = targetDb.prepare('SELECT COUNT(*) as c FROM le_leads WHERE tenant_id = ?').get('dacp-construction-001');
  if (leDacpCount.c === 0) {
    const insertLead = targetDb.prepare(`INSERT OR IGNORE INTO le_leads (id, tenant_id, venue_name, region, industry, trigger_news, priority_score, website, status, source, source_query, discovered_at, contacted_at, responded_at, notes, agent_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertContact = targetDb.prepare(`INSERT OR IGNORE INTO le_contacts (id, tenant_id, lead_id, name, email, title, phone, source, mx_valid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const D = 'dacp-construction-001';
    insertLead.run('le-d-001', D, 'Turner Construction - Houston', 'Texas', 'General Contractor', 'Multiple active projects in Houston metro', 90, 'turnerconstruction.com', 'contacted', 'discovery', 'GC Houston concrete subcontractor needed', '2026-02-10', '2026-02-20', null, null, null);
    insertLead.run('le-d-002', D, 'DPR Construction', 'Texas', 'General Contractor', 'Expanding Texas healthcare portfolio', 85, 'dpr.com', 'responded', 'discovery', 'GC Texas healthcare construction', '2026-02-12', '2026-02-22', '2026-03-01', null, 'Interested in concrete sub for medical center');
    insertLead.run('le-d-003', D, 'Austin Commercial', 'Texas', 'General Contractor', 'New mixed-use project in Austin', 80, 'austin-ind.com', 'contacted', 'discovery', 'GC Austin mixed use development', '2026-02-15', '2026-02-25', null, null, null);
    insertLead.run('le-d-004', D, 'McCarthy Building', 'Texas', 'General Contractor', 'University campus expansion in San Antonio', 75, 'mccarthy.com', 'new', 'discovery', 'GC San Antonio university construction', '2026-03-01', null, null, null, null);
    insertLead.run('le-d-005', D, 'Hensel Phelps', 'Texas', 'General Contractor', 'Federal project in Houston', 82, 'henselphelps.com', 'new', 'discovery', 'GC Houston federal construction concrete', '2026-03-03', null, null, null, null);
    insertLead.run('le-d-006', D, 'Skanska USA', 'Texas', 'General Contractor', 'Infrastructure project TxDOT', 78, 'usa.skanska.com', 'new', 'discovery', 'GC Texas infrastructure TxDOT', '2026-03-05', null, null, null, null);

    insertContact.run('lc-d-001', D, 'le-d-001', 'Mike Johnson', 'mjohnson@turnerconstruction.com', 'Project Executive', '713-555-0101', 'discovery', 1);
    insertContact.run('lc-d-002', D, 'le-d-002', 'Karen Williams', 'kwilliams@dpr.com', 'Sr. Project Manager', '512-555-0202', 'discovery', 1);
    insertContact.run('lc-d-003', D, 'le-d-003', 'Tom Richardson', 'trichardson@austin-ind.com', 'Preconstruction Manager', '512-555-0303', 'discovery', 1);
    insertContact.run('lc-d-004', D, 'le-d-004', 'Steve Martinez', 'smartinez@mccarthy.com', 'VP Preconstruction', '210-555-0404', 'discovery', 1);
    insertContact.run('lc-d-005', D, 'le-d-005', 'Rachel Lee', 'rlee@henselphelps.com', 'Project Engineer', '713-555-0505', 'discovery', 1);
    insertContact.run('lc-d-006', D, 'le-d-006', 'Dan Thompson', 'dthompson@usa.skanska.com', 'Estimating Manager', '713-555-0606', 'discovery', 1);

    targetDb.prepare(`INSERT OR IGNORE INTO le_discovery_config (id, tenant_id, queries_json, regions_json, current_position, queries_per_cycle, max_emails_per_cycle, followup_delay_days, max_followups, min_send_interval_seconds, enabled, mode, sender_name, sender_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'ldc-dacp', D,
      JSON.stringify(['GC Houston concrete subcontractor RFQ', 'general contractor Texas concrete foundation', 'Houston healthcare construction concrete', 'Austin commercial construction concrete sub', 'San Antonio university campus concrete', 'DFW industrial construction concrete', 'Houston infrastructure concrete paving', 'Texas GC seeking concrete subcontractor', 'Houston medical center construction', 'Texas mixed use development concrete', 'GC pre-qualification concrete Houston', 'TxDOT concrete subcontractor Texas', 'commercial concrete pour Houston 2026', 'multifamily construction concrete Texas', 'Houston warehouse concrete slab contractor']),
      JSON.stringify(['Houston', 'Austin', 'San Antonio', 'Dallas-Fort Worth']),
      2, 2, 8, 5, 2, 300, 0, 'copilot', 'DACP Construction', 'estimating@dacpconstruction.com'
    );

    console.log('Lead Engine: Seeded 6 DACP leads + contacts');
  }

  console.log('DACP seed data initialized');
}

// ─── DACP CRUD Helpers ──────────────────────────────────────────────────────

export function getDacpPricing(tenantId, category) {
  if (category) {
    return db.prepare('SELECT * FROM dacp_pricing WHERE tenant_id = ? AND category = ? ORDER BY category, id').all(tenantId, category);
  }
  return db.prepare('SELECT * FROM dacp_pricing WHERE tenant_id = ? ORDER BY category, id').all(tenantId);
}

export function createDacpPricing(tenantId, data) {
  return db.prepare(
    `INSERT INTO dacp_pricing (id, tenant_id, category, item, unit, material_cost, labor_cost, equipment_cost, unit_price, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(data.id, tenantId, data.category, data.item, data.unit, data.material_cost ?? 0, data.labor_cost ?? 0, data.equipment_cost ?? 0, data.unit_price ?? 0, data.notes ?? '');
}

export function updateDacpPricing(tenantId, id, updates) {
  const allowed = ['category', 'item', 'unit', 'material_cost', 'labor_cost', 'equipment_cost', 'unit_price', 'notes'];
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.includes(k)) {
      fields.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (fields.length === 0) return;
  values.push(tenantId, id);
  return db.prepare(`UPDATE dacp_pricing SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...values);
}

export function deleteDacpPricing(tenantId, id) {
  return db.prepare('DELETE FROM dacp_pricing WHERE tenant_id = ? AND id = ?').run(tenantId, id);
}

export function getDacpBidRequests(tenantId, status) {
  if (status) {
    return db.prepare('SELECT * FROM dacp_bid_requests WHERE tenant_id = ? AND status = ? ORDER BY due_date ASC').all(tenantId, status);
  }
  return db.prepare('SELECT * FROM dacp_bid_requests WHERE tenant_id = ? ORDER BY due_date ASC').all(tenantId);
}

export function getDacpBidRequest(tenantId, id) {
  const row = db.prepare('SELECT * FROM dacp_bid_requests WHERE tenant_id = ? AND id = ?').get(tenantId, id);
  if (row) {
    row.attachments = row.attachments_json ? JSON.parse(row.attachments_json) : [];
    row.scope = row.scope_json ? JSON.parse(row.scope_json) : {};
    row.missing_info = row.missing_info_json ? JSON.parse(row.missing_info_json) : [];
  }
  return row;
}

export function createDacpBidRequest(bid) {
  return db.prepare(
    `INSERT INTO dacp_bid_requests (id, tenant_id, from_email, from_name, gc_name, subject, body, attachments_json, scope_json, due_date, status, urgency, missing_info_json, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(bid.id, bid.tenant_id, bid.from_email, bid.from_name, bid.gc_name, bid.subject, bid.body, bid.attachments_json || '[]', bid.scope_json || '{}', bid.due_date, bid.status || 'new', bid.urgency || 'medium', bid.missing_info_json || '[]', bid.received_at || new Date().toISOString());
}

export function updateDacpBidRequest(tenantId, id, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;
  values.push(tenantId, id);
  return db.prepare(`UPDATE dacp_bid_requests SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...values);
}

export function getDacpEstimates(tenantId) {
  return db.prepare('SELECT * FROM dacp_estimates WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function getDacpEstimate(tenantId, id) {
  const row = db.prepare('SELECT * FROM dacp_estimates WHERE tenant_id = ? AND id = ?').get(tenantId, id);
  if (row && row.line_items_json) row.line_items = JSON.parse(row.line_items_json);
  return row;
}

export function createDacpEstimate(estimate) {
  return db.prepare(`
    INSERT INTO dacp_estimates (id, tenant_id, bid_request_id, project_name, gc_name, status, line_items_json, subtotal, overhead_pct, profit_pct, mobilization, total_bid, confidence, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    estimate.id, estimate.tenantId, estimate.bidRequestId, estimate.projectName, estimate.gcName,
    estimate.status || 'draft', JSON.stringify(estimate.lineItems), estimate.subtotal,
    estimate.overheadPct, estimate.profitPct, estimate.mobilization, estimate.totalBid,
    estimate.confidence, estimate.notes
  );
}

export function updateDacpEstimate(tenantId, id, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    if (k === 'lineItems') {
      fields.push('line_items_json = ?');
      values.push(JSON.stringify(v));
    } else {
      fields.push(`${k} = ?`);
      values.push(v);
    }
  }
  if (fields.length === 0) return;
  values.push(tenantId, id);
  return db.prepare(`UPDATE dacp_estimates SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...values);
}

export function getDacpJobs(tenantId, status) {
  if (status) {
    return db.prepare('SELECT * FROM dacp_jobs WHERE tenant_id = ? AND status = ? ORDER BY start_date DESC').all(tenantId, status);
  }
  return db.prepare('SELECT * FROM dacp_jobs WHERE tenant_id = ? ORDER BY start_date DESC NULLS LAST').all(tenantId);
}

export function getDacpJob(tenantId, id) {
  return db.prepare('SELECT * FROM dacp_jobs WHERE tenant_id = ? AND id = ?').get(tenantId, id);
}

export function createDacpJob(job) {
  return db.prepare(`
    INSERT INTO dacp_jobs (id, tenant_id, estimate_id, project_name, gc_name, project_type, location, status, estimated_cost, actual_cost, bid_amount, margin_pct, start_date, end_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    job.id, job.tenant_id, job.estimate_id || null, job.project_name, job.gc_name,
    job.project_type || 'concrete', job.location || null, job.status || 'pending',
    job.estimated_cost || null, job.actual_cost || null, job.bid_amount || null,
    job.margin_pct || null, job.start_date || null, job.end_date || null,
    job.notes || null
  );
}

export function updateDacpJob(tenantId, id, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;
  values.push(tenantId, id);
  return db.prepare(`UPDATE dacp_jobs SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...values);
}

export function getDacpFieldReports(tenantId, jobId) {
  if (jobId) {
    return db.prepare('SELECT * FROM dacp_field_reports WHERE tenant_id = ? AND job_id = ? ORDER BY date DESC').all(tenantId, jobId);
  }
  return db.prepare('SELECT * FROM dacp_field_reports WHERE tenant_id = ? ORDER BY date DESC').all(tenantId);
}

export function getDacpFieldReport(tenantId, id) {
  const row = db.prepare('SELECT * FROM dacp_field_reports WHERE tenant_id = ? AND id = ?').get(tenantId, id);
  if (row) {
    row.work = row.work_json ? JSON.parse(row.work_json) : [];
    row.materials = row.materials_json ? JSON.parse(row.materials_json) : [];
    row.labor = row.labor_json ? JSON.parse(row.labor_json) : {};
    row.equipment = row.equipment_json ? JSON.parse(row.equipment_json) : [];
    row.issues = row.issues_json ? JSON.parse(row.issues_json) : [];
  }
  return row;
}

export function createDacpFieldReport(report) {
  return db.prepare(`
    INSERT INTO dacp_field_reports (id, tenant_id, job_id, date, reported_by, work_json, materials_json, labor_json, equipment_json, weather, notes, issues_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    report.id, report.tenantId, report.jobId, report.date, report.reportedBy,
    JSON.stringify(report.work), JSON.stringify(report.materials),
    JSON.stringify(report.labor), JSON.stringify(report.equipment),
    report.weather, report.notes, JSON.stringify(report.issues)
  );
}

export function getDacpStats(tenantId) {
  const bidRequests = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'new\' THEN 1 ELSE 0 END) as open FROM dacp_bid_requests WHERE tenant_id = ?').get(tenantId);
  const estimates = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'draft\' THEN 1 ELSE 0 END) as drafts, SUM(CASE WHEN status = \'sent\' THEN 1 ELSE 0 END) as sent FROM dacp_estimates WHERE tenant_id = ?').get(tenantId);
  const jobs = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'complete\' THEN 1 ELSE 0 END) as complete, SUM(CASE WHEN status = \'active\' THEN 1 ELSE 0 END) as active FROM dacp_jobs WHERE tenant_id = ?').get(tenantId);
  const wonJobs = db.prepare('SELECT COUNT(*) as won, AVG(margin_pct) as avg_margin, SUM(bid_amount) as total_revenue FROM dacp_jobs WHERE tenant_id = ? AND status = \'complete\' AND margin_pct IS NOT NULL').get(tenantId);
  const lostJobs = db.prepare('SELECT COUNT(*) as lost FROM dacp_jobs WHERE tenant_id = ? AND status = \'lost\'').get(tenantId);
  const fieldReports = db.prepare('SELECT COUNT(*) as total FROM dacp_field_reports WHERE tenant_id = ?').get(tenantId);

  const winRate = (wonJobs.won + lostJobs.lost) > 0 ? Math.round((wonJobs.won / (wonJobs.won + lostJobs.lost)) * 100) : 0;

  return {
    openRfqs: bidRequests.open || 0,
    totalBidRequests: bidRequests.total || 0,
    totalEstimates: estimates.total || 0,
    draftEstimates: estimates.drafts || 0,
    sentEstimates: estimates.sent || 0,
    totalJobs: jobs.total || 0,
    activeJobs: jobs.active || 0,
    completeJobs: jobs.complete || 0,
    wonJobs: wonJobs.won || 0,
    lostJobs: lostJobs.lost || 0,
    winRate,
    avgMargin: wonJobs.avg_margin ? Math.round(wonJobs.avg_margin * 10) / 10 : 0,
    totalRevenue: wonJobs.total_revenue || 0,
    totalFieldReports: fieldReports.total || 0,
  };
}

// ─── Bid Documents CRUD ─────────────────────────────────────────────────────

export function getDacpBidDocuments(tenantId, bidRequestId) {
  return db.prepare('SELECT * FROM dacp_bid_documents WHERE tenant_id = ? AND bid_request_id = ? ORDER BY created_at ASC').all(tenantId, bidRequestId);
}

export function getDacpBidDocument(tenantId, id) {
  return db.prepare('SELECT * FROM dacp_bid_documents WHERE tenant_id = ? AND id = ?').get(tenantId, id);
}

export function createDacpBidDocument(doc) {
  return db.prepare(
    `INSERT INTO dacp_bid_documents (id, tenant_id, bid_request_id, filename, file_type, file_path, drive_file_id, drive_url, parsed_text, page_count, csi_divisions_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    doc.id, doc.tenantId, doc.bidRequestId, doc.filename, doc.fileType,
    doc.filePath || null, doc.driveFileId || null, doc.driveUrl || null,
    doc.parsedText || null, doc.pageCount || null,
    doc.csiDivisionsJson || null, doc.createdAt || new Date().toISOString()
  );
}

export function updateDacpBidDocument(tenantId, id, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;
  values.push(tenantId, id);
  return db.prepare(`UPDATE dacp_bid_documents SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...values);
}

export function deleteDacpBidDocument(tenantId, id) {
  return db.prepare('DELETE FROM dacp_bid_documents WHERE tenant_id = ? AND id = ?').run(tenantId, id);
}

// ─── Plan Analyses CRUD ─────────────────────────────────────────────────────

export function getDacpPlanAnalyses(tenantId, bidRequestId) {
  return db.prepare('SELECT * FROM dacp_plan_analyses WHERE tenant_id = ? AND bid_request_id = ? ORDER BY created_at ASC').all(tenantId, bidRequestId);
}

export function getDacpPlanAnalysis(tenantId, id) {
  return db.prepare('SELECT * FROM dacp_plan_analyses WHERE tenant_id = ? AND id = ?').get(tenantId, id);
}

export function createDacpPlanAnalysis(analysis) {
  return db.prepare(
    `INSERT INTO dacp_plan_analyses (id, tenant_id, bid_request_id, filename, file_type, file_path, analysis_json, quantities_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    analysis.id, analysis.tenantId, analysis.bidRequestId, analysis.filename,
    analysis.fileType, analysis.filePath || null,
    analysis.analysisJson || null, analysis.quantitiesJson || null,
    analysis.createdAt || new Date().toISOString()
  );
}

export function updateDacpPlanAnalysis(tenantId, id, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;
  values.push(tenantId, id);
  return db.prepare(`UPDATE dacp_plan_analyses SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...values);
}

export function deleteDacpPlanAnalysis(tenantId, id) {
  return db.prepare('DELETE FROM dacp_plan_analyses WHERE tenant_id = ? AND id = ?').run(tenantId, id);
}

// ─── CEO Dashboard Queries ──────────────────────────────────────────────────

export function getCeoDashboardStats(tenantId) {
  const estimating = {
    totalBids: db.prepare('SELECT COUNT(*) as c FROM dacp_bid_requests WHERE tenant_id = ?').get(tenantId)?.c || 0,
    activeBids: db.prepare("SELECT COUNT(*) as c FROM dacp_bid_requests WHERE tenant_id = ? AND status IN ('new', 'reviewing', 'estimated')").get(tenantId)?.c || 0,
    totalPipelineValue: db.prepare('SELECT COALESCE(SUM(total_bid), 0) as v FROM dacp_estimates WHERE tenant_id = ?').get(tenantId)?.v || 0,
    activeJobs: db.prepare("SELECT COUNT(*) as c FROM dacp_jobs WHERE tenant_id = ? AND status = 'active'").get(tenantId)?.c || 0,
    completedJobs: db.prepare("SELECT COUNT(*) as c FROM dacp_jobs WHERE tenant_id = ? AND status = 'completed'").get(tenantId)?.c || 0,
    totalJobValue: db.prepare("SELECT COALESCE(SUM(bid_amount), 0) as v FROM dacp_jobs WHERE tenant_id = ? AND status IN ('active', 'completed')").get(tenantId)?.v || 0,
    avgMargin: db.prepare("SELECT COALESCE(AVG(margin_pct), 0) as v FROM dacp_jobs WHERE tenant_id = ? AND margin_pct IS NOT NULL").get(tenantId)?.v || 0,
    pendingBids: db.prepare("SELECT COUNT(*) as c FROM dacp_bid_requests WHERE tenant_id = ? AND status = 'new'").get(tenantId)?.c || 0,
    overdueItems: db.prepare("SELECT COUNT(*) as c FROM dacp_bid_requests WHERE tenant_id = ? AND due_date < date('now') AND status NOT IN ('passed', 'estimated', 'awarded')").get(tenantId)?.c || 0,
    // New KPIs from estimating services
    openRfis: db.prepare("SELECT COUNT(*) as c FROM dacp_rfis WHERE tenant_id = ? AND status IN ('draft', 'sent')").get(tenantId)?.c || 0,
    pendingDistributions: db.prepare("SELECT COUNT(*) as c FROM dacp_bid_distributions WHERE tenant_id = ? AND bid_status = 'draft'").get(tenantId)?.c || 0,
    sentDistributions: db.prepare("SELECT COUNT(*) as c FROM dacp_bid_distributions WHERE tenant_id = ? AND bid_status = 'sent'").get(tenantId)?.c || 0,
    wonBids: db.prepare("SELECT COUNT(*) as c FROM dacp_bid_distributions WHERE tenant_id = ? AND award_status = 'won'").get(tenantId)?.c || 0,
    aboveMarketBondRate: db.prepare("SELECT COUNT(*) as c FROM dacp_bond_program WHERE tenant_id = ? AND rate_flag = 'above_market'").get(tenantId)?.c || 0,
    suppliersOnFile: db.prepare("SELECT COUNT(*) as c FROM dacp_suppliers WHERE tenant_id = ? AND status = 'active'").get(tenantId)?.c || 0,
  };

  const pumping = {
    totalEquipment: db.prepare('SELECT COUNT(*) as c FROM dacp_pumping_equipment WHERE tenant_id = ?').get(tenantId)?.c || 0,
    availableEquipment: db.prepare("SELECT COUNT(*) as c FROM dacp_pumping_equipment WHERE tenant_id = ? AND status = 'available'").get(tenantId)?.c || 0,
    maintenanceEquipment: db.prepare("SELECT COUNT(*) as c FROM dacp_pumping_equipment WHERE tenant_id = ? AND status = 'maintenance'").get(tenantId)?.c || 0,
    scheduledJobs: db.prepare("SELECT COUNT(*) as c FROM dacp_pumping_jobs WHERE tenant_id = ? AND status IN ('scheduled', 'confirmed')").get(tenantId)?.c || 0,
    completedJobs30d: db.prepare("SELECT COUNT(*) as c FROM dacp_pumping_jobs WHERE tenant_id = ? AND status = 'completed' AND job_date >= date('now', '-30 days')").get(tenantId)?.c || 0,
    revenue30d: db.prepare("SELECT COALESCE(SUM(invoice_amount), 0) as v FROM dacp_pumping_jobs WHERE tenant_id = ? AND status = 'completed' AND job_date >= date('now', '-30 days')").get(tenantId)?.v || 0,
    overdueInvoices: db.prepare("SELECT COUNT(*) as c FROM dacp_pumping_jobs WHERE tenant_id = ? AND invoice_status = 'overdue'").get(tenantId)?.c || 0,
    overdueAmount: db.prepare("SELECT COALESCE(SUM(invoice_amount), 0) as v FROM dacp_pumping_jobs WHERE tenant_id = ? AND invoice_status = 'overdue'").get(tenantId)?.v || 0,
    pendingInvoices: db.prepare("SELECT COUNT(*) as c FROM dacp_pumping_jobs WHERE tenant_id = ? AND status = 'completed' AND invoice_status = 'pending'").get(tenantId)?.c || 0,
    utilizationRate: (() => {
      const total = db.prepare('SELECT COUNT(*) as c FROM dacp_pumping_equipment WHERE tenant_id = ?').get(tenantId)?.c || 1;
      const inUse = db.prepare("SELECT COUNT(*) as c FROM dacp_pumping_equipment WHERE tenant_id = ? AND status = 'in_use'").get(tenantId)?.c || 0;
      return Math.round((inUse / total) * 100);
    })(),
  };

  const marketing = {
    totalLeads: db.prepare('SELECT COUNT(*) as c FROM dacp_marketing_leads WHERE tenant_id = ?').get(tenantId)?.c || 0,
    newLeads: db.prepare("SELECT COUNT(*) as c FROM dacp_marketing_leads WHERE tenant_id = ? AND status = 'new'").get(tenantId)?.c || 0,
    qualifiedLeads: db.prepare("SELECT COUNT(*) as c FROM dacp_marketing_leads WHERE tenant_id = ? AND status = 'qualified'").get(tenantId)?.c || 0,
    proposalsSent: db.prepare("SELECT COUNT(*) as c FROM dacp_marketing_leads WHERE tenant_id = ? AND status = 'proposal_sent'").get(tenantId)?.c || 0,
    totalPipelineValue: db.prepare("SELECT COALESCE(SUM(project_value), 0) as v FROM dacp_marketing_leads WHERE tenant_id = ? AND status IN ('qualified', 'proposal_sent', 'contacted', 'responded')").get(tenantId)?.v || 0,
    staleLeads: db.prepare("SELECT COUNT(*) as c FROM dacp_marketing_leads WHERE tenant_id = ? AND status = 'stale'").get(tenantId)?.c || 0,
    activeCampaigns: db.prepare("SELECT COUNT(*) as c FROM dacp_marketing_campaigns WHERE tenant_id = ? AND status = 'active'").get(tenantId)?.c || 0,
    responseRate: (() => {
      const total = db.prepare("SELECT COUNT(*) as c FROM dacp_marketing_leads WHERE tenant_id = ? AND outreach_count > 0").get(tenantId)?.c || 1;
      const responded = db.prepare("SELECT COUNT(*) as c FROM dacp_marketing_leads WHERE tenant_id = ? AND status IN ('responded', 'qualified', 'proposal_sent', 'won')").get(tenantId)?.c || 0;
      return Math.round((responded / total) * 100);
    })(),
  };

  const compliance = {
    totalItems: db.prepare('SELECT COUNT(*) as c FROM dacp_compliance_items WHERE tenant_id = ?').get(tenantId)?.c || 0,
    activeItems: db.prepare("SELECT COUNT(*) as c FROM dacp_compliance_items WHERE tenant_id = ? AND status = 'active'").get(tenantId)?.c || 0,
    expiringSoon: db.prepare("SELECT COUNT(*) as c FROM dacp_compliance_items WHERE tenant_id = ? AND status = 'expiring_soon'").get(tenantId)?.c || 0,
    expired: db.prepare("SELECT COUNT(*) as c FROM dacp_compliance_items WHERE tenant_id = ? AND status = 'expired'").get(tenantId)?.c || 0,
    openIncidents: db.prepare("SELECT COUNT(*) as c FROM dacp_compliance_incidents WHERE tenant_id = ? AND status IN ('open', 'investigating')").get(tenantId)?.c || 0,
    highSeverityOpen: db.prepare("SELECT COUNT(*) as c FROM dacp_compliance_incidents WHERE tenant_id = ? AND severity IN ('high', 'critical') AND status IN ('open', 'investigating')").get(tenantId)?.c || 0,
    upcomingRenewals: db.prepare("SELECT * FROM dacp_compliance_items WHERE tenant_id = ? AND expiry_date <= date('now', '+60 days') AND status != 'expired' ORDER BY expiry_date ASC").all(tenantId),
    expiredItems: db.prepare("SELECT * FROM dacp_compliance_items WHERE tenant_id = ? AND status = 'expired'").all(tenantId),
  };

  return { estimating, pumping, marketing, compliance };
}

export function getCeoRedFlags(tenantId) {
  const flags = [];

  // ESTIMATING red flags
  const overdueBids = db.prepare("SELECT * FROM dacp_bid_requests WHERE tenant_id = ? AND due_date < date('now') AND status NOT IN ('passed', 'estimated', 'awarded', 'proposal_sent') LIMIT 5").all(tenantId);
  for (const b of overdueBids) {
    flags.push({ department: 'estimating', severity: 'high', title: 'Overdue bid response', detail: `${b.gc_name || 'Unknown GC'}: "${b.subject}" was due ${b.due_date}`, item_id: b.id });
  }
  const staleNewBids = db.prepare("SELECT * FROM dacp_bid_requests WHERE tenant_id = ? AND status = 'new' AND received_at < date('now', '-7 days') LIMIT 5").all(tenantId);
  for (const b of staleNewBids) {
    flags.push({ department: 'estimating', severity: 'medium', title: 'Unreviewed bid request (7+ days)', detail: `${b.gc_name}: "${b.subject}" received ${b.received_at}`, item_id: b.id });
  }

  // Bond rate above market
  const aboveMarketBonds = db.prepare("SELECT * FROM dacp_bond_program WHERE tenant_id = ? AND rate_flag = 'above_market' LIMIT 3").all(tenantId);
  for (const bp of aboveMarketBonds) {
    flags.push({ department: 'estimating', severity: 'high', title: 'Bond rate above market', detail: `${bp.surety_company}: ${bp.current_rate_pct}% vs market ${bp.market_benchmark_pct}%`, item_id: bp.id });
  }

  // Unanswered RFIs older than 5 days
  const staleRfis = db.prepare("SELECT * FROM dacp_rfis WHERE tenant_id = ? AND status = 'sent' AND sent_date < date('now', '-5 days') LIMIT 5").all(tenantId);
  for (const r of staleRfis) {
    flags.push({ department: 'estimating', severity: 'medium', title: 'Unanswered RFI (5+ days)', detail: `${r.gc_name}: "${r.subject}" sent ${r.sent_date}`, item_id: r.id });
  }

  // Unsent bid distributions
  const unsentDists = db.prepare("SELECT project_name, COUNT(*) as c FROM dacp_bid_distributions WHERE tenant_id = ? AND bid_status = 'draft' GROUP BY project_name LIMIT 5").all(tenantId);
  for (const d of unsentDists) {
    flags.push({ department: 'estimating', severity: 'medium', title: 'Unsent bid distributions', detail: `${d.project_name}: ${d.c} distribution(s) still in draft`, item_id: null });
  }

  // PUMPING red flags
  const overdueInvoices = db.prepare("SELECT * FROM dacp_pumping_jobs WHERE tenant_id = ? AND invoice_status = 'overdue' LIMIT 5").all(tenantId);
  for (const j of overdueInvoices) {
    flags.push({ department: 'pumping', severity: 'high', title: 'Overdue invoice', detail: `${j.customer_name}: $${j.invoice_amount?.toLocaleString()} sent ${j.invoice_sent_date}`, item_id: j.id });
  }
  const uninvoiced = db.prepare("SELECT * FROM dacp_pumping_jobs WHERE tenant_id = ? AND status = 'completed' AND invoice_status = 'pending' LIMIT 5").all(tenantId);
  for (const j of uninvoiced) {
    flags.push({ department: 'pumping', severity: 'medium', title: 'Completed job not invoiced', detail: `${j.customer_name}: ${j.job_date} at ${j.location}`, item_id: j.id });
  }
  const maintenanceDue = db.prepare("SELECT * FROM dacp_pumping_equipment WHERE tenant_id = ? AND next_service_date <= date('now', '+14 days') LIMIT 5").all(tenantId);
  for (const e of maintenanceDue) {
    flags.push({ department: 'pumping', severity: e.next_service_date < new Date().toISOString().split('T')[0] ? 'high' : 'medium', title: 'Equipment maintenance due', detail: `${e.name} (${e.model}): service due ${e.next_service_date}`, item_id: e.id });
  }

  // MARKETING red flags
  const staleLeads = db.prepare("SELECT * FROM dacp_marketing_leads WHERE tenant_id = ? AND status = 'stale' LIMIT 5").all(tenantId);
  for (const l of staleLeads) {
    flags.push({ department: 'marketing', severity: 'medium', title: 'Stale lead - no response', detail: `${l.company_name}: ${l.project_name || 'Unknown project'} ($${(l.project_value / 1000000).toFixed(1)}M)`, item_id: l.id });
  }
  const missedFollowups = db.prepare("SELECT * FROM dacp_marketing_leads WHERE tenant_id = ? AND next_followup_date < date('now') AND status NOT IN ('won', 'lost', 'stale') LIMIT 5").all(tenantId);
  for (const l of missedFollowups) {
    flags.push({ department: 'marketing', severity: 'medium', title: 'Missed follow-up date', detail: `${l.company_name}: follow-up was due ${l.next_followup_date}`, item_id: l.id });
  }

  // COMPLIANCE red flags
  const expiredItems = db.prepare("SELECT * FROM dacp_compliance_items WHERE tenant_id = ? AND status = 'expired'").all(tenantId);
  for (const c of expiredItems) {
    flags.push({ department: 'compliance', severity: 'critical', title: 'Expired: ' + c.category, detail: `${c.name} expired ${c.expiry_date}. Responsible: ${c.responsible_person || 'Unassigned'}`, item_id: c.id });
  }
  const expiringSoon = db.prepare("SELECT * FROM dacp_compliance_items WHERE tenant_id = ? AND status = 'expiring_soon'").all(tenantId);
  for (const c of expiringSoon) {
    flags.push({ department: 'compliance', severity: 'high', title: 'Expiring soon: ' + c.category, detail: `${c.name} expires ${c.expiry_date}. Responsible: ${c.responsible_person || 'Unassigned'}`, item_id: c.id });
  }
  const openIncidents = db.prepare("SELECT * FROM dacp_compliance_incidents WHERE tenant_id = ? AND status IN ('open', 'investigating') AND severity IN ('high', 'critical')").all(tenantId);
  for (const i of openIncidents) {
    flags.push({ department: 'compliance', severity: i.severity, title: 'Open incident: ' + i.type.replace(/_/g, ' '), detail: i.description, item_id: i.id });
  }

  // Sort: critical > high > medium > low
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  flags.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));

  return flags;
}

export function getPumpingEquipment(tenantId) {
  return db.prepare('SELECT * FROM dacp_pumping_equipment WHERE tenant_id = ? ORDER BY name').all(tenantId);
}

export function getPumpingJobs(tenantId, status, limit = 50) {
  if (status) {
    return db.prepare('SELECT * FROM dacp_pumping_jobs WHERE tenant_id = ? AND status = ? ORDER BY job_date DESC LIMIT ?').all(tenantId, status, limit);
  }
  return db.prepare('SELECT * FROM dacp_pumping_jobs WHERE tenant_id = ? ORDER BY job_date DESC LIMIT ?').all(tenantId, limit);
}

export function getMarketingLeads(tenantId, status, limit = 50) {
  if (status) {
    return db.prepare('SELECT * FROM dacp_marketing_leads WHERE tenant_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?').all(tenantId, status, limit);
  }
  return db.prepare('SELECT * FROM dacp_marketing_leads WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?').all(tenantId, limit);
}

export function getMarketingCampaigns(tenantId) {
  return db.prepare('SELECT * FROM dacp_marketing_campaigns WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function getComplianceItems(tenantId, category) {
  if (category) {
    return db.prepare('SELECT * FROM dacp_compliance_items WHERE tenant_id = ? AND category = ? ORDER BY expiry_date ASC').all(tenantId, category);
  }
  return db.prepare('SELECT * FROM dacp_compliance_items WHERE tenant_id = ? ORDER BY expiry_date ASC').all(tenantId);
}

export function getComplianceIncidents(tenantId, status) {
  if (status) {
    return db.prepare('SELECT * FROM dacp_compliance_incidents WHERE tenant_id = ? AND status = ? ORDER BY reported_date DESC').all(tenantId, status);
  }
  return db.prepare('SELECT * FROM dacp_compliance_incidents WHERE tenant_id = ? ORDER BY reported_date DESC').all(tenantId);
}

export function insertCeoDepartmentReport(tenantId, department, period, kpiData, redFlags, summary) {
  return db.prepare(`
    INSERT INTO ceo_department_reports (tenant_id, department, period, kpi_data_json, red_flags_json, summary)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tenantId, department, period, JSON.stringify(kpiData), JSON.stringify(redFlags), summary);
}

export function getCeoDepartmentReports(tenantId, department, limit = 10) {
  if (department) {
    return db.prepare('SELECT * FROM ceo_department_reports WHERE tenant_id = ? AND department = ? ORDER BY generated_at DESC LIMIT ?').all(tenantId, department, limit);
  }
  return db.prepare('SELECT * FROM ceo_department_reports WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT ?').all(tenantId, limit);
}

// ─── DACP Suppliers ───
export function getDacpSuppliers(tenantId, type = null) {
  if (type) return db.prepare('SELECT * FROM dacp_suppliers WHERE tenant_id = ? AND supplier_type = ? AND status = ? ORDER BY name').all(tenantId, type, 'active');
  return db.prepare('SELECT * FROM dacp_suppliers WHERE tenant_id = ? AND status = ? ORDER BY supplier_type, name').all(tenantId, 'active');
}

export function upsertDacpSupplier(supplier) {
  return db.prepare(`
    INSERT INTO dacp_suppliers (id, tenant_id, name, supplier_type, contact_name, contact_email, contact_phone, address, city, state, zip, lat, lng, website, pricing_json, delivery_radius_miles, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, contact_name=excluded.contact_name, contact_email=excluded.contact_email, contact_phone=excluded.contact_phone, address=excluded.address, city=excluded.city, state=excluded.state, zip=excluded.zip, lat=excluded.lat, lng=excluded.lng, website=excluded.website, pricing_json=excluded.pricing_json, delivery_radius_miles=excluded.delivery_radius_miles, notes=excluded.notes, updated_at=datetime('now')
  `).run(supplier.id, supplier.tenantId, supplier.name, supplier.supplierType, supplier.contactName, supplier.contactEmail, supplier.contactPhone, supplier.address, supplier.city, supplier.state, supplier.zip, supplier.lat, supplier.lng, supplier.website, supplier.pricingJson, supplier.deliveryRadiusMiles, supplier.notes, supplier.status || 'active');
}

export function updateSupplierQuoteDate(tenantId, supplierId) {
  return db.prepare('UPDATE dacp_suppliers SET last_quote_date = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ? AND tenant_id = ?').run(supplierId, tenantId);
}

// ─── DACP RFIs ───
export function getDacpRfis(tenantId, bidRequestId = null) {
  if (bidRequestId) return db.prepare('SELECT * FROM dacp_rfis WHERE tenant_id = ? AND bid_request_id = ? ORDER BY created_at DESC').all(tenantId, bidRequestId);
  return db.prepare('SELECT * FROM dacp_rfis WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function createDacpRfi(rfi) {
  return db.prepare('INSERT INTO dacp_rfis (id, tenant_id, bid_request_id, job_id, gc_name, gc_email, subject, body, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(rfi.id, rfi.tenantId, rfi.bidRequestId, rfi.jobId, rfi.gcName, rfi.gcEmail, rfi.subject, rfi.body, rfi.category || 'scope', rfi.status || 'draft');
}

export function updateDacpRfi(tenantId, rfiId, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    fields.push(`${col} = ?`);
    values.push(v);
  }
  values.push(rfiId, tenantId);
  return db.prepare(`UPDATE dacp_rfis SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
}

// ─── DACP Project Specs ───
export function getDacpProjectSpecs(tenantId, bidRequestId) {
  return db.prepare('SELECT * FROM dacp_project_specs WHERE tenant_id = ? AND bid_request_id = ?').get(tenantId, bidRequestId);
}

export function upsertDacpProjectSpecs(specs) {
  return db.prepare(`
    INSERT INTO dacp_project_specs (id, tenant_id, bid_request_id, job_id, project_name, tax_status, tax_details, labor_requirements_json, bond_required, bond_type, concrete_specs_json, rebar_specs_json, special_conditions_json, vbe_sblvb_required, vbe_sblvb_details, parsed_from_doc_id, raw_extracted_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET tax_status=excluded.tax_status, tax_details=excluded.tax_details, labor_requirements_json=excluded.labor_requirements_json, bond_required=excluded.bond_required, bond_type=excluded.bond_type, concrete_specs_json=excluded.concrete_specs_json, rebar_specs_json=excluded.rebar_specs_json, special_conditions_json=excluded.special_conditions_json, vbe_sblvb_required=excluded.vbe_sblvb_required, vbe_sblvb_details=excluded.vbe_sblvb_details, parsed_from_doc_id=excluded.parsed_from_doc_id, raw_extracted_text=excluded.raw_extracted_text
  `).run(specs.id, specs.tenantId, specs.bidRequestId, specs.jobId, specs.projectName, specs.taxStatus, specs.taxDetails, specs.laborRequirementsJson, specs.bondRequired ? 1 : 0, specs.bondType, specs.concreteSpecsJson, specs.rebarSpecsJson, specs.specialConditionsJson, specs.vbeSblvbRequired ? 1 : 0, specs.vbeSblvbDetails, specs.parsedFromDocId, specs.rawExtractedText);
}

// ─── DACP Bid Distributions ───
export function getDacpBidDistributions(tenantId, bidRequestId = null) {
  if (bidRequestId) return db.prepare('SELECT * FROM dacp_bid_distributions WHERE tenant_id = ? AND bid_request_id = ? ORDER BY created_at DESC').all(tenantId, bidRequestId);
  return db.prepare('SELECT * FROM dacp_bid_distributions WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function createDacpBidDistribution(dist) {
  return db.prepare('INSERT INTO dacp_bid_distributions (id, tenant_id, bid_request_id, estimate_id, project_name, gc_name, gc_email, gc_contact, gc_reputation, adjusted_total, adjustment_reason, bid_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(dist.id, dist.tenantId, dist.bidRequestId, dist.estimateId, dist.projectName, dist.gcName, dist.gcEmail, dist.gcContact, dist.gcReputation, dist.adjustedTotal, dist.adjustmentReason, dist.bidStatus || 'draft');
}

export function updateDacpBidDistribution(tenantId, distId, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    fields.push(`${col} = ?`);
    values.push(v);
  }
  values.push(distId, tenantId);
  return db.prepare(`UPDATE dacp_bid_distributions SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
}

// ─── DACP Pre-Qualification Packages ───

export function getDacpPrequalPackages(tenantId) {
  return db.prepare('SELECT * FROM dacp_prequal_packages WHERE tenant_id = ? ORDER BY gc_name ASC').all(tenantId);
}

export function getDacpPrequalPackage(tenantId, id) {
  return db.prepare('SELECT * FROM dacp_prequal_packages WHERE tenant_id = ? AND id = ?').get(tenantId, id);
}

export function createDacpPrequalPackage(pkg) {
  return db.prepare(
    `INSERT INTO dacp_prequal_packages (id, tenant_id, gc_name, gc_contact_name, gc_contact_email, status, sent_date, received_date, expiry_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(pkg.id, pkg.tenant_id, pkg.gc_name, pkg.gc_contact_name || null, pkg.gc_contact_email || null, pkg.status || 'not_sent', pkg.sent_date || null, pkg.received_date || null, pkg.expiry_date || null, pkg.notes || null);
}

export function updateDacpPrequalPackage(tenantId, id, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(tenantId, id);
  return db.prepare(`UPDATE dacp_prequal_packages SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...values);
}

// ─── DACP Bond Program ───
export function getDacpBondProgram(tenantId) {
  return db.prepare('SELECT * FROM dacp_bond_program WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function upsertDacpBondProgram(bond) {
  return db.prepare(`
    INSERT INTO dacp_bond_program (id, tenant_id, surety_company, surety_contact, surety_email, surety_phone, total_capacity, current_utilization, tiers_json, current_rate_pct, market_benchmark_pct, rate_flag, effective_date, expiry_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET surety_company=excluded.surety_company, surety_contact=excluded.surety_contact, surety_email=excluded.surety_email, total_capacity=excluded.total_capacity, current_utilization=excluded.current_utilization, tiers_json=excluded.tiers_json, current_rate_pct=excluded.current_rate_pct, market_benchmark_pct=excluded.market_benchmark_pct, rate_flag=excluded.rate_flag, effective_date=excluded.effective_date, expiry_date=excluded.expiry_date, notes=excluded.notes, updated_at=datetime('now')
  `).run(bond.id, bond.tenantId, bond.suretyCompany, bond.suretyContact, bond.suretyEmail, bond.suretyPhone, bond.totalCapacity, bond.currentUtilization, bond.tiersJson, bond.currentRatePct, bond.marketBenchmarkPct, bond.rateFlag, bond.effectiveDate, bond.expiryDate, bond.notes);
}

export function checkBondRateFlag(tenantId) {
  return db.prepare('SELECT * FROM dacp_bond_program WHERE tenant_id = ? AND current_rate_pct > market_benchmark_pct * 1.2').all(tenantId);
}

// ─── DACP GC Offices (Sales Trip Planner) ─────────────────────────────────

export function getDacpGcOffices(tenantId) {
  return db.prepare('SELECT * FROM dacp_gc_offices WHERE tenant_id = ? ORDER BY gc_name ASC').all(tenantId);
}

export function getDacpGcOffice(tenantId, id) {
  return db.prepare('SELECT * FROM dacp_gc_offices WHERE tenant_id = ? AND id = ?').get(tenantId, id);
}

export function createDacpGcOffice(office) {
  return db.prepare(
    `INSERT INTO dacp_gc_offices (id, tenant_id, gc_name, address, city, state, zip, phone, website, office_type, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(office.id, office.tenant_id, office.gc_name, office.address || null, office.city || null, office.state || null, office.zip || null, office.phone || null, office.website || null, office.office_type || 'main', office.notes || null);
}

export function updateDacpGcOffice(tenantId, id, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(tenantId, id);
  return db.prepare(`UPDATE dacp_gc_offices SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...values);
}

// ─── DACP Sales Trips ─────────────────────────────────────────────────────

export function getDacpSalesTrips(tenantId) {
  return db.prepare('SELECT * FROM dacp_sales_trips WHERE tenant_id = ? ORDER BY date DESC, created_at DESC').all(tenantId);
}

export function getDacpSalesTrip(tenantId, id) {
  return db.prepare('SELECT * FROM dacp_sales_trips WHERE tenant_id = ? AND id = ?').get(tenantId, id);
}

export function createDacpSalesTrip(trip) {
  return db.prepare(
    `INSERT INTO dacp_sales_trips (id, tenant_id, name, date, status, stops_json, route_url, total_distance_mi, total_duration_min, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(trip.id, trip.tenant_id, trip.name, trip.date || null, trip.status || 'planned', trip.stops_json || '[]', trip.route_url || null, trip.total_distance_mi || null, trip.total_duration_min || null, trip.notes || null, trip.created_by || null);
}

export function updateDacpSalesTrip(tenantId, id, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    fields.push(`${k} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;
  fields.push("updated_at = datetime('now')");
  values.push(tenantId, id);
  return db.prepare(`UPDATE dacp_sales_trips SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...values);
}

// ─── Construction Tax Rules CRUD ──────────────────────────────────────────

export function getConstructionTaxRules(tenantId) {
  return db.prepare('SELECT * FROM construction_tax_rules WHERE tenant_id = ? ORDER BY state').all(tenantId);
}

export function getConstructionTaxRule(tenantId, state) {
  return db.prepare('SELECT * FROM construction_tax_rules WHERE tenant_id = ? AND state = ?').get(tenantId, state);
}

export function getConstructionTaxRuleById(id) {
  return db.prepare('SELECT * FROM construction_tax_rules WHERE id = ?').get(id);
}

export function upsertConstructionTaxRule(rule) {
  return db.prepare(`
    INSERT INTO construction_tax_rules (id, tenant_id, state, state_name, base_sales_tax_rate, max_combined_rate, contractor_classification, contractor_model_description, govt_project_exempt, govt_exemption_mechanism, govt_exemption_form, bond_threshold, bond_amount_pct, bond_tiers_json, prevailing_wage, prevailing_wage_threshold, prevailing_wage_notes, labor_taxable, labor_tax_notes, use_tax_rate, special_taxes_json, mpc_details_json, notes, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id, state) DO UPDATE SET
      state_name = excluded.state_name,
      base_sales_tax_rate = excluded.base_sales_tax_rate,
      max_combined_rate = excluded.max_combined_rate,
      contractor_classification = excluded.contractor_classification,
      contractor_model_description = excluded.contractor_model_description,
      govt_project_exempt = excluded.govt_project_exempt,
      govt_exemption_mechanism = excluded.govt_exemption_mechanism,
      govt_exemption_form = excluded.govt_exemption_form,
      bond_threshold = excluded.bond_threshold,
      bond_amount_pct = excluded.bond_amount_pct,
      bond_tiers_json = excluded.bond_tiers_json,
      prevailing_wage = excluded.prevailing_wage,
      prevailing_wage_threshold = excluded.prevailing_wage_threshold,
      prevailing_wage_notes = excluded.prevailing_wage_notes,
      labor_taxable = excluded.labor_taxable,
      labor_tax_notes = excluded.labor_tax_notes,
      use_tax_rate = excluded.use_tax_rate,
      special_taxes_json = excluded.special_taxes_json,
      mpc_details_json = excluded.mpc_details_json,
      notes = excluded.notes,
      updated_at = datetime('now')
  `).run(
    rule.id, rule.tenantId, rule.state, rule.stateName,
    rule.baseSalesTaxRate, rule.maxCombinedRate,
    rule.contractorClassification, rule.contractorModelDescription,
    rule.govtProjectExempt ? 1 : 0, rule.govtExemptionMechanism, rule.govtExemptionForm,
    rule.bondThreshold, rule.bondAmountPct || 100, rule.bondTiersJson,
    rule.prevailingWage ? 1 : 0, rule.prevailingWageThreshold, rule.prevailingWageNotes,
    rule.laborTaxable ? 1 : 0, rule.laborTaxNotes,
    rule.useTaxRate, rule.specialTaxesJson, rule.mpcDetailsJson, rule.notes
  );
}

export function deleteConstructionTaxRule(tenantId, state) {
  return db.prepare('DELETE FROM construction_tax_rules WHERE tenant_id = ? AND state = ?').run(tenantId, state);
}

// ─── Lead Engine CRUD Helpers ────────────────────────────────────────────────

export function getLeads(tenantId, status, limit = 100) {
  if (status) {
    return db.prepare('SELECT * FROM le_leads WHERE tenant_id = ? AND status = ? ORDER BY priority_score DESC, discovered_at DESC LIMIT ?').all(tenantId, status, limit);
  }
  return db.prepare('SELECT * FROM le_leads WHERE tenant_id = ? ORDER BY priority_score DESC, discovered_at DESC LIMIT ?').all(tenantId, limit);
}

export function getLead(tenantId, id) {
  return db.prepare('SELECT * FROM le_leads WHERE tenant_id = ? AND id = ?').get(tenantId, id);
}

export function insertLead(lead) {
  return db.prepare(`
    INSERT OR IGNORE INTO le_leads (id, tenant_id, venue_name, region, industry, trigger_news, priority_score, website, status, source, source_query, discovered_at, notes, agent_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    lead.id, lead.tenantId, lead.venueName, lead.region || null, lead.industry || null,
    lead.triggerNews || null, lead.priorityScore || 0, lead.website || null,
    lead.status || 'new', lead.source || 'discovery', lead.sourceQuery || null,
    lead.discoveredAt || new Date().toISOString(), lead.notes || null, lead.agentNotes || null
  );
}

export function updateLead(tenantId, id, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    fields.push(`${col} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;
  values.push(tenantId, id);
  return db.prepare(`UPDATE le_leads SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...values);
}

export function getLeadContacts(tenantId, leadId) {
  return db.prepare('SELECT * FROM le_contacts WHERE tenant_id = ? AND lead_id = ? ORDER BY created_at').all(tenantId, leadId);
}

export function insertLeadContact(contact) {
  return db.prepare(`
    INSERT OR IGNORE INTO le_contacts (id, tenant_id, lead_id, name, email, title, phone, source, mx_valid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    contact.id, contact.tenantId, contact.leadId, contact.name || null,
    contact.email, contact.title || null, contact.phone || null,
    contact.source || 'discovery', contact.mxValid ?? 1
  );
}

export function getOutreachLog(tenantId, status, limit = 100) {
  let query = `
    SELECT o.*, l.venue_name, l.region, l.industry, c.name as contact_name, c.email as contact_email
    FROM le_outreach_log o
    LEFT JOIN le_leads l ON o.lead_id = l.id
    LEFT JOIN le_contacts c ON o.contact_id = c.id
    WHERE o.tenant_id = ?
  `;
  const params = [tenantId];
  if (status) {
    query += ' AND o.status = ?';
    params.push(status);
  }
  query += ' ORDER BY o.created_at DESC LIMIT ?';
  params.push(limit);
  return db.prepare(query).all(...params);
}

export function insertOutreachEntry(entry) {
  return db.prepare(`
    INSERT INTO le_outreach_log (id, tenant_id, lead_id, contact_id, email_type, subject, body, status, sent_at, approved_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id, entry.tenantId, entry.leadId, entry.contactId || null,
    entry.emailType || 'initial', entry.subject || null, entry.body || null,
    entry.status || 'draft', entry.sentAt || null, entry.approvedBy || null,
    entry.createdAt || new Date().toISOString()
  );
}

export function updateOutreachEntry(tenantId, id, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    const col = k.replace(/([A-Z])/g, '_$1').toLowerCase();
    fields.push(`${col} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;
  values.push(tenantId, id);
  return db.prepare(`UPDATE le_outreach_log SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`).run(...values);
}

export function getLeadDiscoveryConfig(tenantId) {
  const row = db.prepare('SELECT * FROM le_discovery_config WHERE tenant_id = ?').get(tenantId);
  if (row) {
    row.queries = row.queries_json ? JSON.parse(row.queries_json) : [];
    row.regions = row.regions_json ? JSON.parse(row.regions_json) : [];
  }
  return row;
}

export function upsertLeadDiscoveryConfig(config) {
  return db.prepare(`
    INSERT INTO le_discovery_config (id, tenant_id, queries_json, regions_json, current_position, queries_per_cycle, max_emails_per_cycle, followup_delay_days, max_followups, min_send_interval_seconds, enabled, mode, sender_name, sender_email, email_signature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id) DO UPDATE SET
      queries_json = excluded.queries_json,
      regions_json = excluded.regions_json,
      current_position = excluded.current_position,
      queries_per_cycle = excluded.queries_per_cycle,
      max_emails_per_cycle = excluded.max_emails_per_cycle,
      followup_delay_days = excluded.followup_delay_days,
      max_followups = excluded.max_followups,
      min_send_interval_seconds = excluded.min_send_interval_seconds,
      enabled = excluded.enabled,
      mode = excluded.mode,
      sender_name = excluded.sender_name,
      sender_email = excluded.sender_email,
      email_signature = excluded.email_signature
  `).run(
    config.id || `ldc-${config.tenantId}`, config.tenantId,
    JSON.stringify(config.queries || []), JSON.stringify(config.regions || []),
    config.currentPosition || 0, config.queriesPerCycle || 2,
    config.maxEmailsPerCycle || 10, config.followupDelayDays || 5,
    config.maxFollowups || 2, config.minSendIntervalSeconds || 300,
    config.enabled ? 1 : 0, config.mode || 'copilot',
    config.senderName || null, config.senderEmail || null,
    config.emailSignature || null
  );
}

export function getLeadStats(tenantId) {
  const total = db.prepare('SELECT COUNT(*) as c FROM le_leads WHERE tenant_id = ?').get(tenantId);
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as c FROM le_leads WHERE tenant_id = ? GROUP BY status
  `).all(tenantId);
  const statusMap = {};
  for (const row of byStatus) statusMap[row.status] = row.c;

  const totalSent = db.prepare(`SELECT COUNT(*) as c FROM le_outreach_log WHERE tenant_id = ? AND status = 'sent'`).get(tenantId);
  const totalResponded = db.prepare(`SELECT COUNT(*) as c FROM le_outreach_log WHERE tenant_id = ? AND responded_at IS NOT NULL`).get(tenantId);
  const drafts = db.prepare(`SELECT COUNT(*) as c FROM le_outreach_log WHERE tenant_id = ? AND status = 'draft'`).get(tenantId);
  const today = new Date().toISOString().slice(0, 10);
  const sentToday = db.prepare(`SELECT COUNT(*) as c FROM le_outreach_log WHERE tenant_id = ? AND status = 'sent' AND sent_at LIKE ?`).get(tenantId, today + '%');

  const responseRate = totalSent.c > 0 ? Math.round((totalResponded.c / totalSent.c) * 1000) / 10 : 0;

  return {
    totalLeads: total.c,
    newLeads: statusMap.new || 0,
    enrichedLeads: statusMap.enriched || 0,
    contactedLeads: statusMap.contacted || 0,
    respondedLeads: statusMap.responded || 0,
    meetingLeads: statusMap.meeting || 0,
    qualifiedLeads: statusMap.qualified || 0,
    totalEmailsSent: totalSent.c,
    totalResponded: totalResponded.c,
    responseRate,
    pendingDrafts: drafts.c,
    sentToday: sentToday.c,
  };
}

// ─── Lead Engine Extended Queries ────────────────────────────────────────────

export function getAllContacts(tenantId, { search, limit = 100, offset = 0 } = {}) {
  let query = `
    SELECT c.*, l.venue_name, l.region, l.industry, l.status as lead_status
    FROM le_contacts c
    LEFT JOIN le_leads l ON c.lead_id = l.id
    WHERE c.tenant_id = ?
  `;
  const params = [tenantId];
  if (search) {
    query += ` AND (c.name LIKE ? OR c.email LIKE ? OR c.title LIKE ? OR l.venue_name LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }
  query += ` ORDER BY c.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  return db.prepare(query).all(...params);
}

export function getOutreachReplies(tenantId, limit = 50) {
  return db.prepare(`
    SELECT o.*, l.venue_name, l.region, l.industry, c.name as contact_name, c.email as contact_email
    FROM le_outreach_log o
    LEFT JOIN le_leads l ON o.lead_id = l.id
    LEFT JOIN le_contacts c ON o.contact_id = c.id
    WHERE o.tenant_id = ? AND o.responded_at IS NOT NULL
    ORDER BY o.responded_at DESC
    LIMIT ?
  `).all(tenantId, limit);
}

export function getFollowupQueue(tenantId, delayDays = 5) {
  return db.prepare(`
    SELECT o.*, l.venue_name, l.region, l.industry, c.name as contact_name, c.email as contact_email,
      CAST(julianday('now') - julianday(o.sent_at) AS INTEGER) as days_since_sent
    FROM le_outreach_log o
    LEFT JOIN le_leads l ON o.lead_id = l.id
    LEFT JOIN le_contacts c ON o.contact_id = c.id
    WHERE o.tenant_id = ? AND o.status = 'sent' AND o.responded_at IS NULL
      AND julianday('now') - julianday(o.sent_at) >= ?
    ORDER BY o.sent_at ASC
  `).all(tenantId, delayDays);
}

// ─── API Usage Tracking ─────────────────────────────────────────────────────

export function getUsageStats(tenantId, startDate, endDate) {
  const sql = `
    SELECT
      json_extract(metadata_json, '$.model') as model,
      COUNT(*) as requests,
      SUM(json_extract(metadata_json, '$.input_tokens')) as input_tokens,
      SUM(json_extract(metadata_json, '$.output_tokens')) as output_tokens
    FROM chat_messages
    WHERE tenant_id = ? AND role = 'assistant' AND metadata_json IS NOT NULL
      AND created_at >= ? AND created_at <= ?
    GROUP BY model
  `;
  return db.prepare(sql).all(tenantId, startDate, endDate);
}

export function getUsageByUser(tenantId, startDate, endDate) {
  const sql = `
    SELECT
      user_id,
      json_extract(metadata_json, '$.model') as model,
      COUNT(*) as requests,
      SUM(json_extract(metadata_json, '$.input_tokens')) as input_tokens,
      SUM(json_extract(metadata_json, '$.output_tokens')) as output_tokens
    FROM chat_messages
    WHERE tenant_id = ? AND role = 'assistant' AND metadata_json IS NOT NULL
      AND created_at >= ? AND created_at <= ?
    GROUP BY user_id, model
  `;
  return db.prepare(sql).all(tenantId, startDate, endDate);
}

export function getUsageByDay(tenantId, startDate, endDate) {
  const sql = `
    SELECT
      date(created_at) as day,
      COUNT(*) as requests,
      SUM(json_extract(metadata_json, '$.input_tokens')) as input_tokens,
      SUM(json_extract(metadata_json, '$.output_tokens')) as output_tokens
    FROM chat_messages
    WHERE tenant_id = ? AND role = 'assistant' AND metadata_json IS NOT NULL
      AND created_at >= ? AND created_at <= ?
    GROUP BY date(created_at)
    ORDER BY day
  `;
  return db.prepare(sql).all(tenantId, startDate, endDate);
}

export function getUsageAllTenants(startDate, endDate) {
  const tenants = getAllTenants();
  const results = [];
  const sql = `
    SELECT
      json_extract(metadata_json, '$.model') as model,
      COUNT(*) as requests,
      SUM(json_extract(metadata_json, '$.input_tokens')) as input_tokens,
      SUM(json_extract(metadata_json, '$.output_tokens')) as output_tokens
    FROM chat_messages
    WHERE role = 'assistant' AND metadata_json IS NOT NULL
      AND created_at >= ? AND created_at <= ?
    GROUP BY model
  `;
  for (const tenant of tenants) {
    try {
      const tdb = getTenantDb(tenant.id);
      const rows = tdb.prepare(sql).all(startDate, endDate);
      for (const row of rows) {
        results.push({ ...row, tenant_id: tenant.id });
      }
    } catch {}
  }
  return results;
}

export function getUsageByDayAllTenants(startDate, endDate) {
  const tenants = getAllTenants();
  const dayMap = {};
  const sql = `
    SELECT
      date(created_at) as day,
      COUNT(*) as requests,
      SUM(json_extract(metadata_json, '$.input_tokens')) as input_tokens,
      SUM(json_extract(metadata_json, '$.output_tokens')) as output_tokens
    FROM chat_messages
    WHERE role = 'assistant' AND metadata_json IS NOT NULL
      AND created_at >= ? AND created_at <= ?
    GROUP BY date(created_at)
    ORDER BY day
  `;
  for (const tenant of tenants) {
    try {
      const tdb = getTenantDb(tenant.id);
      const rows = tdb.prepare(sql).all(startDate, endDate);
      for (const row of rows) {
        if (!dayMap[row.day]) {
          dayMap[row.day] = { day: row.day, requests: 0, input_tokens: 0, output_tokens: 0 };
        }
        dayMap[row.day].requests += row.requests || 0;
        dayMap[row.day].input_tokens += row.input_tokens || 0;
        dayMap[row.day].output_tokens += row.output_tokens || 0;
      }
    } catch {}
  }
  return Object.values(dayMap).sort((a, b) => a.day.localeCompare(b.day));
}

// ─── Tenant Files ─────────────────────────────────────────────────────────

function initFilesTable(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS tenant_files (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      file_type TEXT,
      size_bytes INTEGER DEFAULT 0,
      modified_at TEXT,
      drive_file_id TEXT,
      drive_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_tenant_files_tenant ON tenant_files(tenant_id)'); } catch (e) { /* exists */ }
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_tenant_files_category ON tenant_files(tenant_id, category)'); } catch (e) { /* exists */ }
}

export function getTenantFiles(tenantId, { category, search, limit = 100 } = {}) {
  let sql = 'SELECT * FROM tenant_files WHERE tenant_id = ?';
  const params = [tenantId];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (search) {
    sql += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }
  sql += ' ORDER BY modified_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(params);
}

export function getTenantFileCategories(tenantId) {
  return db.prepare(
    'SELECT category, COUNT(*) as count FROM tenant_files WHERE tenant_id = ? GROUP BY category ORDER BY count DESC'
  ).all(tenantId);
}

export function upsertTenantFile(file) {
  return db.prepare(`
    INSERT OR REPLACE INTO tenant_files (id, tenant_id, name, category, file_type, size_bytes, modified_at, drive_file_id, drive_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(file.id, file.tenant_id, file.name, file.category, file.file_type, file.size_bytes, file.modified_at, file.drive_file_id, file.drive_url);
}

export function getTenantFileCount(tenantId) {
  return db.prepare('SELECT COUNT(*) as count FROM tenant_files WHERE tenant_id = ?').get(tenantId).count;
}

// ─── Drive Sync (Auto-scan + RAG) ───────────────────────────────────────────

function initDriveSyncTables(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS drive_synced_files (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      category TEXT,
      file_type TEXT,
      size_bytes INTEGER DEFAULT 0,
      modified_time TEXT,
      drive_url TEXT,
      parent_folder_name TEXT,
      has_content INTEGER DEFAULT 0,
      content_length INTEGER DEFAULT 0,
      content_text TEXT,
      first_synced_at TEXT DEFAULT (datetime('now')),
      last_synced_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_dsf_tenant ON drive_synced_files(tenant_id)'); } catch (e) {}

  // FTS5 for full-text search of Drive file contents
  // Migrate: drop old 2-column schema if it exists
  try {
    const ftsInfo = targetDb.pragma("table_info('drive_fts')");
    if (ftsInfo.length > 0 && !ftsInfo.some(c => c.name === 'drive_file_id')) {
      targetDb.exec('DROP TABLE IF EXISTS drive_fts');
    }
  } catch (e) { /* table may not exist */ }
  try {
    targetDb.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS drive_fts USING fts5(
        drive_file_id, tenant_id, name, content_text, tokenize='porter unicode61'
      )
    `);
  } catch (e) { /* FTS5 may already exist */ }

  // Sync status tracking per tenant
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS drive_sync_status (
      tenant_id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'idle',
      started_at TEXT,
      completed_at TEXT,
      files_found INTEGER DEFAULT 0,
      files_indexed INTEGER DEFAULT 0,
      error_message TEXT,
      last_successful_sync TEXT
    )
  `);
}

export function getDriveSyncStatus(tenantId) {
  return db.prepare('SELECT * FROM drive_sync_status WHERE tenant_id = ?').get(tenantId) || null;
}

export function upsertDriveSyncStatus(tenantId, updates) {
  const existing = db.prepare('SELECT * FROM drive_sync_status WHERE tenant_id = ?').get(tenantId);
  if (!existing) {
    db.prepare('INSERT INTO drive_sync_status (tenant_id, status) VALUES (?, ?)').run(tenantId, 'idle');
  }
  const fields = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = Object.values(updates);
  db.prepare(`UPDATE drive_sync_status SET ${fields} WHERE tenant_id = ?`).run(...values, tenantId);
}

export function upsertDriveSyncedFile(file) {
  return db.prepare(`
    INSERT INTO drive_synced_files (id, tenant_id, name, mime_type, category, file_type, size_bytes, modified_time, drive_url, parent_folder_name, has_content, content_length, content_text, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, mime_type = excluded.mime_type, category = excluded.category,
      file_type = excluded.file_type, size_bytes = excluded.size_bytes, modified_time = excluded.modified_time,
      drive_url = excluded.drive_url, parent_folder_name = excluded.parent_folder_name,
      has_content = excluded.has_content, content_length = excluded.content_length,
      content_text = excluded.content_text, last_synced_at = datetime('now')
  `).run(file.id, file.tenantId, file.name, file.mimeType, file.category || 'Other', file.fileType, file.sizeBytes || 0, file.modifiedTime, file.driveUrl, file.parentFolderName, file.hasContent ? 1 : 0, file.contentLength || 0, file.contentText);
}

export function upsertDriveFtsEntry(driveFileId, tenantId, name, contentText) {
  // Delete existing entry then re-insert (FTS5 doesn't support UPSERT)
  try {
    db.prepare('DELETE FROM drive_fts WHERE drive_file_id = ?').run(driveFileId);
  } catch (e) { /* may not exist */ }
  if (contentText) {
    db.prepare('INSERT INTO drive_fts (drive_file_id, tenant_id, name, content_text) VALUES (?, ?, ?, ?)').run(driveFileId, tenantId, name, contentText);
  }
}

export function searchDriveContents(tenantId, query, limit = 10) {
  // Sanitize query for FTS5
  const safeQuery = query.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(w => w.length > 2).join(' ');
  if (!safeQuery) return [];

  try {
    return db.prepare(`
      SELECT df.name, df.drive_url, df.category,
             snippet(drive_fts, 3, '>>>', '<<<', '...', 100) as snippet,
             SUBSTR(df.content_text, 1, 3000) as content_excerpt
      FROM drive_fts fts
      JOIN drive_synced_files df ON df.id = fts.drive_file_id
      WHERE drive_fts MATCH ?
        AND fts.tenant_id = ?
      ORDER BY rank
      LIMIT ?
    `).all(safeQuery, tenantId, limit);
  } catch (e) {
    return [];
  }
}

export function getDriveSyncedFiles(tenantId, { search, limit = 200 } = {}) {
  let sql = 'SELECT id, name, mime_type, category, file_type, size_bytes, modified_time, drive_url, parent_folder_name, has_content, content_length, last_synced_at FROM drive_synced_files WHERE tenant_id = ?';
  const params = [tenantId];
  if (search) {
    sql += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }
  sql += ' ORDER BY modified_time DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function getDriveSyncedFileCount(tenantId) {
  return db.prepare('SELECT COUNT(*) as count FROM drive_synced_files WHERE tenant_id = ?').get(tenantId)?.count || 0;
}

export function getRecentApiLogs(limit = 20) {
  const sql = `
    SELECT
      tenant_id,
      content,
      json_extract(metadata_json, '$.model') as model,
      json_extract(metadata_json, '$.input_tokens') as input_tokens,
      json_extract(metadata_json, '$.output_tokens') as output_tokens,
      created_at
    FROM chat_messages
    WHERE role = 'assistant' AND metadata_json IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ?
  `;
  return db.prepare(sql).all(limit);
}

export function getPaginatedApiLogs({ limit = 25, offset = 0, tenantId, model, search } = {}) {
  let where = "role = 'assistant' AND metadata_json IS NOT NULL";
  const params = [];

  if (tenantId) {
    where += ' AND tenant_id = ?';
    params.push(tenantId);
  }
  if (model) {
    where += " AND json_extract(metadata_json, '$.model') LIKE ?";
    params.push(`%${model}%`);
  }
  if (search) {
    where += ' AND content LIKE ?';
    params.push(`%${search}%`);
  }

  const countSql = `SELECT COUNT(*) as total FROM chat_messages WHERE ${where}`;
  const total = db.prepare(countSql).get(...params).total;

  const dataSql = `
    SELECT
      tenant_id, agent_id, user_id, content,
      json_extract(metadata_json, '$.model') as model,
      json_extract(metadata_json, '$.input_tokens') as input_tokens,
      json_extract(metadata_json, '$.output_tokens') as output_tokens,
      metadata_json,
      created_at
    FROM chat_messages
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  const rows = db.prepare(dataSql).all(...params, limit, offset);

  return { rows, total };
}

export function getUsageByDayByModel(startDate, endDate) {
  const sql = `
    SELECT
      date(created_at) as day,
      json_extract(metadata_json, '$.model') as model,
      COUNT(*) as requests,
      SUM(json_extract(metadata_json, '$.input_tokens')) as input_tokens,
      SUM(json_extract(metadata_json, '$.output_tokens')) as output_tokens
    FROM chat_messages
    WHERE role = 'assistant' AND metadata_json IS NOT NULL
      AND created_at >= ? AND created_at <= ?
    GROUP BY date(created_at), model
    ORDER BY day
  `;
  return db.prepare(sql).all(startDate, endDate);
}

// ─── Background Jobs + Key Vault ────────────────────────────────────────────

function initBackgroundJobsTables(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      agent_id TEXT DEFAULT 'hivemind',
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      progress_pct INTEGER DEFAULT 0,
      progress_message TEXT,
      result_json TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_bg_jobs_tenant ON background_jobs(tenant_id, status)'); } catch (e) {}

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS job_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES background_jobs(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'info',
      request_type TEXT,
      response TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_job_messages_job ON job_messages(job_id)'); } catch (e) {}

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS key_vault (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      service TEXT NOT NULL,
      key_name TEXT NOT NULL,
      key_value TEXT NOT NULL,
      added_by TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT
    )
  `);
  try { targetDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_key_vault_tenant_service ON key_vault(tenant_id, service, key_name)'); } catch (e) {}
}

// Background Jobs CRUD

export function createBackgroundJob(job) {
  const id = job.id || `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO background_jobs (id, tenant_id, user_id, agent_id, title, description, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(id, job.tenantId, job.userId, job.agentId || 'hivemind', job.title, job.description || null);
  return id;
}

export function getBackgroundJobs(tenantId, status = null) {
  let sql = 'SELECT * FROM background_jobs WHERE tenant_id = ?';
  const params = [tenantId];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params);
}

export function getBackgroundJob(id) {
  return db.prepare('SELECT * FROM background_jobs WHERE id = ?').get(id);
}

export function updateBackgroundJob(id, updates) {
  const sets = ["updated_at = datetime('now')"];
  const params = [];
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.progressPct !== undefined) { sets.push('progress_pct = ?'); params.push(updates.progressPct); }
  if (updates.progressMessage !== undefined) { sets.push('progress_message = ?'); params.push(updates.progressMessage); }
  if (updates.resultJson !== undefined) { sets.push('result_json = ?'); params.push(JSON.stringify(updates.resultJson)); }
  if (updates.errorMessage !== undefined) { sets.push('error_message = ?'); params.push(updates.errorMessage); }
  if (updates.status === 'completed' || updates.status === 'failed') { sets.push("completed_at = datetime('now')"); }
  params.push(id);
  return db.prepare(`UPDATE background_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// Job Messages CRUD

export function addJobMessage(jobId, role, content, messageType = 'info', requestType = null) {
  return db.prepare(`
    INSERT INTO job_messages (job_id, role, content, message_type, request_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(jobId, role, content, messageType, requestType);
}

export function getJobMessages(jobId) {
  return db.prepare('SELECT * FROM job_messages WHERE job_id = ? ORDER BY created_at').all(jobId);
}

export function respondToJobMessage(messageId, response) {
  return db.prepare('UPDATE job_messages SET response = ? WHERE id = ?').run(response, messageId);
}

export function getPendingJobRequests(tenantId) {
  return db.prepare(`
    SELECT jm.*, bj.title as job_title, bj.id as job_id
    FROM job_messages jm
    JOIN background_jobs bj ON bj.id = jm.job_id
    WHERE bj.tenant_id = ? AND jm.message_type = 'request' AND jm.response IS NULL
    ORDER BY jm.created_at DESC
  `).all(tenantId);
}

// Agent Memory CRUD - per-tenant persistent memory for CLI agent

export function getAgentMemory(tenantId) {
  return db.prepare('SELECT key, value, updated_at FROM agent_memory WHERE tenant_id = ? ORDER BY updated_at DESC').all(tenantId);
}

export function getAgentMemoryValue(tenantId, key) {
  const row = db.prepare('SELECT value FROM agent_memory WHERE tenant_id = ? AND key = ?').get(tenantId, key);
  return row?.value || null;
}

export function setAgentMemory(tenantId, key, value) {
  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO agent_memory (id, tenant_id, key, value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(id, tenantId, key, value);
}

export function deleteAgentMemory(tenantId, key) {
  db.prepare('DELETE FROM agent_memory WHERE tenant_id = ? AND key = ?').run(tenantId, key);
}

// Key Vault CRUD - values encrypted at rest with AES-256-GCM

// Derive encryption key from env secret (lazy - dotenv may not have loaded yet at import time)
let _vaultMasterKey = null;
function getVaultMasterKey() {
  if (_vaultMasterKey) return _vaultMasterKey;
  const envKey = process.env.VAULT_ENCRYPTION_KEY;
  if (envKey) {
    _vaultMasterKey = scryptSync(envKey, 'coppice-vault-salt', 32);
    return _vaultMasterKey;
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: VAULT_ENCRYPTION_KEY not set in production. Key vault will be inaccessible.');
  }
  console.warn('[KeyVault] VAULT_ENCRYPTION_KEY not set - using dev-only fallback');
  _vaultMasterKey = scryptSync('dev-only-insecure-key', 'coppice-vault-salt', 32);
  return _vaultMasterKey;
}

function encryptValue(plaintext) {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', getVaultMasterKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv:tag:ciphertext)
  return `enc:${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

function decryptValue(stored) {
  // Support plaintext values from before encryption was added
  if (!stored.startsWith('enc:')) return stored;
  const raw = Buffer.from(stored.slice(4), 'base64');
  const iv = raw.subarray(0, 16);
  const tag = raw.subarray(16, 32);
  const ciphertext = raw.subarray(32);
  const decipher = createDecipheriv('aes-256-gcm', getVaultMasterKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8');
}

export function getKeyVaultEntries(tenantId) {
  return db.prepare('SELECT id, tenant_id, service, key_name, added_by, created_at, expires_at FROM key_vault WHERE tenant_id = ? ORDER BY service').all(tenantId);
}

export function getKeyVaultValue(tenantId, service, keyName = 'default') {
  let row = db.prepare('SELECT key_value FROM key_vault WHERE tenant_id = ? AND service = ? AND key_name = ?').get(tenantId, service, keyName);
  // Fall back to tenant-specific DB if not in main DB
  if (!row?.key_value) {
    try {
      const tdb = getTenantDb(tenantId);
      row = tdb.prepare('SELECT key_value FROM key_vault WHERE service = ? AND key_name = ?').get(service, keyName);
    } catch {}
  }
  if (!row?.key_value) return null;
  try {
    return decryptValue(row.key_value);
  } catch (e) {
    console.error(`[KeyVault] Decryption failed for ${service}/${keyName}:`, e.message);
    return null;
  }
}

export function upsertKeyVaultEntry(entry) {
  const id = entry.id || `key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const encrypted = encryptValue(entry.keyValue);
  db.prepare(`
    INSERT INTO key_vault (id, tenant_id, service, key_name, key_value, added_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, service, key_name) DO UPDATE SET key_value = ?, added_by = ?, expires_at = ?
  `).run(id, entry.tenantId, entry.service, entry.keyName || 'default', encrypted, entry.addedBy || 'user', entry.expiresAt || null,
    encrypted, entry.addedBy || 'user', entry.expiresAt || null);
  return id;
}

export function deleteKeyVaultEntry(id, tenantId) {
  return db.prepare('DELETE FROM key_vault WHERE id = ? AND tenant_id = ?').run(id, tenantId);
}

// ─── Leads Sheet Shares CRUD ────────────────────────────────────────────────

export function createLeadsSheetShare(share) {
  const id = share.id || `lss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO leads_sheet_shares (id, tenant_id, from_user_id, from_user_name, to_user_id, sheet_id, sheet_title, status, notification_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, share.tenantId, share.fromUserId, share.fromUserName || null, share.toUserId, share.sheetId, share.sheetTitle || null, share.status || 'pending', share.notificationId || null);
  return id;
}

export function getLeadsSheetShares(tenantId, userId) {
  return db.prepare('SELECT * FROM leads_sheet_shares WHERE tenant_id = ? AND to_user_id = ? ORDER BY created_at DESC').all(tenantId, userId);
}

export function updateLeadsShareStatus(id, tenantId, status) {
  return db.prepare('UPDATE leads_sheet_shares SET status = ? WHERE id = ? AND tenant_id = ?').run(status, id, tenantId);
}

export function getLeadsShareById(id, tenantId) {
  return db.prepare('SELECT * FROM leads_sheet_shares WHERE id = ? AND tenant_id = ?').get(id, tenantId);
}

// ─── Opus Rate Limiting ─────────────────────────────────────────────────────

function initOpusLimitsTable(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS api_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      limit_type TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  targetDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_api_limits_tenant_type_date ON api_limits(tenant_id, limit_type, date)`);
}

export function checkOpusLimit(tenantId) {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(
    "SELECT count FROM api_limits WHERE tenant_id = ? AND limit_type = 'opus_report' AND date = ?"
  ).get(tenantId, today);
  const count = row?.count || 0;

  // Read per-tenant limit from limits_json
  const tenant = db.prepare('SELECT limits_json FROM tenants WHERE id = ?').get(tenantId);
  const limits = tenant?.limits_json ? JSON.parse(tenant.limits_json) : {};
  const limit = limits.maxOpusReportsPerDay ?? 1;

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  return { allowed: count < limit, count, limit, resetsAt: tomorrow.toISOString() };
}

export function incrementOpusUsage(tenantId) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO api_limits (tenant_id, limit_type, date, count)
    VALUES (?, 'opus_report', ?, 1)
    ON CONFLICT(tenant_id, limit_type, date) DO UPDATE SET count = count + 1
  `).run(tenantId, today);
}

export function getOpusUsageForMonth(tenantId, yearMonth) {
  const row = db.prepare(
    "SELECT COALESCE(SUM(count), 0) as total FROM api_limits WHERE tenant_id = ? AND limit_type = 'opus_report' AND date LIKE ?"
  ).get(tenantId, `${yearMonth}%`);
  return row?.total || 0;
}

export function getOpusUsageAllTenants(yearMonth) {
  return db.prepare(`
    SELECT a.tenant_id, t.name as tenant_name, COALESCE(SUM(a.count), 0) as monthly_count
    FROM api_limits a
    LEFT JOIN tenants t ON t.id = a.tenant_id
    WHERE a.limit_type = 'opus_report' AND a.date LIKE ?
    GROUP BY a.tenant_id
    ORDER BY monthly_count DESC
  `).all(`${yearMonth}%`);
}

export function getOpusDailyCount(tenantId) {
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(
    "SELECT count FROM api_limits WHERE tenant_id = ? AND limit_type = 'opus_report' AND date = ?"
  ).get(tenantId, today);
  return row?.count || 0;
}

// ─── Activity Log ────────────────────────────────────────────────────────────

function initActivityLogTableSchema(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS tenant_email_config (
      tenant_id TEXT PRIMARY KEY,
      sender_email TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      gmail_refresh_token TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add token_last_authed_at column (migration - safe to re-run)
  try { targetDb.exec('ALTER TABLE tenant_email_config ADD COLUMN token_last_authed_at DATETIME'); } catch (e) { /* column already exists */ }

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      subtitle TEXT,
      detail_json TEXT,
      source_type TEXT,
      source_id TEXT,
      agent_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_activity_tenant ON activity_log(tenant_id, created_at DESC)'); } catch (e) {}
}

function initActivityLogSeedData(targetDb, tenantId) {
  if (tenantId !== SANGHA_TENANT_ID) return;

  const count = targetDb.prepare('SELECT COUNT(*) as c FROM activity_log').get();
  if (count.c === 0) {
    const insert = targetDb.prepare('INSERT INTO activity_log (tenant_id, type, title, subtitle, detail_json, source_type, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const now = Date.now();
    const ts = (minAgo) => new Date(now - minAgo * 60000).toISOString().replace('T', ' ').slice(0, 19);
    const S = SANGHA_TENANT_ID;

    insert.run(S, 'out', 'Outreach sent to James Torres, VP Ops at SunPeak Energy', 'Personalized re: ERCOT curtailment patterns on their Crane County site', JSON.stringify({ to: 'jtorres@sunpeak.com', subject: 'ERCOT curtailment optimization for Crane County', body: 'Hi James,\n\nI noticed SunPeak\'s Crane County site has been seeing significant curtailment during afternoon price spikes. We\'ve helped similar operators capture $1,200+ per curtailment event through our automated response system.\n\nWould you have 15 minutes this week to discuss how this could work for your fleet?\n\nBest,\nCoppice' }), 'email', 'lead-engine', ts(2));
    insert.run(S, 'meet', 'Transcribed: Reassurity Product Strategy Call', '42 min \u2014 6 attendees \u2014 4 action items extracted', JSON.stringify({ summary: 'Discussed insurance product structure for behind-the-meter mining operations. Agreed on parametric trigger design using ERCOT price data. Next steps: finalize term sheet, schedule actuarial review.', actionItems: ['Finalize term sheet draft by Friday', 'Schedule actuarial review with Munich Re', 'Send updated loss model to Adam', 'Prepare board presentation for March 20'], attendees: ['Spencer Marr', 'Adam Reeve', 'Teo Blind', 'Miguel Alvarez', 'Sarah Chen', 'Jason Gunderson'] }), 'meeting', 'knowledge', ts(60));
    insert.run(S, 'lead', '12 new leads discovered \u2014 PJM region', 'Solar IPPs with merchant exposure, 50 MW+ capacity', JSON.stringify({ leads: [{ company: 'Apex Clean Energy', location: 'Virginia', score: 82 }, { company: 'Clearway Energy', location: 'New Jersey', score: 78 }, { company: 'NextEra Energy Partners', location: 'Pennsylvania', score: 75 }] }), 'lead_engine', 'lead-engine', ts(180));
    insert.run(S, 'in', 'Reply received: Sarah Chen, CFO at Meridian Renewables', 'Re: Behind-the-meter mining conversation', JSON.stringify({ from: 'sarah.chen@meridian-renewables.com', subject: 'Re: Behind-the-meter mining conversation', body: 'Hi,\n\nThanks for reaching out. We\'ve actually been exploring this exact concept for our West Texas sites. Would love to connect - how does Thursday at 2pm CT work?\n\nBest,\nSarah' }), 'email', 'coppice', ts(300));
    insert.run(S, 'doc', 'Ingested: Oberon Deal Memo v3', 'deal_memo \u2014 Revised energy pricing assumptions and site economics for Oberon Solar project', JSON.stringify({ summary: 'Updated deal memo incorporating revised PPA pricing at $0.042/kWh, new interconnection timeline (Q3 2026), and updated IRR projections showing 18.2% levered returns.', type: 'deal_memo', source: 'drive' }), 'knowledge', 'knowledge', ts(360));
    insert.run(S, 'out', 'Follow-up drafted for Mark Liu at GridScale Partners', 'Awaiting approval \u2014 5 days since last contact', JSON.stringify({ to: 'mliu@gridscale.com', subject: 'Re: Mining infrastructure partnership', body: 'Hi Mark,\n\nJust following up on our conversation last week about co-locating mining infrastructure at your solar sites. Happy to share the economics model we discussed.\n\nLet me know if you\'d like to reconnect.\n\nBest,\nCoppice' }), 'email', 'lead-engine', ts(420));

    console.log('Activity log: seeded 6 demo activities');
  }
}

// Activity insert hook - notifies listeners (e.g. office WebSocket broadcast)
let _activityHook = null;
export function onActivityInsert(hook) { _activityHook = hook; }

export function insertActivity({ tenantId, type, title, subtitle, detailJson, sourceType, sourceId, agentId }) {
  // Deduplicate by source_id if provided
  if (sourceId) {
    const existing = db.prepare('SELECT id FROM activity_log WHERE source_id = ? LIMIT 1').get(sourceId);
    if (existing) return existing.id;
  }
  const result = db.prepare(
    'INSERT INTO activity_log (tenant_id, type, title, subtitle, detail_json, source_type, source_id, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(tenantId, type, title, subtitle || null, detailJson || null, sourceType || null, sourceId || null, agentId || null);
  const id = result.lastInsertRowid;
  // Notify office visualization
  if (_activityHook) {
    try { _activityHook({ id, tenantId, type, title, subtitle, agentId }); } catch {}
  }
  return id;
}

export function getActivities(tenantId, { limit = 20, offset = 0, type, sourceType } = {}) {
  let sql = 'SELECT id, type, title, subtitle, source_type, agent_id, created_at, CASE WHEN detail_json IS NOT NULL THEN 1 ELSE 0 END as has_detail FROM activity_log WHERE tenant_id = ?';
  const params = [tenantId];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (sourceType) { sql += ' AND source_type = ?'; params.push(sourceType); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

export function getActivityDetail(id) {
  return db.prepare('SELECT * FROM activity_log WHERE id = ?').get(id);
}

export function getActivityCount(tenantId, type) {
  if (type) {
    return db.prepare('SELECT COUNT(*) as c FROM activity_log WHERE tenant_id = ? AND type = ?').get(tenantId, type).c;
  }
  return db.prepare('SELECT COUNT(*) as c FROM activity_log WHERE tenant_id = ?').get(tenantId).c;
}

// ─── Processed Emails (Persistent Dedup) ─────────────────────────────────────

function initProcessedEmailsTable(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS processed_emails (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT,
      pipeline TEXT,
      tenant_id TEXT,
      processed_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_processed_thread ON processed_emails(thread_id)'); } catch (e) {}
}

export function isEmailProcessed(messageId) {
  const row = db.prepare('SELECT 1 FROM processed_emails WHERE message_id = ? LIMIT 1').get(messageId);
  return !!row;
}

export function isThreadProcessed(threadId) {
  if (!threadId) return false;
  const row = db.prepare('SELECT message_id, pipeline, tenant_id FROM processed_emails WHERE thread_id = ? LIMIT 1').get(threadId);
  return row || null;
}

export function markEmailProcessed({ messageId, threadId, pipeline, tenantId }) {
  db.prepare(
    'INSERT OR IGNORE INTO processed_emails (message_id, thread_id, pipeline, tenant_id) VALUES (?, ?, ?, ?)'
  ).run(messageId, threadId || null, pipeline || null, tenantId || null);
}

/**
 * Get the retry count for a message from processed_emails.
 * Looks for pipeline values like 'retry-1', 'retry-2', etc.
 * Returns 0 if the message has never been attempted.
 */
export function getEmailRetryCount(messageId) {
  const row = db.prepare('SELECT pipeline FROM processed_emails WHERE message_id = ? LIMIT 1').get(messageId);
  if (!row || !row.pipeline) return 0;
  const match = row.pipeline.match(/^retry-(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Mark a message as needing retry (pipeline = 'retry-N').
 * Uses INSERT OR REPLACE so it updates the pipeline if the row exists.
 */
export function markEmailRetry({ messageId, threadId, retryCount, tenantId }) {
  db.prepare(
    'INSERT OR REPLACE INTO processed_emails (message_id, thread_id, pipeline, tenant_id, processed_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
  ).run(messageId, threadId || null, `retry-${retryCount}`, tenantId || null);
}

/**
 * Check if a message is permanently processed (not in a retry state).
 * Returns true only for messages that are fully processed (not retry-N).
 */
export function isEmailPermanentlyProcessed(messageId) {
  const row = db.prepare('SELECT pipeline FROM processed_emails WHERE message_id = ? LIMIT 1').get(messageId);
  if (!row) return false;
  // retry-N entries are NOT permanently processed - they should be retried
  if (row.pipeline && /^retry-\d+$/.test(row.pipeline)) return false;
  return true;
}

// ─── Auto Replies ────────────────────────────────────────────────────────────

function initAutoRepliesTable(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS auto_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      subject TEXT,
      response_preview TEXT,
      sent_at TEXT DEFAULT (datetime('now')),
      tenant_id TEXT
    )
  `);
}

export function logAutoReply({ messageId, sender, subject, responsePreview, tenantId }) {
  try {
    db.prepare(
      'INSERT INTO auto_replies (message_id, sender, subject, response_preview, tenant_id) VALUES (?, ?, ?, ?, ?)'
    ).run(messageId, sender, subject || '', (responsePreview || '').slice(0, 500), tenantId || null);
  } catch (e) {
    console.error('[DB] Failed to log auto-reply:', e.message);
  }
}

/**
 * Count auto-replies sent to a specific sender within a time window.
 * Used for conversation rate limiting (day/week/month caps).
 */
export function countAutoReplies(tenantId, senderEmail, sinceDatetime) {
  try {
    const row = db.prepare(
      'SELECT COUNT(*) as c FROM auto_replies WHERE tenant_id = ? AND LOWER(sender) LIKE ? AND sent_at >= ?'
    ).get(tenantId || null, `%${senderEmail.toLowerCase()}%`, sinceDatetime);
    return row?.c || 0;
  } catch (e) {
    return 0;
  }
}

// ─── Tenant Email Config ─────────────────────────────────────────────────────

export function getTenantEmailConfig(tenantId) {
  // Check main DB first, then fall back to tenant-specific DB
  let row = db.prepare('SELECT * FROM tenant_email_config WHERE tenant_id = ?').get(tenantId);
  if (!row) {
    try {
      const tdb = getTenantDb(tenantId);
      row = tdb.prepare('SELECT * FROM tenant_email_config WHERE tenant_id = ?').get(tenantId);
    } catch {}
  }
  if (!row) return null;
  return {
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    gmailRefreshToken: row.gmail_refresh_token,
    tokenLastAuthedAt: row.token_last_authed_at,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

export function getAllTenantEmailConfigs() {
  const configs = new Map();
  // Main DB
  const rows = db.prepare('SELECT * FROM tenant_email_config').all();
  for (const row of rows) {
    configs.set(row.sender_email, {
      tenantId: row.tenant_id,
      senderEmail: row.sender_email,
      senderName: row.sender_name,
      gmailRefreshToken: row.gmail_refresh_token,
    });
  }
  // Also check each tenant DB for configs not in main DB
  const tenants = db.prepare('SELECT id FROM tenants').all();
  for (const t of tenants) {
    try {
      const tdb = getTenantDb(t.id);
      const tRows = tdb.prepare('SELECT * FROM tenant_email_config').all();
      for (const row of tRows) {
        if (!configs.has(row.sender_email)) {
          configs.set(row.sender_email, {
            tenantId: row.tenant_id,
            senderEmail: row.sender_email,
            senderName: row.sender_name,
            gmailRefreshToken: row.gmail_refresh_token,
          });
        }
      }
    } catch {}
  }
  return Array.from(configs.values());
}

export function setTenantEmailConfig(tenantId, { senderEmail, senderName, gmailRefreshToken }) {
  db.prepare(`
    INSERT INTO tenant_email_config (tenant_id, sender_email, sender_name, gmail_refresh_token, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id) DO UPDATE SET
      sender_email = excluded.sender_email,
      sender_name = excluded.sender_name,
      gmail_refresh_token = excluded.gmail_refresh_token,
      updated_at = datetime('now')
  `).run(tenantId, senderEmail, senderName, gmailRefreshToken);
}

/**
 * Update only the refresh token and mark token_last_authed_at.
 * Used by the re-auth flow - doesn't touch sender_email/sender_name.
 */
export function updateTenantEmailToken(tenantId, gmailRefreshToken) {
  db.prepare(`
    UPDATE tenant_email_config
    SET gmail_refresh_token = ?, token_last_authed_at = datetime('now'), updated_at = datetime('now')
    WHERE tenant_id = ?
  `).run(gmailRefreshToken, tenantId);
}

// ─── Email Trust & Anti-Spoofing ─────────────────────────────────────────────

function initEmailTrustTables(targetDb) {
  // Trusted senders: verified email/domain pairs per tenant
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS email_trusted_senders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      email TEXT,
      domain TEXT,
      display_name TEXT,
      trust_level TEXT NOT NULL DEFAULT 'trusted',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_email ON email_trusted_senders(tenant_id, email) WHERE email IS NOT NULL'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_trusted_domain ON email_trusted_senders(tenant_id, domain) WHERE domain IS NOT NULL'); } catch (e) {}

  // Email security log: tracks blocked/flagged emails
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS email_security_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      sender_name TEXT,
      subject TEXT,
      verdict TEXT NOT NULL,
      reason TEXT,
      auth_results TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_security_log_tenant ON email_security_log(tenant_id, created_at DESC)'); } catch (e) {}
}

export function getTrustedSenders(tenantId) {
  const tdb = getTenantDb(tenantId);
  return tdb.prepare('SELECT * FROM email_trusted_senders WHERE tenant_id = ? ORDER BY display_name').all(tenantId);
}

export function getTrustedSenderByEmail(tenantId, email) {
  const tdb = getTenantDb(tenantId);
  return tdb.prepare('SELECT * FROM email_trusted_senders WHERE tenant_id = ? AND LOWER(email) = LOWER(?)').get(tenantId, email) || null;
}

export function getTrustedSenderByDomain(tenantId, domain) {
  const tdb = getTenantDb(tenantId);
  return tdb.prepare('SELECT * FROM email_trusted_senders WHERE tenant_id = ? AND LOWER(domain) = LOWER(?) LIMIT 1').get(tenantId, domain) || null;
}

export function addTrustedSender({ tenantId, email, domain, displayName, trustLevel, notes }) {
  return db.prepare(`
    INSERT INTO email_trusted_senders (tenant_id, email, domain, display_name, trust_level, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tenantId, email || null, domain || null, displayName || null, trustLevel || 'trusted', notes || null);
}

export function removeTrustedSender(id) {
  return db.prepare('DELETE FROM email_trusted_senders WHERE id = ?').run(id);
}

export function logEmailSecurity({ tenantId, messageId, senderEmail, senderName, subject, verdict, reason, authResults }) {
  try {
    db.prepare(`
      INSERT INTO email_security_log (tenant_id, message_id, sender_email, sender_name, subject, verdict, reason, auth_results)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, messageId, senderEmail, senderName || null, subject || null, verdict, reason || null, authResults || null);
  } catch (e) {
    console.error('[DB] Failed to log email security event:', e.message);
  }
}

export function getEmailSecurityLog(tenantId, { limit = 50, offset = 0 } = {}) {
  return db.prepare(
    'SELECT * FROM email_security_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(tenantId, limit, offset);
}

// ─── Accounting Tables ──────────────────────────────────────────────────────

function initAccountingTables(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS accounting_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      source TEXT NOT NULL,
      customer_name TEXT,
      invoice_number TEXT,
      amount REAL DEFAULT 0,
      balance_due REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      due_date TEXT,
      detail_json TEXT,
      estimate_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, source, external_id)
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_acct_inv_tenant ON accounting_invoices(tenant_id, status)'); } catch (e) {}

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS accounting_bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      source TEXT NOT NULL,
      vendor_name TEXT,
      bill_number TEXT,
      amount REAL DEFAULT 0,
      balance_due REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      due_date TEXT,
      detail_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, source, external_id)
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_acct_bill_tenant ON accounting_bills(tenant_id, status)'); } catch (e) {}

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS accounting_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      source TEXT NOT NULL,
      type TEXT DEFAULT 'received',
      amount REAL DEFAULT 0,
      payment_date TEXT,
      customer_or_vendor TEXT,
      detail_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, source, external_id)
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_acct_pmt_tenant ON accounting_payments(tenant_id, type)'); } catch (e) {}
}

// Accounting CRUD

export function upsertAccountingInvoice(tenantId, inv) {
  db.prepare(`
    INSERT INTO accounting_invoices (tenant_id, external_id, source, customer_name, invoice_number, amount, balance_due, status, due_date, detail_json, estimate_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id, source, external_id) DO UPDATE SET
      customer_name = excluded.customer_name,
      invoice_number = excluded.invoice_number,
      amount = excluded.amount,
      balance_due = excluded.balance_due,
      status = excluded.status,
      due_date = excluded.due_date,
      detail_json = excluded.detail_json,
      estimate_id = excluded.estimate_id,
      updated_at = datetime('now')
  `).run(tenantId, inv.externalId, inv.source, inv.customerName, inv.invoiceNumber,
    inv.amount, inv.balanceDue, inv.status, inv.dueDate, inv.detailJson, inv.estimateId || null);
}

export function getAccountingInvoices(tenantId, { status, source, limit = 100, offset = 0 } = {}) {
  let sql = 'SELECT * FROM accounting_invoices WHERE tenant_id = ?';
  const params = [tenantId];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (source) { sql += ' AND source = ?'; params.push(source); }
  sql += ' ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

export function upsertAccountingBill(tenantId, bill) {
  db.prepare(`
    INSERT INTO accounting_bills (tenant_id, external_id, source, vendor_name, bill_number, amount, balance_due, status, due_date, detail_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id, source, external_id) DO UPDATE SET
      vendor_name = excluded.vendor_name,
      bill_number = excluded.bill_number,
      amount = excluded.amount,
      balance_due = excluded.balance_due,
      status = excluded.status,
      due_date = excluded.due_date,
      detail_json = excluded.detail_json,
      updated_at = datetime('now')
  `).run(tenantId, bill.externalId, bill.source, bill.vendorName, bill.billNumber,
    bill.amount, bill.balanceDue, bill.status, bill.dueDate, bill.detailJson);
}

export function getAccountingBills(tenantId, { status, source, limit = 100, offset = 0 } = {}) {
  let sql = 'SELECT * FROM accounting_bills WHERE tenant_id = ?';
  const params = [tenantId];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (source) { sql += ' AND source = ?'; params.push(source); }
  sql += ' ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

export function upsertAccountingPayment(tenantId, pmt) {
  db.prepare(`
    INSERT INTO accounting_payments (tenant_id, external_id, source, type, amount, payment_date, customer_or_vendor, detail_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id, source, external_id) DO UPDATE SET
      type = excluded.type,
      amount = excluded.amount,
      payment_date = excluded.payment_date,
      customer_or_vendor = excluded.customer_or_vendor,
      detail_json = excluded.detail_json,
      updated_at = datetime('now')
  `).run(tenantId, pmt.externalId, pmt.source, pmt.type, pmt.amount,
    pmt.paymentDate, pmt.customerOrVendor, pmt.detailJson);
}

export function getAccountingPayments(tenantId, { type, source, limit = 100, offset = 0 } = {}) {
  let sql = 'SELECT * FROM accounting_payments WHERE tenant_id = ?';
  const params = [tenantId];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (source) { sql += ' AND source = ?'; params.push(source); }
  sql += ' ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.prepare(sql).all(...params);
}

export function getAccountingStats(tenantId) {
  const invoices = db.prepare('SELECT COUNT(*) as total, SUM(amount) as totalAmount, SUM(balance_due) as totalDue FROM accounting_invoices WHERE tenant_id = ?').get(tenantId);
  const overdue = db.prepare("SELECT COUNT(*) as count, SUM(balance_due) as amount FROM accounting_invoices WHERE tenant_id = ? AND status = 'overdue'").get(tenantId);
  const bills = db.prepare('SELECT COUNT(*) as total, SUM(amount) as totalAmount, SUM(balance_due) as totalDue FROM accounting_bills WHERE tenant_id = ?').get(tenantId);
  const billsOverdue = db.prepare("SELECT COUNT(*) as count, SUM(balance_due) as amount FROM accounting_bills WHERE tenant_id = ? AND status = 'overdue'").get(tenantId);
  const pmtsReceived = db.prepare("SELECT COUNT(*) as count, SUM(amount) as amount FROM accounting_payments WHERE tenant_id = ? AND type = 'received'").get(tenantId);
  const pmtsSent = db.prepare("SELECT COUNT(*) as count, SUM(amount) as amount FROM accounting_payments WHERE tenant_id = ? AND type = 'sent'").get(tenantId);

  return {
    invoices: {
      total: invoices?.total || 0,
      totalAmount: invoices?.totalAmount || 0,
      totalDue: invoices?.totalDue || 0,
      overdue: overdue?.count || 0,
      overdueAmount: overdue?.amount || 0,
    },
    bills: {
      total: bills?.total || 0,
      totalAmount: bills?.totalAmount || 0,
      totalDue: bills?.totalDue || 0,
      overdue: billsOverdue?.count || 0,
      overdueAmount: billsOverdue?.amount || 0,
    },
    payments: {
      received: { count: pmtsReceived?.count || 0, amount: pmtsReceived?.amount || 0 },
      sent: { count: pmtsSent?.count || 0, amount: pmtsSent?.amount || 0 },
    },
  };
}

// ─── Price Alert Rules ──────────────────────────────────────────────────────

function initPriceAlertRulesTable(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS price_alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      iso TEXT NOT NULL,
      node TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'above',
      threshold REAL NOT NULL,
      enabled INTEGER DEFAULT 1,
      cooldown_minutes INTEGER DEFAULT 30,
      last_triggered_at TEXT,
      notify_websocket INTEGER DEFAULT 1,
      notify_email INTEGER DEFAULT 0,
      trigger_curtailment INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_price_alerts_tenant ON price_alert_rules(tenant_id)'); } catch (e) {}
}

export function getPriceAlertRules() {
  return db.prepare('SELECT * FROM price_alert_rules WHERE enabled = 1').all();
}

export function getPriceAlertRulesForTenant(tenantId) {
  return db.prepare('SELECT * FROM price_alert_rules WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function createPriceAlertRule(rule) {
  const result = db.prepare(`
    INSERT INTO price_alert_rules (tenant_id, iso, node, direction, threshold, cooldown_minutes, notify_websocket, notify_email, trigger_curtailment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(rule.tenantId, rule.iso, rule.node, rule.direction, rule.threshold,
    rule.cooldownMinutes || 30, rule.notifyWebsocket ?? 1, rule.notifyEmail ?? 0, rule.triggerCurtailment ?? 0);
  return result.lastInsertRowid;
}

export function updatePriceAlertRule(id, tenantId, updates) {
  const sets = [];
  const params = [];
  if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
  if (updates.threshold !== undefined) { sets.push('threshold = ?'); params.push(updates.threshold); }
  if (updates.direction !== undefined) { sets.push('direction = ?'); params.push(updates.direction); }
  if (updates.cooldownMinutes !== undefined) { sets.push('cooldown_minutes = ?'); params.push(updates.cooldownMinutes); }
  if (updates.notifyWebsocket !== undefined) { sets.push('notify_websocket = ?'); params.push(updates.notifyWebsocket ? 1 : 0); }
  if (updates.notifyEmail !== undefined) { sets.push('notify_email = ?'); params.push(updates.notifyEmail ? 1 : 0); }
  if (updates.triggerCurtailment !== undefined) { sets.push('trigger_curtailment = ?'); params.push(updates.triggerCurtailment ? 1 : 0); }
  if (sets.length === 0) return;
  params.push(id, tenantId);
  db.prepare(`UPDATE price_alert_rules SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
}

export function deletePriceAlertRule(id, tenantId) {
  db.prepare('DELETE FROM price_alert_rules WHERE id = ? AND tenant_id = ?').run(id, tenantId);
}

export function updateAlertRuleLastTriggered(id) {
  db.prepare("UPDATE price_alert_rules SET last_triggered_at = datetime('now') WHERE id = ?").run(id);
}

// ─── Portfolio Companies Helpers ──────────────────────────────────────────────

export function getPortfolioCompanies(tenantId) {
  return db.prepare('SELECT * FROM portfolio_companies WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function getPortfolioCompany(id, tenantId) {
  return db.prepare('SELECT * FROM portfolio_companies WHERE id = ? AND tenant_id = ?').get(id, tenantId);
}

export function createPortfolioCompany({ id, name, type, status, description, tenantId }) {
  return db.prepare(`
    INSERT INTO portfolio_companies (id, name, type, status, description, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, type || null, status || 'active', description || null, tenantId);
}

export function updatePortfolioCompany(id, updates, tenantId) {
  const sets = [];
  const params = [];
  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.type !== undefined) { sets.push('type = ?'); params.push(updates.type); }
  if (updates.status !== undefined) { sets.push('status = ?'); params.push(updates.status); }
  if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description); }
  if (sets.length === 0) return;
  params.push(id, tenantId);
  return db.prepare(`UPDATE portfolio_companies SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
}

export function getCompanyEmailAccounts(companyId, tenantId) {
  return db.prepare('SELECT * FROM company_email_accounts WHERE company_id = ? AND tenant_id = ? ORDER BY connected_at DESC').all(companyId, tenantId);
}

export function addCompanyEmailAccount({ id, companyId, gmailAddress, oauthRefreshToken, tenantId }) {
  return db.prepare(`
    INSERT INTO company_email_accounts (id, company_id, gmail_address, oauth_refresh_token, tenant_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, companyId, gmailAddress, oauthRefreshToken || null, tenantId);
}

export function updateCompanyEmailAccountToken(id, refreshToken, tenantId) {
  return db.prepare(`
    UPDATE company_email_accounts SET oauth_refresh_token = ?, connected_at = datetime('now') WHERE id = ? AND tenant_id = ?
  `).run(refreshToken, id, tenantId);
}

export function getCompanyDriveFolders(companyId, tenantId) {
  return db.prepare('SELECT * FROM company_drive_folders WHERE company_id = ? AND tenant_id = ? ORDER BY connected_at DESC').all(companyId, tenantId);
}

export function addCompanyDriveFolder({ id, companyId, folderId, folderName, folderUrl, tenantId }) {
  return db.prepare(`
    INSERT INTO company_drive_folders (id, company_id, folder_id, folder_name, folder_url, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, companyId, folderId, folderName || null, folderUrl || null, tenantId);
}

export function upsertCompanyEmailStats({ companyId, date, sentCount, receivedCount, draftCount, tenantId }) {
  return db.prepare(`
    INSERT INTO company_email_stats (company_id, date, sent_count, received_count, draft_count, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, date) DO UPDATE SET
      sent_count = excluded.sent_count,
      received_count = excluded.received_count,
      draft_count = excluded.draft_count
  `).run(companyId, date, sentCount || 0, receivedCount || 0, draftCount || 0, tenantId);
}

export function getCompanyEmailStats(companyId, tenantId, days = 30) {
  return db.prepare(`
    SELECT * FROM company_email_stats
    WHERE company_id = ? AND tenant_id = ? AND date >= date('now', '-' || ? || ' days')
    ORDER BY date DESC
  `).all(companyId, tenantId, days);
}

// ─── Scheduled Task CRUD ─────────────────────────────────────────────────────

export function createScheduledTask(task) {
  const id = task.id || `sched_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO scheduled_tasks (id, tenant_id, user_id, agent_id, title, prompt, cron_expression, timezone, enabled, next_run_at, max_runs, thread_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    task.tenant_id,
    task.user_id,
    task.agent_id || 'hivemind',
    task.title,
    task.prompt,
    task.cron_expression,
    task.timezone || 'America/Chicago',
    task.enabled !== undefined ? (task.enabled ? 1 : 0) : 1,
    task.next_run_at || null,
    task.max_runs || null,
    task.thread_id || null,
  );
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
}

export function getScheduledTasks(tenantId) {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function getScheduledTask(id) {
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
}

export function updateScheduledTask(id, updates) {
  const allowedFields = ['title', 'prompt', 'cron_expression', 'timezone', 'enabled', 'last_run_at', 'next_run_at', 'run_count', 'max_runs', 'thread_id', 'agent_id'];
  const setClauses = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (setClauses.length === 0) return null;
  setClauses.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE scheduled_tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
  return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
}

export function deleteScheduledTask(id, tenantId) {
  return db.prepare('DELETE FROM scheduled_tasks WHERE id = ? AND tenant_id = ?').run(id, tenantId);
}

export function getDueScheduledTasks() {
  return db.prepare(`
    SELECT * FROM scheduled_tasks
    WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= datetime('now')
  `).all();
}

// ─── Agent Assignments CRUD ───────────────────────────────────────────────

export function getAgentAssignments(tenantId, status = null, userId = null) {
  const excludeArchived = "AND status != 'archived'";
  const orderBy = "ORDER BY CASE status WHEN 'proposed' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'in_progress' THEN 2 WHEN 'completed' THEN 3 WHEN 'dismissed' THEN 4 END, created_at DESC";
  if (status === 'all') status = null; // 'all' means no status filter
  if (status === 'archived') {
    // Explicit archived query - show only archived for this tenant
    return db.prepare(`SELECT * FROM agent_assignments WHERE tenant_id = ? AND status = 'archived' ORDER BY completed_at DESC, created_at DESC`).all(tenantId);
  }
  if (status && userId) {
    return db.prepare(`SELECT * FROM agent_assignments WHERE tenant_id = ? AND status = ? AND (user_id = ? OR user_id IS NULL OR visibility = 'shared') ORDER BY priority DESC, created_at DESC`).all(tenantId, status, userId);
  }
  if (status) {
    return db.prepare(`SELECT * FROM agent_assignments WHERE tenant_id = ? AND status = ? ORDER BY priority DESC, created_at DESC`).all(tenantId, status);
  }
  if (userId) {
    return db.prepare(`SELECT * FROM agent_assignments WHERE tenant_id = ? AND (user_id = ? OR user_id IS NULL OR visibility = 'shared') ${excludeArchived} ${orderBy}`).all(tenantId, userId);
  }
  return db.prepare(`SELECT * FROM agent_assignments WHERE tenant_id = ? ${excludeArchived} ${orderBy}`).all(tenantId);
}

export function getAgentAssignment(tenantId, id) {
  return db.prepare('SELECT * FROM agent_assignments WHERE id = ? AND tenant_id = ?').get(id, tenantId);
}

export function insertAgentAssignment(assignment) {
  db.prepare(`
    INSERT INTO agent_assignments (id, tenant_id, agent_id, title, description, category, priority, action_prompt, context_json, status, user_id, input_fields_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
  `).run(assignment.id, assignment.tenant_id, assignment.agent_id || 'estimating', assignment.title,
    assignment.description, assignment.category || 'general', assignment.priority || 'medium',
    assignment.action_prompt || null, assignment.context_json || null, assignment.user_id || null,
    assignment.input_fields_json || null);
}

export function updateAgentAssignment(tenantId, id, updates) {
  const allowed = ['status', 'result_summary', 'thread_id', 'confirmed_at', 'completed_at', 'title', 'description', 'action_prompt', 'output_artifacts_json', 'user_id', 'job_id', 'source_type', 'source_thread_id', 'knowledge_entry_ids_json', 'info_requests_pending', 'visibility', 'full_response', 'shared_with_json', 'attached_entity_ids_json', 'input_fields_json', 'input_values_json'];
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
  }
  if (sets.length === 0) return;
  vals.push(id, tenantId);
  db.prepare(`UPDATE agent_assignments SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...vals);
}

export function clearOldAssignments(tenantId, daysOld = 7) {
  db.prepare(`DELETE FROM agent_assignments WHERE tenant_id = ? AND status IN ('dismissed') AND created_at < datetime('now', '-' || ? || ' days')`).run(tenantId, daysOld);
  // Archived tasks cleaned after 90 days
  db.prepare(`DELETE FROM agent_assignments WHERE tenant_id = ? AND status = 'archived' AND created_at < datetime('now', '-90 days')`).run(tenantId);
}

export function clearProposedAssignments(tenantId) {
  db.prepare(`DELETE FROM agent_assignments WHERE tenant_id = ? AND status = 'proposed'`).run(tenantId);
}

export function trimProposedAssignments(tenantId, maxKeep = 50) {
  db.prepare(`
    DELETE FROM agent_assignments WHERE tenant_id = ? AND status = 'proposed' AND id NOT IN (
      SELECT id FROM agent_assignments WHERE tenant_id = ? AND status = 'proposed'
      ORDER BY created_at DESC LIMIT ?
    )
  `).run(tenantId, tenantId, maxKeep);
}

// ─── CC Thread Tracker CRUD ──────────────────────────────────────────────

export function upsertCcThreadTracker(tenantId, threadId, { subject, participant, hasAttachment }) {
  const id = `cct-${tenantId}-${threadId}`;
  const existing = db.prepare('SELECT * FROM cc_thread_tracker WHERE tenant_id = ? AND gmail_thread_id = ?').get(tenantId, threadId);
  if (existing) {
    const participants = JSON.parse(existing.participants_json || '[]');
    if (participant && !participants.includes(participant)) participants.push(participant);
    db.prepare(`
      UPDATE cc_thread_tracker SET
        observation_count = observation_count + 1,
        attachment_count = attachment_count + ?,
        participants_json = ?,
        last_observed_at = datetime('now'),
        subject = COALESCE(?, subject)
      WHERE tenant_id = ? AND gmail_thread_id = ?
    `).run(hasAttachment ? 1 : 0, JSON.stringify(participants), subject, tenantId, threadId);
    return db.prepare('SELECT * FROM cc_thread_tracker WHERE id = ?').get(id);
  }
  db.prepare(`
    INSERT INTO cc_thread_tracker (id, tenant_id, gmail_thread_id, subject, participants_json, observation_count, attachment_count)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(id, tenantId, threadId, subject || null, JSON.stringify(participant ? [participant] : []), hasAttachment ? 1 : 0);
  return db.prepare('SELECT * FROM cc_thread_tracker WHERE id = ?').get(id);
}

export function getCcThreadsReadyForTrigger(tenantId, minObservations = 3) {
  return db.prepare(`
    SELECT * FROM cc_thread_tracker
    WHERE tenant_id = ? AND status = 'accumulating'
      AND (observation_count >= ? OR (observation_count >= 1 AND attachment_count >= 2))
    ORDER BY last_observed_at DESC
  `).all(tenantId, minObservations);
}

export function markCcThreadTriggered(tenantId, threadId, assignmentId) {
  db.prepare(`
    UPDATE cc_thread_tracker SET status = 'triggered', auto_assignment_id = ?
    WHERE tenant_id = ? AND gmail_thread_id = ?
  `).run(assignmentId, tenantId, threadId);
}

export function getConfirmedAssignments(tenantId) {
  return db.prepare(`
    SELECT * FROM agent_assignments WHERE tenant_id = ? AND status = 'confirmed'
    ORDER BY created_at ASC
  `).all(tenantId);
}

export function getPausedAssignmentsWithResponses(tenantId) {
  return db.prepare(`
    SELECT aa.* FROM agent_assignments aa
    JOIN background_jobs bj ON bj.id = aa.job_id
    WHERE aa.tenant_id = ? AND aa.status = 'in_progress' AND bj.status = 'paused'
      AND EXISTS (
        SELECT 1 FROM job_messages jm
        WHERE jm.job_id = bj.id AND jm.message_type = 'request' AND jm.response IS NOT NULL
          AND jm.id = (SELECT MAX(id) FROM job_messages WHERE job_id = bj.id AND message_type = 'request')
      )
    ORDER BY aa.created_at ASC
  `).all(tenantId);
}

// ─── MCP Server CRUD ──────────────────────────────────────────────────────

export function getMcpServers(tenantId) {
  const tdb = getTenantDb(tenantId);
  return tdb.prepare('SELECT * FROM mcp_servers WHERE tenant_id = ? ORDER BY created_at DESC').all(tenantId);
}

export function getMcpServer(id, tenantId) {
  const tdb = getTenantDb(tenantId);
  return tdb.prepare('SELECT * FROM mcp_servers WHERE id = ? AND tenant_id = ?').get(id, tenantId);
}

export function createMcpServer(tenantId, { id, name, transport, command, args_json, env_json, url }) {
  const tdb = getTenantDb(tenantId);
  tdb.prepare(`
    INSERT INTO mcp_servers (id, tenant_id, name, transport, command, args_json, env_json, url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, name, transport, command || null, args_json || '[]', env_json || '{}', url || null);
  return getMcpServer(id, tenantId);
}

export function updateMcpServer(id, tenantId, updates) {
  const tdb = getTenantDb(tenantId);
  const allowed = ['name', 'transport', 'command', 'args_json', 'env_json', 'url', 'enabled'];
  const setClauses = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (setClauses.length === 0) return;
  values.push(id, tenantId);
  tdb.prepare(`UPDATE mcp_servers SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values);
}

export function deleteMcpServer(id, tenantId) {
  const tdb = getTenantDb(tenantId);
  tdb.prepare('DELETE FROM mcp_servers WHERE id = ? AND tenant_id = ?').run(id, tenantId);
}

// ─── Context Pins ──────────────────────────────────────────────────────────

export function getContextPins(tenantId, threadId) {
  return db.prepare('SELECT * FROM context_pins WHERE tenant_id = ? AND thread_id = ? ORDER BY created_at DESC').all(tenantId, threadId);
}

export function addContextPin(tenantId, threadId, pinType, refId, label, metadata = null, pinnedBy = 'user') {
  const id = `pin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO context_pins (id, tenant_id, thread_id, pin_type, ref_id, label, metadata_json, pinned_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tenantId, threadId, pinType, refId, label, metadata ? JSON.stringify(metadata) : null, pinnedBy);
  return { id, tenant_id: tenantId, thread_id: threadId, pin_type: pinType, ref_id: refId, label, metadata_json: metadata ? JSON.stringify(metadata) : null, pinned_by: pinnedBy, created_at: new Date().toISOString() };
}

export function removeContextPin(tenantId, pinId) {
  return db.prepare('DELETE FROM context_pins WHERE tenant_id = ? AND id = ?').run(tenantId, pinId);
}

// ─── GC Profile Aggregation (DACP) ────────────────────────────────────────

export function getGcProfile(tenantId, gcName) {
  if (!gcName) return null;
  const like = `%${gcName}%`;

  const bids = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as open_bids,
           MAX(received_at) as last_bid_date
    FROM dacp_bid_requests WHERE tenant_id = ? AND gc_name LIKE ?
  `).get(tenantId, like);

  const estimates = db.prepare(`
    SELECT COUNT(*) as total,
           AVG(total_bid) as avg_bid_size,
           SUM(total_bid) as total_bid_value
    FROM dacp_estimates WHERE tenant_id = ? AND gc_name LIKE ?
  `).get(tenantId, like);

  const jobs = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(bid_amount) as total_revenue,
           AVG(margin_pct) as avg_margin,
           SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
           MAX(COALESCE(end_date, start_date)) as last_activity
    FROM dacp_jobs WHERE tenant_id = ? AND gc_name LIKE ?
  `).get(tenantId, like);

  const recentProjects = db.prepare(`
    SELECT project_name, status, bid_amount, margin_pct, start_date
    FROM dacp_jobs WHERE tenant_id = ? AND gc_name LIKE ?
    ORDER BY start_date DESC LIMIT 5
  `).all(tenantId, like);

  const openBids = db.prepare(`
    SELECT id, subject, due_date, status, urgency
    FROM dacp_bid_requests WHERE tenant_id = ? AND gc_name LIKE ? AND status IN ('new', 'reviewing')
    ORDER BY due_date ASC LIMIT 5
  `).all(tenantId, like);

  const winRate = (estimates?.total > 0 && jobs?.total > 0)
    ? (jobs.total / estimates.total) : null;

  return {
    name: gcName,
    bidCount: bids?.total || 0,
    openBids: openBids || [],
    estimateCount: estimates?.total || 0,
    jobCount: jobs?.total || 0,
    totalRevenue: jobs?.total_revenue || 0,
    avgMargin: jobs?.avg_margin || null,
    avgBidSize: estimates?.avg_bid_size || null,
    winRate,
    activeJobs: jobs?.active || 0,
    completedJobs: jobs?.completed || 0,
    recentProjects: recentProjects || [],
    lastActivity: jobs?.last_activity || bids?.last_bid_date || null,
  };
}

// ─── Related Threads (entity overlap) ──────────────────────────────────────

export function getRelatedThreads(tenantId, entityNames, excludeThreadId, limit = 5) {
  if (!entityNames || entityNames.length === 0) return [];

  // Search thread_summaries and chat_threads for mentions of entity names
  const conditions = entityNames.map(() => '(ts.summary LIKE ? OR ct.title LIKE ?)').join(' OR ');
  const params = [];
  for (const name of entityNames) {
    const like = `%${name}%`;
    params.push(like, like);
  }

  try {
    return db.prepare(`
      SELECT ct.id, ct.title, ct.agent_id, ct.updated_at, ts.summary
      FROM chat_threads ct
      LEFT JOIN thread_summaries ts ON ts.thread_id = ct.id
      WHERE ct.tenant_id = ? AND ct.id != ?
        AND (${conditions})
      ORDER BY ct.updated_at DESC LIMIT ?
    `).all(tenantId, excludeThreadId, ...params, limit);
  } catch (e) {
    return [];
  }
}

// ─── Upsert Knowledge Entity (merge semantics) ────────────────────────────

export function upsertKnowledgeEntity(tenantId, name, entityType, metadata = {}) {
  // Try to find existing entity by name + type (fuzzy)
  const existing = db.prepare(`
    SELECT * FROM knowledge_entities
    WHERE tenant_id = ? AND entity_type = ?
      AND (LOWER(name) = LOWER(?) OR LOWER(name) LIKE LOWER(?))
    LIMIT 1
  `).get(tenantId, entityType, name, `%${name}%`);

  if (existing) {
    // Merge metadata
    let existingMeta = {};
    try { existingMeta = existing.metadata_json ? JSON.parse(existing.metadata_json) : {}; } catch {}
    const merged = { ...existingMeta, ...metadata };
    db.prepare('UPDATE knowledge_entities SET metadata_json = ? WHERE id = ?')
      .run(JSON.stringify(merged), existing.id);
    return { ...existing, metadata_json: JSON.stringify(merged), _action: 'updated' };
  }

  // Create new
  const id = `ent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO knowledge_entities (id, tenant_id, entity_type, name, metadata_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, tenantId, entityType, name, JSON.stringify(metadata));
  return { id, tenant_id: tenantId, entity_type: entityType, name, metadata_json: JSON.stringify(metadata), _action: 'created' };
}

// ─── Thread Entities (extract from messages) ───────────────────────────────

export function getThreadEntities(tenantId, threadId, limit = 10) {
  // Get recent messages from thread to extract entity names
  const messages = db.prepare(`
    SELECT content FROM chat_messages
    WHERE tenant_id = ? AND thread_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(tenantId, threadId, limit);

  const thread = db.prepare('SELECT title FROM chat_threads WHERE id = ?').get(threadId);

  // Collect all text to search against
  const allText = [
    thread?.title || '',
    ...messages.map(m => m.content || ''),
  ].join(' ');

  if (!allText.trim()) return [];

  // Find knowledge entities mentioned in the text
  const entities = db.prepare(`
    SELECT * FROM knowledge_entities WHERE tenant_id = ?
  `).all(tenantId);

  return entities.filter(e => {
    const name = e.name.toLowerCase();
    const text = allText.toLowerCase();
    return text.includes(name);
  });
}

// ─── HubSpot Local Classifications ────────────────────────────────────────

export function upsertHubspotClassification(tenantId, data) {
  const db = getTenantDb(tenantId);
  const stmt = db.prepare(`
    INSERT INTO hubspot_classifications (hubspot_id, tenant_id, name, email, company, title, domain, industry, reason, materials, reasoning, confidence, classified_at)
    VALUES (@hubspot_id, @tenant_id, @name, @email, @company, @title, @domain, @industry, @reason, @materials, @reasoning, @confidence, datetime('now'))
    ON CONFLICT(hubspot_id, tenant_id) DO UPDATE SET
      name=@name, email=@email, company=@company, title=@title, domain=@domain,
      industry=@industry, reason=@reason, materials=@materials, reasoning=@reasoning,
      confidence=@confidence, classified_at=datetime('now')
  `);
  return stmt.run({ tenant_id: tenantId, ...data });
}

export function bulkUpsertHubspotClassifications(tenantId, rows) {
  const db = getTenantDb(tenantId);
  const stmt = db.prepare(`
    INSERT INTO hubspot_classifications (hubspot_id, tenant_id, name, email, company, title, domain, industry, reason, materials, reasoning, confidence, classified_at)
    VALUES (@hubspot_id, @tenant_id, @name, @email, @company, @title, @domain, @industry, @reason, @materials, @reasoning, @confidence, datetime('now'))
    ON CONFLICT(hubspot_id, tenant_id) DO UPDATE SET
      name=@name, email=@email, company=@company, title=@title, domain=@domain,
      industry=@industry, reason=@reason, materials=@materials, reasoning=@reasoning,
      confidence=@confidence, classified_at=datetime('now')
  `);
  const tx = db.transaction((items) => {
    for (const item of items) {
      stmt.run({ tenant_id: tenantId, ...item });
    }
  });
  tx(rows);
  return { inserted: rows.length };
}

export function getHubspotClassifications(tenantId, { limit = 50, offset = 0, industry, reason, materials, classified, search } = {}) {
  const db = getTenantDb(tenantId);
  const conditions = ['tenant_id = ?'];
  const params = [tenantId];

  if (industry) { conditions.push('industry = ?'); params.push(industry); }
  if (reason) { conditions.push('reason = ?'); params.push(reason); }
  if (materials) { conditions.push('materials = ?'); params.push(materials); }
  if (classified === true) { conditions.push('industry IS NOT NULL'); }
  if (classified === false) { conditions.push('industry IS NULL'); }
  if (search) {
    conditions.push('(name LIKE ? OR email LIKE ? OR company LIKE ? OR domain LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  const where = conditions.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM hubspot_classifications WHERE ${where}`).get(...params).cnt;
  params.push(limit, offset);
  const rows = db.prepare(`SELECT * FROM hubspot_classifications WHERE ${where} ORDER BY classified_at DESC LIMIT ? OFFSET ?`).all(...params);
  return { classifications: rows, total, limit, offset };
}

export function getHubspotClassificationStats(tenantId) {
  const db = getTenantDb(tenantId);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM hubspot_classifications WHERE tenant_id = ?').get(tenantId).cnt;
  const classified = db.prepare("SELECT COUNT(*) as cnt FROM hubspot_classifications WHERE tenant_id = ? AND industry IS NOT NULL AND industry != ''").get(tenantId).cnt;
  const byIndustry = db.prepare("SELECT industry, COUNT(*) as cnt FROM hubspot_classifications WHERE tenant_id = ? AND industry IS NOT NULL AND industry != '' GROUP BY industry ORDER BY cnt DESC").all(tenantId);
  const byReason = db.prepare("SELECT reason, COUNT(*) as cnt FROM hubspot_classifications WHERE tenant_id = ? AND reason IS NOT NULL AND reason != '' GROUP BY reason ORDER BY cnt DESC").all(tenantId);
  return { total, classified, unclassified: total - classified, byIndustry, byReason };
}

export function getHubspotClassification(tenantId, hubspotId) {
  const db = getTenantDb(tenantId);
  return db.prepare('SELECT * FROM hubspot_classifications WHERE tenant_id = ? AND hubspot_id = ?').get(tenantId, hubspotId);
}

// ─── User Inbox Monitoring ─────────────────────────────────────────────────

function initUserInboxTables(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS user_inbox_config (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_email TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      poll_interval_minutes INTEGER DEFAULT 5,
      last_polled_at TEXT,
      last_history_id TEXT,
      ingest_mode TEXT DEFAULT 'review',
      auto_approve_senders TEXT,
      auto_skip_senders TEXT,
      max_age_days INTEGER DEFAULT 7,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(tenant_id, user_email)
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_user_inbox_config_tenant ON user_inbox_config(tenant_id, enabled)'); } catch (e) {}

  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS user_inbox_processed (
      message_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      thread_id TEXT,
      subject TEXT,
      from_email TEXT,
      ingested_at TEXT DEFAULT (datetime('now')),
      knowledge_entry_id TEXT,
      status TEXT DEFAULT 'ingested',
      PRIMARY KEY(message_id, tenant_id)
    )
  `);
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_user_inbox_processed_tenant ON user_inbox_processed(tenant_id, ingested_at)'); } catch (e) {}
  try { targetDb.exec('CREATE INDEX IF NOT EXISTS idx_user_inbox_processed_from ON user_inbox_processed(tenant_id, from_email)'); } catch (e) {}
}

export function getUserInboxConfig(tenantId) {
  const tdb = getTenantDb(tenantId);
  return tdb.prepare('SELECT * FROM user_inbox_config WHERE tenant_id = ? AND enabled = 1').get(tenantId) || null;
}

export function upsertUserInboxConfig(tenantId, config) {
  const tdb = getTenantDb(tenantId);
  const id = config.id || `uic_${tenantId}_${Date.now()}`;
  tdb.prepare(`
    INSERT INTO user_inbox_config (id, tenant_id, user_email, enabled, poll_interval_minutes, last_polled_at, last_history_id, ingest_mode, auto_approve_senders, auto_skip_senders, max_age_days, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(tenant_id, user_email) DO UPDATE SET
      enabled = excluded.enabled,
      poll_interval_minutes = excluded.poll_interval_minutes,
      last_polled_at = excluded.last_polled_at,
      last_history_id = excluded.last_history_id,
      ingest_mode = excluded.ingest_mode,
      auto_approve_senders = excluded.auto_approve_senders,
      auto_skip_senders = excluded.auto_skip_senders,
      max_age_days = excluded.max_age_days,
      updated_at = datetime('now')
  `).run(
    id,
    tenantId,
    config.user_email || config.userEmail,
    config.enabled !== undefined ? (config.enabled ? 1 : 0) : 1,
    config.poll_interval_minutes || config.pollIntervalMinutes || 5,
    config.last_polled_at || config.lastPolledAt || null,
    config.last_history_id || config.lastHistoryId || null,
    config.ingest_mode || config.ingestMode || 'review',
    config.auto_approve_senders || config.autoApproveSenders || null,
    config.auto_skip_senders || config.autoSkipSenders || null,
    config.max_age_days || config.maxAgeDays || 7
  );
  return tdb.prepare('SELECT * FROM user_inbox_config WHERE tenant_id = ? AND user_email = ?').get(tenantId, config.user_email || config.userEmail);
}

export function isUserInboxMessageProcessed(tenantId, messageId) {
  const tdb = getTenantDb(tenantId);
  const row = tdb.prepare('SELECT 1 FROM user_inbox_processed WHERE tenant_id = ? AND message_id = ? LIMIT 1').get(tenantId, messageId);
  return !!row;
}

export function markUserInboxMessageProcessed({ tenantId, messageId, threadId, subject, fromEmail, knowledgeEntryId, status }) {
  const tdb = getTenantDb(tenantId);
  tdb.prepare(`
    INSERT OR IGNORE INTO user_inbox_processed (message_id, tenant_id, thread_id, subject, from_email, knowledge_entry_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(messageId, tenantId, threadId || null, subject || null, fromEmail || null, knowledgeEntryId || null, status || 'ingested');
}

export function getUserInboxStats(tenantId) {
  const tdb = getTenantDb(tenantId);
  const total = tdb.prepare('SELECT COUNT(*) as c FROM user_inbox_processed WHERE tenant_id = ?').get(tenantId).c;
  const byDay = tdb.prepare(`
    SELECT DATE(ingested_at) as day, COUNT(*) as count
    FROM user_inbox_processed
    WHERE tenant_id = ? AND ingested_at >= datetime('now', '-30 days')
    GROUP BY DATE(ingested_at)
    ORDER BY day DESC
  `).all(tenantId);
  const byStatus = tdb.prepare(`
    SELECT status, COUNT(*) as count
    FROM user_inbox_processed
    WHERE tenant_id = ?
    GROUP BY status
  `).all(tenantId);
  return { total, byDay, byStatus };
}

export function getAllUserInboxConfigs() {
  const tenants = systemDb.prepare('SELECT id FROM tenants').all();
  const configs = [];
  for (const t of tenants) {
    try {
      const tdb = getTenantDb(t.id);
      const rows = tdb.prepare('SELECT * FROM user_inbox_config WHERE enabled = 1').all();
      configs.push(...rows);
    } catch (e) {
      // Skip tenants where table may not exist yet
    }
  }
  return configs;
}

// ─── Graceful Shutdown ─────────────────────────────────────────────────────
// Checkpoint WAL and close all database connections on process exit to prevent corruption.

export function closeAllDatabases() {
  for (const [tenantId, tdb] of tenantDbCache) {
    try {
      tdb.pragma('wal_checkpoint(TRUNCATE)');
      tdb.close();
    } catch (err) {
      console.error(`Error closing tenant DB [${tenantId}]:`, err.message);
    }
  }
  tenantDbCache.clear();
  try {
    systemDb.pragma('wal_checkpoint(TRUNCATE)');
    systemDb.close();
  } catch (err) {
    console.error('Error closing system DB:', err.message);
  }
  console.log('All databases closed cleanly.');
}

function handleShutdown(signal) {
  console.log(`${signal} received - closing databases...`);
  closeAllDatabases();
  process.exit(0);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export default db;
