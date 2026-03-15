import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import bcryptPkg from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dataDir = join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(join(dataDir, 'cache.db'));

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
 * Returns true if reserved — callers should reject or quote.
 */
export function isSqlReserved(value) {
  if (typeof value !== 'string') return false;
  return SQL_RESERVED.has(value.toUpperCase().trim());
}

export function initDatabase() {
  // ─── Startup Integrity Check ───────────────────────────────────────────────
  try {
    const integrityResult = db.pragma('integrity_check');
    const isOk = integrityResult.length === 1 && integrityResult[0].integrity_check === 'ok';
    if (!isOk) {
      const errors = integrityResult.map(r => r.integrity_check).join('\n');
      console.error(`\n╔══════════════════════════════════════════════════════════╗`);
      console.error(`║  DATABASE INTEGRITY CHECK FAILED — REFUSING TO START    ║`);
      console.error(`╠══════════════════════════════════════════════════════════╣`);
      console.error(`║  Errors found:                                          ║`);
      errors.split('\n').forEach(e => console.error(`║  ${e.padEnd(54)}║`));
      console.error(`║                                                          ║`);
      console.error(`║  To recover, restore from backup:                        ║`);
      console.error(`║  cp data/backups/cache_XX.db data/cache.db               ║`);
      console.error(`║  Or delete data/cache.db to rebuild from scratch.        ║`);
      console.error(`╚══════════════════════════════════════════════════════════╝\n`);
      process.exit(1);
    }
    console.log('[DB] Integrity check passed');
  } catch (err) {
    console.error(`\n╔══════════════════════════════════════════════════════════╗`);
    console.error(`║  DATABASE CORRUPT — REFUSING TO START                   ║`);
    console.error(`╠══════════════════════════════════════════════════════════╣`);
    console.error(`║  ${(err.message || '').padEnd(54)}║`);
    console.error(`║                                                          ║`);
    console.error(`║  To recover, restore from backup:                        ║`);
    console.error(`║  cp data/backups/cache_XX.db data/cache.db               ║`);
    console.error(`║  Or delete data/cache.db to rebuild from scratch.        ║`);
    console.error(`╚══════════════════════════════════════════════════════════╝\n`);
    process.exit(1);
  }

  // Cache table for API responses
  db.exec(`
    CREATE TABLE IF NOT EXISTS cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);

  // Manual data entries
  db.exec(`
    CREATE TABLE IF NOT EXISTS manual_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Alerts configuration
  db.exec(`
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id INTEGER,
      value REAL,
      triggered_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alert_id) REFERENCES alerts(id)
    )
  `);

  // Notes/Journal
  db.exec(`
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
  db.exec(`
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
  db.exec(`
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
  db.exec(`
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS btc_wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert known US government BTC wallets if they don't exist
  const insertWallet = db.prepare(`
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
  db.exec(`
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
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_energy_prices_lookup
    ON energy_prices(iso, node, market_type, timestamp)
  `);

  // System load data
  db.exec(`
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
  db.exec(`
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS energy_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )
  `);

  // =========================================================================
  // Phase 3: Fleet hashprice tables
  // =========================================================================

  // Fleet configuration (user's ASIC fleet)
  db.exec(`
    CREATE TABLE IF NOT EXISTS fleet_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )
  `);

  // Fleet profitability snapshots (daily historical tracking)
  db.exec(`
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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_fleet_snapshots_timestamp
    ON fleet_snapshots(timestamp)
  `);

  // Per-model snapshots (linked to fleet snapshots)
  db.exec(`
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
  db.exec(`
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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_curtailment_events_start
    ON curtailment_events(start_time)
  `);

  // Curtailment daily performance tracking
  db.exec(`
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

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_curtailment_performance_date
    ON curtailment_performance(date)
  `);

  // Curtailment settings (user constraints)
  db.exec(`
    CREATE TABLE IF NOT EXISTS curtailment_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )
  `);

  // Add missing columns to curtailment_events (idempotent)
  const addColumn = (table, col, type) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch (e) { /* already exists */ }
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS pool_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )
  `);

  // Pool hashrate history
  db.exec(`
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
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_hashrate_pool_ts ON pool_hashrate(pool, timestamp)`);

  // Pool earnings
  db.exec(`
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
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pool_earnings_pool_date ON pool_earnings(pool, date)`);

  // Pool payouts
  db.exec(`
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
  db.exec(`
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
  db.exec(`CREATE INDEX IF NOT EXISTS idx_worker_snapshots_pool_ts ON worker_snapshots(pool, timestamp)`);

  // On-chain blocks
  db.exec(`
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
  db.exec(`
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
  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agent_events_agent_ts ON agent_events(agent_id, timestamp)'); } catch (e) { /* exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agent_approvals_status ON agent_approvals(status)'); } catch (e) { /* exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent_date ON agent_metrics(agent_id, date)'); } catch (e) { /* exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read, dismissed)'); } catch (e) { /* exists */ }

  // ─── Phase 7: HPC / AI Compute Abstraction Layer ────────────────────────────

  // Workload configuration (BTC + HPC workloads)
  db.exec(`
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS gpu_fleet_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config_json TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // HPC contracts
  db.exec(`
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
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_hpc_sla_events_contract ON hpc_sla_events(contract_id, timestamp)'); } catch (e) { /* exists */ }

  // Workload daily snapshots (unified BTC + HPC tracking)
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_workload_snapshots_date ON workload_snapshots(date, workload_type)'); } catch (e) { /* exists */ }

  // GPU spot pricing history
  db.exec(`
    CREATE TABLE IF NOT EXISTS gpu_spot_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME NOT NULL,
      gpu_model TEXT NOT NULL,
      provider TEXT,
      price_per_gpu_hr REAL,
      UNIQUE(timestamp, gpu_model, provider)
    )
  `);
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_gpu_spot_prices_model ON gpu_spot_prices(gpu_model, timestamp)'); } catch (e) { /* exists */ }

  console.log('Database initialized');

  // Initialize Phase 8 multi-tenant tables
  initPhase8Tables();

  // Initialize Phase 9 insurance tables
  initPhase9Tables();

  // Initialize Phase 10 bot tables
  initBotTables();

  // Initialize DACP Construction tables
  initDacpTables();

  // Initialize tenant files table
  initFilesTable();

  // Initialize Opus rate limiting table
  initOpusLimitsTable();

  // Initialize background jobs + key vault tables
  initBackgroundJobsTables();

  // Initialize activity log table
  initActivityLogTable();

  // Initialize processed emails dedup table
  initProcessedEmailsTable();

  // Initialize auto-replies log table
  initAutoRepliesTable();

  // Initialize report comments table
  initReportComments();

  // Initialize accounting tables (QuickBooks / Bill.com)
  initAccountingTables();

  // Initialize price alert rules table
  initPriceAlertRulesTable();

  // Password reset tokens
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_pw_reset_hash ON password_resets(token_hash)'); } catch (e) {}
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

export function initReportComments() {
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_report_comments_report ON report_comments(tenant_id, report_id, created_at)'); } catch (e) { /* exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_report_comments_created ON report_comments(created_at)'); } catch (e) { /* exists */ }
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

export function initPhase8Tables() {
  db.exec(`
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_refresh ON sessions(refresh_token_hash)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_partner_access_tenant ON partner_access(tenant_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_partner_access_partner ON partner_access(partner_tenant_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_audit_log_tenant ON audit_log(tenant_id, timestamp)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id)'); } catch (e) {}

  // Add tenant_id to ALL existing tables (idempotent)
  const tablesToMigrate = [
    'cache', 'manual_data', 'alerts', 'alert_history', 'notes', 'imec_milestones',
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
      db.exec(`ALTER TABLE ${table} ADD COLUMN tenant_id TEXT DEFAULT 'default'`);
    } catch (e) {
      // Column already exists
    }
  }

  // Create default tenant if not exists
  const defaultTenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get('default');
  if (!defaultTenant) {
    db.prepare(`
      INSERT INTO tenants (id, name, slug, plan, status, settings_json, limits_json)
      VALUES ('default', 'Default Organization', 'default', 'professional', 'active', ?, ?)
    `).run(
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
  }

  // Backfill settings_json for existing default tenant if missing
  const existingDefault = db.prepare('SELECT settings_json FROM tenants WHERE id = ?').get('default');
  if (existingDefault && !existingDefault.settings_json) {
    db.prepare('UPDATE tenants SET settings_json = ? WHERE id = ?').run(
      JSON.stringify({
        industry: 'mining',
        macro_intelligence: true,
        correlations: true,
        liquidity: true,
        hpc_enabled: false,
        thread_privacy: true,
      }),
      'default'
    );
  }

  // Seed default admin user if not exists
  const adminUser = db.prepare('SELECT id FROM users WHERE email = ?').get('teo@zhan.capital');
  if (!adminUser) {
    const salt = bcryptPkg.genSaltSync(12);
    const hash = bcryptPkg.hashSync(process.env.SEED_ADMIN_PASSWORD || 'admin123', salt);
    db.prepare(`
      INSERT OR IGNORE INTO users (id, email, name, password_hash, tenant_id, role, status)
      VALUES ('seed-admin-001', 'teo@zhan.capital', 'Teo Blind', ?, 'default', 'sangha_admin', 'active')
    `).run(hash);
    console.log('Seed admin user created: teo@zhan.capital / admin123');
  }

  // Add custom_domain column if not exists
  try {
    db.exec(`ALTER TABLE tenants ADD COLUMN custom_domain TEXT`);
  } catch (e) {
    // Column already exists — ignore
  }

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  console.log('Phase 8 tables initialized');
}

// ─── Phase 8: Tenant Helpers ────────────────────────────────────────────────

export function getTenant(id) {
  const row = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id);
  if (row) {
    row.branding = row.branding_json ? JSON.parse(row.branding_json) : null;
    row.settings = row.settings_json ? JSON.parse(row.settings_json) : null;
    row.limits = row.limits_json ? JSON.parse(row.limits_json) : null;
  }
  return row;
}

export function getTenantBySlug(slug) {
  const row = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
  if (row) {
    row.branding = row.branding_json ? JSON.parse(row.branding_json) : null;
    row.settings = row.settings_json ? JSON.parse(row.settings_json) : null;
    row.limits = row.limits_json ? JSON.parse(row.limits_json) : null;
  }
  return row;
}

export function getTenantByDomain(domain) {
  const row = db.prepare('SELECT * FROM tenants WHERE custom_domain = ?').get(domain);
  if (row) {
    row.branding = row.branding_json ? JSON.parse(row.branding_json) : null;
    row.settings = row.settings_json ? JSON.parse(row.settings_json) : null;
    row.limits = row.limits_json ? JSON.parse(row.limits_json) : null;
  }
  return row;
}

export function getAllTenants() {
  return db.prepare('SELECT * FROM tenants ORDER BY created_at').all().map(row => ({
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

  return db.prepare(`
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
  return db.prepare(`UPDATE tenants SET ${sets.join(', ')} WHERE id = ?`).run(...params);
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
  return db.prepare('SELECT id, email, name, tenant_id, role, status, mfa_enabled, last_login, created_at FROM users WHERE tenant_id = ? ORDER BY created_at').all(tenantId);
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

export function listThreads(tenantId, agentId, userId, { isAdmin = false, limit = 50, offset = 0 } = {}) {
  if (isAdmin) {
    return db.prepare(`
      SELECT * FROM chat_threads
      WHERE tenant_id = ? AND agent_id = ?
      ORDER BY updated_at DESC LIMIT ? OFFSET ?
    `).all(tenantId, agentId, limit, offset);
  }
  return db.prepare(`
    SELECT * FROM chat_threads
    WHERE tenant_id = ? AND agent_id = ?
      AND (user_id = ? OR visibility IN ('team', 'pinned'))
    ORDER BY updated_at DESC LIMIT ? OFFSET ?
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

export function initPhase9Tables() {
  // Calibration exports — audit log of telemetry exports to SanghaModel
  db.exec(`
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

  // Risk assessments — cached risk assessments from simulator
  db.exec(`
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

  // Quote requests — formal quote requests from miners
  db.exec(`
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

  // Insurance policies — active insurance policies
  db.exec(`
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

  // Insurance claims — monthly claims with verification
  db.exec(`
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

  // Insurance upside sharing — upside revenue sharing calculations
  db.exec(`
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
  db.exec(`CREATE INDEX IF NOT EXISTS idx_calibration_exports_exported ON calibration_exports(exported_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_risk_assessments_tenant ON risk_assessments(tenant_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_risk_assessments_expires ON risk_assessments(expires_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_requests_tenant ON quote_requests(tenant_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_requests_status ON quote_requests(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_insurance_policies_tenant ON insurance_policies(tenant_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_insurance_claims_policy ON insurance_claims(policy_id, claim_month)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_insurance_claims_status ON insurance_claims(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_upside_sharing_policy ON insurance_upside_sharing(policy_id, sharing_month)`);

  // ── Phase 9b: Three-Party Insurance Structure ──────────────────────────────

  // Balance sheet partners — LP / capital provider entities
  db.exec(`
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

  // LP allocations — tracks which LP backs which quote/policy
  db.exec(`
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
    db.exec(`ALTER TABLE insurance_policies ADD COLUMN lp_id TEXT REFERENCES balance_sheet_partners(id)`);
  } catch (e) { /* column may already exist */ }
  try {
    db.exec(`ALTER TABLE insurance_policies ADD COLUMN lp_allocation_id TEXT REFERENCES lp_allocations(id)`);
  } catch (e) { /* column may already exist */ }
  try {
    db.exec(`ALTER TABLE insurance_policies ADD COLUMN instrument_type TEXT`);
  } catch (e) { /* column may already exist */ }
  try {
    db.exec(`ALTER TABLE insurance_policies ADD COLUMN structuring_fee_monthly REAL`);
  } catch (e) { /* column may already exist */ }
  try {
    db.exec(`ALTER TABLE insurance_policies ADD COLUMN management_fee_monthly REAL`);
  } catch (e) { /* column may already exist */ }

  // Add LP/settlement columns to insurance_claims
  try {
    db.exec(`ALTER TABLE insurance_claims ADD COLUMN lp_id TEXT REFERENCES balance_sheet_partners(id)`);
  } catch (e) { /* column may already exist */ }
  try {
    db.exec(`ALTER TABLE insurance_claims ADD COLUMN settlement_status TEXT DEFAULT 'pending'`);
  } catch (e) { /* column may already exist */ }
  try {
    db.exec(`ALTER TABLE insurance_claims ADD COLUMN settled_at DATETIME`);
  } catch (e) { /* column may already exist */ }
  try {
    db.exec(`ALTER TABLE insurance_claims ADD COLUMN settlement_reference TEXT`);
  } catch (e) { /* column may already exist */ }

  // Add instrument_type and structured_terms to quote_requests
  try {
    db.exec(`ALTER TABLE quote_requests ADD COLUMN instrument_type TEXT`);
  } catch (e) { /* column may already exist */ }
  try {
    db.exec(`ALTER TABLE quote_requests ADD COLUMN structured_terms_json TEXT`);
  } catch (e) { /* column may already exist */ }
  try {
    db.exec(`ALTER TABLE quote_requests ADD COLUMN structured_by TEXT`);
  } catch (e) { /* column may already exist */ }
  try {
    db.exec(`ALTER TABLE quote_requests ADD COLUMN structured_at DATETIME`);
  } catch (e) { /* column may already exist */ }

  // Indices for Phase 9b
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lp_allocations_lp ON lp_allocations(lp_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lp_allocations_quote ON lp_allocations(quote_request_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bsp_status ON balance_sheet_partners(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_policies_lp ON insurance_policies(lp_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_claims_lp ON insurance_claims(lp_id)`);
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

export function initBotTables() {
  db.exec(`
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

  db.exec(`
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

  try { db.exec('CREATE INDEX IF NOT EXISTS idx_bot_reg_tenant ON bot_registrations(tenant_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_bot_reg_user ON bot_registrations(user_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_bot_comments_event ON bot_comments(event_key)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_bot_comments_tenant ON bot_comments(tenant_id)'); } catch (e) {}
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

export function initDacpTables() {
  db.exec(`
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

  db.exec(`
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
      received_at TEXT
    )
  `);

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  // Chat messages
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_chat_tenant_agent_user ON chat_messages(tenant_id, agent_id, user_id, created_at)'); } catch (e) {}

  // Chat threads
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_threads_tenant_agent ON chat_threads(tenant_id, agent_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_threads_visibility ON chat_threads(tenant_id, visibility)'); } catch (e) {}

  // Add thread_id column to chat_messages (idempotent)
  try { db.exec('ALTER TABLE chat_messages ADD COLUMN thread_id TEXT REFERENCES chat_threads(id)'); } catch (e) { /* already exists */ }

  // Approval queue
  db.exec(`
    CREATE TABLE IF NOT EXISTS approval_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL CHECK(type IN ('email_draft', 'curtailment', 'estimate', 'report', 'config_change', 'document')),
      payload_json TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      required_role TEXT DEFAULT 'admin',
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_approval_tenant_status ON approval_items(tenant_id, status, created_at)'); } catch (e) {}

  // Platform notifications (multi-tenant)
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_notif_tenant_user ON platform_notifications(tenant_id, user_id, read, created_at)'); } catch (e) {}

  // Indices
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_dacp_pricing_tenant ON dacp_pricing(tenant_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_dacp_bids_tenant ON dacp_bid_requests(tenant_id, status)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_dacp_estimates_tenant ON dacp_estimates(tenant_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_dacp_jobs_tenant ON dacp_jobs(tenant_id, status)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_dacp_reports_tenant ON dacp_field_reports(tenant_id, job_id)'); } catch (e) {}

  // ─── Knowledge Graph Tables ─────────────────────────────────────────────
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_knowledge_tenant ON knowledge_entries(tenant_id, type, created_at)'); } catch (e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entities (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      name TEXT NOT NULL,
      metadata_json TEXT
    )
  `);
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_kn_entities_tenant ON knowledge_entities(tenant_id, entity_type)'); } catch (e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_links (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      relationship TEXT,
      FOREIGN KEY (entry_id) REFERENCES knowledge_entries(id),
      FOREIGN KEY (entity_id) REFERENCES knowledge_entities(id)
    )
  `);
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_kn_links_entry ON knowledge_links(entry_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_kn_links_entity ON knowledge_links(entity_id)'); } catch (e) {}

  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_action_items_tenant ON action_items(tenant_id, status)'); } catch (e) {}

  // Add completed_at / completed_by columns to action_items (idempotent)
  try { db.exec("ALTER TABLE action_items ADD COLUMN completed_at TEXT"); } catch (e) { /* already exists */ }
  try { db.exec("ALTER TABLE action_items ADD COLUMN completed_by TEXT"); } catch (e) { /* already exists */ }

  // Agent insights table (for Command dashboard)
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_insights_tenant ON agent_insights(tenant_id, status, created_at)'); } catch (e) {}

  // Seed knowledge entities
  const knEntCount = db.prepare('SELECT COUNT(*) as c FROM knowledge_entities').get();
  if (knEntCount.c === 0) {
    const seedEntities = db.prepare('INSERT OR IGNORE INTO knowledge_entities (id, tenant_id, entity_type, name, metadata_json) VALUES (?, ?, ?, ?, ?)');
    const sanghaId = 'default';
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

  // Seed DACP tenant
  const dacpTenant = db.prepare('SELECT id FROM tenants WHERE id = ?').get('dacp-construction-001');
  if (!dacpTenant) {
    db.prepare(`
      INSERT INTO tenants (id, name, slug, plan, status, branding_json, settings_json, limits_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'dacp-construction-001', 'DACP Construction', 'dacp', 'professional', 'active',
      JSON.stringify({ companyName: 'DACP', primaryColor: '#1e3a5f', secondaryColor: '#d4cdc5', hideSanghaBranding: true }),
      JSON.stringify({ industry: 'construction', defaultOverheadPct: 10, defaultProfitPct: 15, region: 'Texas' }),
      JSON.stringify({ maxUsers: 25, maxSites: 5, maxWorkloads: 50, maxAgents: 10, apiRateLimit: 120, dataRetentionDays: 365 })
    );
    console.log('DACP tenant created');
  }

  // Seed DACP admin user
  const dacpAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@dacp.localhost');
  if (!dacpAdmin) {
    const salt = bcryptPkg.genSaltSync(12);
    const hash = bcryptPkg.hashSync(process.env.SEED_ADMIN_PASSWORD || 'admin123', salt);
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, tenant_id, role, status)
      VALUES ('dacp-admin-001', 'admin@dacp.localhost', 'DACP Admin', ?, 'dacp-construction-001', 'owner', 'active')
    `).run(hash);
    console.log('DACP admin user created: admin@dacp.localhost / admin123');
  }

  // Seed data from JSON files
  const dacpDataDir = join(__dirname, '../data/dacp');
  const existing = db.prepare('SELECT COUNT(*) as c FROM dacp_pricing WHERE tenant_id = ?').get('dacp-construction-001');
  if (existing.c === 0 && fs.existsSync(join(dacpDataDir, 'pricing_master.json'))) {
    const TENANT_ID = 'dacp-construction-001';
    const loadJson = (f) => JSON.parse(fs.readFileSync(join(dacpDataDir, f), 'utf-8'));

    const pricing = loadJson('pricing_master.json');
    const insertPricing = db.prepare(`INSERT OR IGNORE INTO dacp_pricing (id, tenant_id, category, item, unit, material_cost, labor_cost, equipment_cost, unit_price, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const p of pricing) insertPricing.run(p.id, TENANT_ID, p.category, p.item, p.unit, p.material_cost, p.labor_cost, p.equipment_cost, p.unit_price, p.notes);

    const jobs = loadJson('jobs_history.json');
    const insertJob = db.prepare(`INSERT OR IGNORE INTO dacp_jobs (id, tenant_id, estimate_id, project_name, gc_name, project_type, location, status, estimated_cost, actual_cost, bid_amount, margin_pct, start_date, end_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const j of jobs) insertJob.run(j.id, TENANT_ID, null, j.project_name, j.gc_name, j.project_type, j.location, j.status, j.estimated_cost, j.actual_cost, j.bid_amount, j.margin_pct, j.start_date, j.end_date, j.notes);

    const bidRequests = loadJson('bid_requests_inbox.json');
    const insertBid = db.prepare(`INSERT OR IGNORE INTO dacp_bid_requests (id, tenant_id, from_email, from_name, gc_name, subject, body, attachments_json, scope_json, due_date, status, urgency, missing_info_json, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const b of bidRequests) insertBid.run(b.id, TENANT_ID, b.from_email, b.from_name, b.gc_name, b.subject, b.body, JSON.stringify(b.attachments), JSON.stringify(b.scope), b.due_date, b.status, b.urgency, JSON.stringify(b.missing_info), b.received_at);

    const fieldLogs = loadJson('field_logs.json');
    const insertReport = db.prepare(`INSERT OR IGNORE INTO dacp_field_reports (id, tenant_id, job_id, date, reported_by, work_json, materials_json, labor_json, equipment_json, weather, notes, issues_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
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

      db.prepare(`INSERT OR IGNORE INTO dacp_estimates (id, tenant_id, bid_request_id, project_name, gc_name, status, line_items_json, subtotal, overhead_pct, profit_pct, mobilization, total_bid, confidence, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(estId, TENANT_ID, br.id, projectName, br.gc_name, 'draft', JSON.stringify(lineItems), subtotal, 10, 15, mobilization + testing, totalBid,
          lineItems.filter(li => !li.pricingId).length > 0 ? 'medium' : 'high',
          `Auto-generated demo estimate. ${lineItems.length} line items matched.`);

      // Mark bid request as estimated
      db.prepare('UPDATE dacp_bid_requests SET status = ? WHERE id = ? AND tenant_id = ?').run('estimated', br.id, TENANT_ID);
    }
    console.log('DACP: Generated 5 demo estimates');
  }

  // ─── Lead Engine Tables ──────────────────────────────────────────────────
  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  db.exec(`
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

  try { db.exec('CREATE INDEX IF NOT EXISTS idx_le_leads_tenant ON le_leads(tenant_id, status)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_le_contacts_lead ON le_contacts(lead_id)'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_le_outreach_tenant ON le_outreach_log(tenant_id, status)'); } catch (e) {}

  // ─── Lead Engine Seed Data ──────────────────────────────────────────────
  const leCount = db.prepare('SELECT COUNT(*) as c FROM le_leads WHERE tenant_id = ?').get('default');
  if (leCount.c === 0) {
    const insertLead = db.prepare(`INSERT OR IGNORE INTO le_leads (id, tenant_id, venue_name, region, industry, trigger_news, priority_score, website, status, source, source_query, discovered_at, contacted_at, responded_at, notes, agent_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertContact = db.prepare(`INSERT OR IGNORE INTO le_contacts (id, tenant_id, lead_id, name, email, title, phone, source, mx_valid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertOutreach = db.prepare(`INSERT OR IGNORE INTO le_outreach_log (id, tenant_id, lead_id, contact_id, email_type, subject, body, status, sent_at, responded_at, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    // Sangha leads
    const S = 'default';
    insertLead.run('le-s-001', S, 'Meridian Renewables', 'ERCOT', 'Solar IPP', 'Crane County portfolio facing negative LMPs', 92, 'meridianrenewables.com', 'responded', 'discovery', 'solar IPP Texas ERCOT', '2026-02-20', '2026-03-02', '2026-03-07', null, 'Strong interest — exploring BTM mining for Crane County');
    insertLead.run('le-s-002', S, 'GridScale Partners', 'PJM', 'Wind IPP', 'Reviewing underperforming PJM wind assets', 85, 'gridscalepartners.com', 'responded', 'discovery', 'wind IPP PJM underperforming', '2026-02-22', '2026-03-03', '2026-03-05', null, 'Wants partnership structure details');
    insertLead.run('le-s-003', S, 'Nexus Solar', 'MISO', 'Solar IPP', '95 MW portfolio in MISO', 60, 'nexussolar.com', 'contacted', 'discovery', 'solar developer MISO', '2026-02-25', '2026-03-04', null, null, 'Not right time — revisit Q3');
    insertLead.run('le-s-004', S, 'SunPeak Energy', 'ERCOT', 'Solar IPP', '240 MW West Texas solar portfolio', 88, 'sunpeakenergy.com', 'meeting', 'discovery', 'solar IPP ERCOT West Texas', '2026-02-18', '2026-02-28', '2026-03-02', null, 'Call scheduled — two sites may fit');
    insertLead.run('le-s-005', S, 'Apex Clean Energy Partners', 'SPP', 'Wind/Solar', '400 MW mixed portfolio struggling with negative LMPs in Oklahoma', 90, 'apexcleanenergy.com', 'responded', 'discovery', 'renewable IPP SPP negative LMP', '2026-02-15', '2026-02-26', '2026-03-01', null, 'Looping in energy team — strong signal');
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
    insertOutreach.run('lo-s-001', S, 'le-s-001', 'lc-s-001', 'initial', 'Behind-the-meter mining for Crane County', 'Hi Sarah,\n\nI came across Meridian\'s Crane County solar portfolio and noticed your assets have been facing some of the same negative LMP challenges that many ERCOT operators are dealing with right now.\n\nWe\'ve been working with renewable operators to co-locate behind-the-meter Bitcoin mining on underperforming sites — effectively creating an additional revenue stream from the same infrastructure.\n\nWould be happy to share how this has worked on similar assets.\n\nBest,\nSangha Renewables', 'sent', '2026-03-02T09:14:00', '2026-03-07T11:42:00', 'auto', '2026-03-02');
    insertOutreach.run('lo-s-002', S, 'le-s-002', 'lc-s-002', 'initial', 'Hashrate co-location for underperforming wind assets', 'Hi Mark,\n\nGridScale\'s PJM wind portfolio caught our attention — we work with operators who are turning curtailed or low-price hours into reliable mining revenue.\n\nWould love to share our approach if relevant.\n\nBest,\nSangha Renewables', 'sent', '2026-03-03T10:22:00', '2026-03-05T14:18:00', 'auto', '2026-03-03');
    insertOutreach.run('lo-s-003', S, 'le-s-004', 'lc-s-004', 'initial', 'Mining + solar in West Texas', 'Hi James,\n\nSunPeak\'s West Texas solar sites are exactly the kind of assets where behind-the-meter mining adds the most value.\n\nWe have 8 years of operational data to back it up. Happy to walk through the numbers.\n\nBest,\nSangha Renewables', 'sent', '2026-02-28T08:45:00', '2026-03-02T16:30:00', 'auto', '2026-02-28');
    insertOutreach.run('lo-s-004', S, 'le-s-001', 'lc-s-001', 'followup_1', 'Re: Behind-the-meter mining for Crane County', 'Hi Sarah,\n\nGreat to hear there\'s alignment. I\'ll put together a brief overview of our typical project structure for a site in your capacity range.\n\nWould Thursday or Friday afternoon work for a quick call?\n\nBest,\nSangha Renewables', 'draft', null, null, null, '2026-03-07');

    // Sangha discovery config
    db.prepare(`INSERT OR IGNORE INTO le_discovery_config (id, tenant_id, queries_json, regions_json, current_position, queries_per_cycle, max_emails_per_cycle, followup_delay_days, max_followups, min_send_interval_seconds, enabled, mode, sender_name, sender_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'ldc-default', S,
      JSON.stringify(['solar IPP ERCOT negative LMP', 'wind energy developer PJM underperforming', 'renewable IPP curtailment MISO', 'solar farm operator SPP Oklahoma', 'wind portfolio ERCOT West Texas', 'IPP behind-the-meter colocation', 'renewable energy merchant risk', 'solar developer CAISO California', 'wind IPP Texas market', 'renewable energy asset optimization', 'curtailed wind farm operator', 'solar IPP revenue floor', 'wind energy hedge strategy', 'renewable portfolio optimization 2026', 'IPP alternative revenue stream']),
      JSON.stringify(['ERCOT', 'PJM', 'MISO', 'SPP', 'CAISO']),
      4, 2, 10, 5, 2, 300, 1, 'copilot', 'Sangha Renewables', 'outreach@sangha.io'
    );

    console.log('Lead Engine: Seeded 8 Sangha leads + contacts + outreach');
  }

  // DACP lead engine seed
  const leDacpCount = db.prepare('SELECT COUNT(*) as c FROM le_leads WHERE tenant_id = ?').get('dacp-construction-001');
  if (leDacpCount.c === 0) {
    const insertLead = db.prepare(`INSERT OR IGNORE INTO le_leads (id, tenant_id, venue_name, region, industry, trigger_news, priority_score, website, status, source, source_query, discovered_at, contacted_at, responded_at, notes, agent_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertContact = db.prepare(`INSERT OR IGNORE INTO le_contacts (id, tenant_id, lead_id, name, email, title, phone, source, mx_valid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const D = 'dacp-construction-001';
    insertLead.run('le-d-001', D, 'Turner Construction — Houston', 'Texas', 'General Contractor', 'Multiple active projects in Houston metro', 90, 'turnerconstruction.com', 'contacted', 'discovery', 'GC Houston concrete subcontractor needed', '2026-02-10', '2026-02-20', null, null, null);
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

    db.prepare(`INSERT OR IGNORE INTO le_discovery_config (id, tenant_id, queries_json, regions_json, current_position, queries_per_cycle, max_emails_per_cycle, followup_delay_days, max_followups, min_send_interval_seconds, enabled, mode, sender_name, sender_email) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'ldc-dacp', D,
      JSON.stringify(['GC Houston concrete subcontractor RFQ', 'general contractor Texas concrete foundation', 'Houston healthcare construction concrete', 'Austin commercial construction concrete sub', 'San Antonio university campus concrete', 'DFW industrial construction concrete', 'Houston infrastructure concrete paving', 'Texas GC seeking concrete subcontractor', 'Houston medical center construction', 'Texas mixed use development concrete', 'GC pre-qualification concrete Houston', 'TxDOT concrete subcontractor Texas', 'commercial concrete pour Houston 2026', 'multifamily construction concrete Texas', 'Houston warehouse concrete slab contractor']),
      JSON.stringify(['Houston', 'Austin', 'San Antonio', 'Dallas-Fort Worth']),
      2, 2, 8, 5, 2, 300, 0, 'copilot', 'DACP Construction', 'estimating@dacpconstruction.com'
    );

    console.log('Lead Engine: Seeded 6 DACP leads + contacts');
  }

  console.log('DACP tables initialized');
}

// ─── DACP CRUD Helpers ──────────────────────────────────────────────────────

export function getDacpPricing(tenantId, category) {
  if (category) {
    return db.prepare('SELECT * FROM dacp_pricing WHERE tenant_id = ? AND category = ? ORDER BY category, id').all(tenantId, category);
  }
  return db.prepare('SELECT * FROM dacp_pricing WHERE tenant_id = ? ORDER BY category, id').all(tenantId);
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
  const sql = `
    SELECT
      tenant_id,
      json_extract(metadata_json, '$.model') as model,
      COUNT(*) as requests,
      SUM(json_extract(metadata_json, '$.input_tokens')) as input_tokens,
      SUM(json_extract(metadata_json, '$.output_tokens')) as output_tokens
    FROM chat_messages
    WHERE role = 'assistant' AND metadata_json IS NOT NULL
      AND created_at >= ? AND created_at <= ?
    GROUP BY tenant_id, model
  `;
  return db.prepare(sql).all(startDate, endDate);
}

export function getUsageByDayAllTenants(startDate, endDate) {
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
  return db.prepare(sql).all(startDate, endDate);
}

// ─── Tenant Files ─────────────────────────────────────────────────────────

function initFilesTable() {
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tenant_files_tenant ON tenant_files(tenant_id)'); } catch (e) { /* exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_tenant_files_category ON tenant_files(tenant_id, category)'); } catch (e) { /* exists */ }
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

export function initBackgroundJobsTables() {
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_bg_jobs_tenant ON background_jobs(tenant_id, status)'); } catch (e) {}

  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_job_messages_job ON job_messages(job_id)'); } catch (e) {}

  db.exec(`
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
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_key_vault_tenant_service ON key_vault(tenant_id, service, key_name)'); } catch (e) {}
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

// Key Vault CRUD

export function getKeyVaultEntries(tenantId) {
  return db.prepare('SELECT id, tenant_id, service, key_name, added_by, created_at, expires_at FROM key_vault WHERE tenant_id = ? ORDER BY service').all(tenantId);
}

export function getKeyVaultValue(tenantId, service, keyName = 'default') {
  const row = db.prepare('SELECT key_value FROM key_vault WHERE tenant_id = ? AND service = ? AND key_name = ?').get(tenantId, service, keyName);
  return row?.key_value || null;
}

export function upsertKeyVaultEntry(entry) {
  const id = entry.id || `key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(`
    INSERT INTO key_vault (id, tenant_id, service, key_name, key_value, added_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, service, key_name) DO UPDATE SET key_value = ?, added_by = ?, expires_at = ?
  `).run(id, entry.tenantId, entry.service, entry.keyName || 'default', entry.keyValue, entry.addedBy || 'user', entry.expiresAt || null,
    entry.keyValue, entry.addedBy || 'user', entry.expiresAt || null);
  return id;
}

export function deleteKeyVaultEntry(id, tenantId) {
  return db.prepare('DELETE FROM key_vault WHERE id = ? AND tenant_id = ?').run(id, tenantId);
}

// ─── Opus Rate Limiting ─────────────────────────────────────────────────────

export function initOpusLimitsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      limit_type TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_api_limits_tenant_type_date ON api_limits(tenant_id, limit_type, date)`);
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

function initActivityLogTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenant_email_config (
      tenant_id TEXT PRIMARY KEY,
      sender_email TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      gmail_refresh_token TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_activity_tenant ON activity_log(tenant_id, created_at DESC)'); } catch (e) {}

  // Seed demo activity data if empty
  const count = db.prepare('SELECT COUNT(*) as c FROM activity_log').get();
  if (count.c === 0) {
    const insert = db.prepare('INSERT INTO activity_log (tenant_id, type, title, subtitle, detail_json, source_type, agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const now = Date.now();
    const ts = (minAgo) => new Date(now - minAgo * 60000).toISOString().replace('T', ' ').slice(0, 19);

    insert.run('default', 'out', 'Outreach sent to James Torres, VP Ops at SunPeak Energy', 'Personalized re: ERCOT curtailment patterns on their Crane County site', JSON.stringify({ to: 'jtorres@sunpeak.com', subject: 'ERCOT curtailment optimization for Crane County', body: 'Hi James,\n\nI noticed SunPeak\'s Crane County site has been seeing significant curtailment during afternoon price spikes. We\'ve helped similar operators capture $1,200+ per curtailment event through our automated response system.\n\nWould you have 15 minutes this week to discuss how this could work for your fleet?\n\nBest,\nCoppice' }), 'email', 'lead-engine', ts(2));
    insert.run('default', 'meet', 'Transcribed: Reassurity Product Strategy Call', '42 min \u2014 6 attendees \u2014 4 action items extracted', JSON.stringify({ summary: 'Discussed insurance product structure for behind-the-meter mining operations. Agreed on parametric trigger design using ERCOT price data. Next steps: finalize term sheet, schedule actuarial review.', actionItems: ['Finalize term sheet draft by Friday', 'Schedule actuarial review with Munich Re', 'Send updated loss model to Adam', 'Prepare board presentation for March 20'], attendees: ['Spencer Marr', 'Adam Reeve', 'Teo Blind', 'Miguel Alvarez', 'Sarah Chen', 'Jason Gunderson'] }), 'meeting', 'knowledge', ts(60));
    insert.run('default', 'lead', '12 new leads discovered \u2014 PJM region', 'Solar IPPs with merchant exposure, 50 MW+ capacity', JSON.stringify({ leads: [{ company: 'Apex Clean Energy', location: 'Virginia', score: 82 }, { company: 'Clearway Energy', location: 'New Jersey', score: 78 }, { company: 'NextEra Energy Partners', location: 'Pennsylvania', score: 75 }] }), 'lead_engine', 'lead-engine', ts(180));
    insert.run('default', 'in', 'Reply received: Sarah Chen, CFO at Meridian Renewables', 'Re: Behind-the-meter mining conversation', JSON.stringify({ from: 'sarah.chen@meridian-renewables.com', subject: 'Re: Behind-the-meter mining conversation', body: 'Hi,\n\nThanks for reaching out. We\'ve actually been exploring this exact concept for our West Texas sites. Would love to connect — how does Thursday at 2pm CT work?\n\nBest,\nSarah' }), 'email', 'coppice', ts(300));
    insert.run('default', 'doc', 'Ingested: Oberon Deal Memo v3', 'deal_memo \u2014 Revised energy pricing assumptions and site economics for Oberon Solar project', JSON.stringify({ summary: 'Updated deal memo incorporating revised PPA pricing at $0.042/kWh, new interconnection timeline (Q3 2026), and updated IRR projections showing 18.2% levered returns.', type: 'deal_memo', source: 'drive' }), 'knowledge', 'knowledge', ts(360));
    insert.run('default', 'out', 'Follow-up drafted for Mark Liu at GridScale Partners', 'Awaiting approval \u2014 5 days since last contact', JSON.stringify({ to: 'mliu@gridscale.com', subject: 'Re: Mining infrastructure partnership', body: 'Hi Mark,\n\nJust following up on our conversation last week about co-locating mining infrastructure at your solar sites. Happy to share the economics model we discussed.\n\nLet me know if you\'d like to reconnect.\n\nBest,\nCoppice' }), 'email', 'lead-engine', ts(420));

    console.log('Activity log: seeded 6 demo activities');
  }
}

export function insertActivity({ tenantId, type, title, subtitle, detailJson, sourceType, sourceId, agentId }) {
  // Deduplicate by source_id if provided
  if (sourceId) {
    const existing = db.prepare('SELECT id FROM activity_log WHERE source_id = ? LIMIT 1').get(sourceId);
    if (existing) return existing.id;
  }
  const result = db.prepare(
    'INSERT INTO activity_log (tenant_id, type, title, subtitle, detail_json, source_type, source_id, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(tenantId, type, title, subtitle || null, detailJson || null, sourceType || null, sourceId || null, agentId || null);
  return result.lastInsertRowid;
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

function initProcessedEmailsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_emails (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT,
      pipeline TEXT,
      tenant_id TEXT,
      processed_at TEXT DEFAULT (datetime('now'))
    )
  `);
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_processed_thread ON processed_emails(thread_id)'); } catch (e) {}
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

// ─── Auto Replies ────────────────────────────────────────────────────────────

export function initAutoRepliesTable() {
  db.exec(`
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

// ─── Tenant Email Config ─────────────────────────────────────────────────────

export function getTenantEmailConfig(tenantId) {
  const row = db.prepare('SELECT * FROM tenant_email_config WHERE tenant_id = ?').get(tenantId);
  if (!row) return null;
  return {
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    gmailRefreshToken: row.gmail_refresh_token,
  };
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

// ─── Accounting Tables ──────────────────────────────────────────────────────

export function initAccountingTables() {
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acct_inv_tenant ON accounting_invoices(tenant_id, status)'); } catch (e) {}

  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acct_bill_tenant ON accounting_bills(tenant_id, status)'); } catch (e) {}

  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_acct_pmt_tenant ON accounting_payments(tenant_id, type)'); } catch (e) {}
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
  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
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
  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
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
  sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
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

export function initPriceAlertRulesTable() {
  db.exec(`
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
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_price_alerts_tenant ON price_alert_rules(tenant_id)'); } catch (e) {}
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

export default db;
