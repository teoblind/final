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

  console.log('Database initialized');
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

// Grid events helper (used by curtailment engine)
export function getGridEvents(iso = 'ERCOT', days = 1) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  try {
    return db.prepare(`
      SELECT * FROM grid_events WHERE iso = ? AND timestamp >= ? ORDER BY timestamp DESC
    `).all(iso, since);
  } catch (e) {
    // grid_events table may not exist yet
    return [];
  }
}

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

export default db;
