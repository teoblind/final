import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dataDir = join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(join(dataDir, 'cache.db'));

export function initDatabase() {
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
}

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
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      role TEXT NOT NULL DEFAULT 'viewer',
      status TEXT NOT NULL DEFAULT 'invited',
      mfa_enabled INTEGER DEFAULT 0,
      mfa_secret TEXT,
      last_login DATETIME,
      notification_prefs_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
      INSERT INTO tenants (id, name, slug, plan, status, limits_json)
      VALUES ('default', 'Default Organization', 'default', 'professional', 'active', ?)
    `).run(JSON.stringify({
      maxUsers: 50,
      maxSites: 10,
      maxWorkloads: 100,
      maxAgents: 20,
      apiRateLimit: 120,
      dataRetentionDays: 365
    }));
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

export function getAllTenants() {
  return db.prepare('SELECT * FROM tenants ORDER BY created_at').all().map(row => ({
    ...row,
    branding: row.branding_json ? JSON.parse(row.branding_json) : null,
    settings: row.settings_json ? JSON.parse(row.settings_json) : null,
    limits: row.limits_json ? JSON.parse(row.limits_json) : null,
  }));
}

export function createTenant(tenant) {
  return db.prepare(`
    INSERT INTO tenants (id, name, slug, plan, status, branding_json, settings_json, limits_json, trial_ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tenant.id, tenant.name, tenant.slug,
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
  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.slug !== undefined) { sets.push('slug = ?'); params.push(updates.slug); }
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
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
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

export default db;
