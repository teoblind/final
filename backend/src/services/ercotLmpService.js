/**
 * ERCOT LMP Service - DuckDB Parquet Backend
 *
 * Queries 200M+ rows of ERCOT settlement point price data stored as
 * Hive-partitioned Parquet files (year=YYYY/month=M/*.parquet).
 *
 * Schema:
 *   timestamp (datetime), settlement_point (string), settlement_type (string),
 *   node_type (string: hub|load_zone|resource_node), lmp (float64),
 *   energy_component, congestion_component, loss_component, year, month
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const duckdb = require('duckdb');

const DATA_PATH = process.env.ERCOT_PARQUET_PATH || '/Users/teoblind/Desktop/ERCOT_All_Nodes';

// Singleton DuckDB connection
let db = null;

function getDb() {
  if (!db) {
    db = new duckdb.Database(':memory:');
  }
  return db;
}

function coerceBigInts(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return Number(obj);
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(coerceBigInts);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = coerceBigInts(v);
    return out;
  }
  return obj;
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, ...params, (err, rows) => {
      if (err) reject(err);
      else resolve(coerceBigInts(rows));
    });
  });
}

// Build glob path for a date range - only read necessary monthly partitions
function buildGlob(startDate, endDate) {
  if (!startDate && !endDate) {
    return `'${DATA_PATH}/year=*/month=*/*.parquet'`;
  }
  const start = startDate ? new Date(startDate) : new Date('2014-01-01');
  const end = endDate ? new Date(endDate) : new Date();
  const paths = [];
  const d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= end) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    paths.push(`'${DATA_PATH}/year=${y}/month=${m}/*.parquet'`);
    d.setMonth(d.getMonth() + 1);
  }
  if (paths.length === 0) {
    return `'${DATA_PATH}/year=${end.getFullYear()}/month=${end.getMonth() + 1}/*.parquet'`;
  }
  if (paths.length === 1) return paths[0];
  return `[${paths.join(', ')}]`;
}

// Current month glob for fast "latest" queries
function currentMonthGlob() {
  const now = new Date();
  return `'${DATA_PATH}/year=${now.getFullYear()}/month=${now.getMonth() + 1}/*.parquet'`;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Get the most recent LMP for a settlement point.
 */
export async function getCurrentLmp(node = 'HB_NORTH') {
  const glob = currentMonthGlob();
  const rows = await query(`
    SELECT settlement_point, lmp, timestamp, node_type
    FROM read_parquet(${glob}, hive_partitioning=true)
    WHERE settlement_point = ?
    ORDER BY timestamp DESC
    LIMIT 2
  `, [node]);

  if (rows.length === 0) return null;

  const current = rows[0];
  const prev = rows[1] || null;
  const change5m = prev ? Math.round((current.lmp - prev.lmp) * 100) / 100 : 0;

  // Get today's stats
  const ts = current.timestamp instanceof Date ? current.timestamp : new Date(current.timestamp);
  const todayStr = ts.toISOString().split('T')[0];
  const todayStart = `${todayStr}T00:00:00Z`;
  const todayEnd = `${todayStr}T23:59:59Z`;
  const todayStats = await query(`
    SELECT
      AVG(lmp) as avg_lmp,
      MAX(lmp) as peak_lmp,
      MIN(lmp) as trough_lmp,
      COUNT(*) as intervals
    FROM read_parquet(${glob}, hive_partitioning=true)
    WHERE settlement_point = ?
    AND timestamp >= ?
    AND timestamp <= ?
  `, [node, todayStart, todayEnd]);
  // Get peak time separately
  const peakRows = await query(`
    SELECT timestamp as peak_time
    FROM read_parquet(${glob}, hive_partitioning=true)
    WHERE settlement_point = ?
    AND timestamp >= ? AND timestamp <= ?
    ORDER BY lmp DESC
    LIMIT 1
  `, [node, todayStart, todayEnd]);

  const stats = todayStats[0] || {};
  const peakTime = peakRows[0]?.peak_time || null;

  return {
    node: current.settlement_point,
    nodeType: current.node_type,
    timestamp: current.timestamp,
    lmp: Math.round(current.lmp * 100) / 100,
    change5m,
    todayAvg: stats.avg_lmp ? Math.round(stats.avg_lmp * 100) / 100 : null,
    todayPeak: stats.peak_lmp ? Math.round(stats.peak_lmp * 100) / 100 : null,
    todayTrough: stats.trough_lmp ? Math.round(stats.trough_lmp * 100) / 100 : null,
    todayPeakTime: peakTime,
    intervals: stats.intervals || 0,
  };
}

/**
 * Get all 5-min intervals for a given date (intraday chart).
 */
export async function getIntraday(node = 'HB_NORTH', date = null) {
  let targetDate = date || new Date().toISOString().split('T')[0];
  let d = new Date(targetDate);
  let glob = buildGlob(
    new Date(d.getFullYear(), d.getMonth(), 1),
    new Date(d.getFullYear(), d.getMonth() + 1, 0)
  );

  let dayStart = `${targetDate}T00:00:00Z`;
  let dayEnd = `${targetDate}T23:59:59Z`;
  let rows = await query(`
    SELECT timestamp, lmp
    FROM read_parquet(${glob}, hive_partitioning=true)
    WHERE settlement_point = ?
    AND timestamp >= ?
    AND timestamp <= ?
    ORDER BY timestamp
  `, [node, dayStart, dayEnd]);

  // If no data for requested date, fall back to latest available date
  if (rows.length === 0 && !date) {
    const latestGlob = currentMonthGlob();
    const latestRows = await query(`
      SELECT STRFTIME(MAX(timestamp), '%Y-%m-%d') as latest_date
      FROM read_parquet(${latestGlob}, hive_partitioning=true)
      WHERE settlement_point = ?
    `, [node]);
    const latestDate = latestRows[0]?.latest_date;
    if (latestDate) {
      targetDate = latestDate;
      dayStart = `${targetDate}T00:00:00Z`;
      dayEnd = `${targetDate}T23:59:59Z`;
      rows = await query(`
        SELECT timestamp, lmp
        FROM read_parquet(${latestGlob}, hive_partitioning=true)
        WHERE settlement_point = ?
        AND timestamp >= ?
        AND timestamp <= ?
        ORDER BY timestamp
      `, [node, dayStart, dayEnd]);
    }
  }

  return {
    date: targetDate,
    intervals: rows.map(r => ({
      timestamp: r.timestamp,
      lmp: Math.round(r.lmp * 100) / 100,
    })),
  };
}

/**
 * Get hourly average LMPs for a date range (heatmap).
 */
export async function getHeatmap(node = 'HB_NORTH', days = 7) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const glob = buildGlob(start, end);

  const rows = await query(`
    SELECT
      STRFTIME(timestamp, '%Y-%m-%d') as date,
      EXTRACT(HOUR FROM timestamp) as hour,
      AVG(lmp) as avg_lmp,
      MIN(lmp) as min_lmp,
      MAX(lmp) as max_lmp,
      COUNT(*) as intervals
    FROM read_parquet(${glob}, hive_partitioning=true)
    WHERE settlement_point = ?
    AND timestamp >= ?
    AND timestamp <= ?
    GROUP BY STRFTIME(timestamp, '%Y-%m-%d'), EXTRACT(HOUR FROM timestamp)
    ORDER BY date, hour
  `, [node, start.toISOString(), end.toISOString()]);

  return rows.map(r => ({
    date: r.date,
    hour: Number(r.hour),
    avgLmp: Math.round(r.avg_lmp * 100) / 100,
    minLmp: Math.round(r.min_lmp * 100) / 100,
    maxLmp: Math.round(r.max_lmp * 100) / 100,
    intervals: r.intervals,
  }));
}

/**
 * Get summary statistics for a node over a period.
 */
export async function getStats(node = 'HB_NORTH', days = 30) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const glob = buildGlob(start, end);

  const rows = await query(`
    SELECT
      AVG(lmp) as avg_lmp,
      MEDIAN(lmp) as median_lmp,
      MAX(lmp) as peak_lmp,
      MIN(lmp) as trough_lmp,
      STDDEV(lmp) as std_dev,
      COUNT(*) as data_points,
      SUM(CASE WHEN lmp < 0 THEN 1 ELSE 0 END) as negative_intervals
    FROM read_parquet(${glob}, hive_partitioning=true)
    WHERE settlement_point = ?
    AND timestamp >= ?
    AND timestamp <= ?
  `, [node, start.toISOString(), end.toISOString()]);

  const r = rows[0] || {};

  // Count hours above breakevens
  const beRows = await query(`
    SELECT
      SUM(CASE WHEN avg_lmp > 41.30 THEN 1 ELSE 0 END) as hours_above_fleet_be,
      SUM(CASE WHEN avg_lmp > 52.10 THEN 1 ELSE 0 END) as hours_above_s19_be
    FROM (
      SELECT
        STRFTIME(timestamp, '%Y-%m-%d') as d,
        EXTRACT(HOUR FROM timestamp) as h,
        AVG(lmp) as avg_lmp
      FROM read_parquet(${glob}, hive_partitioning=true)
      WHERE settlement_point = ?
      AND timestamp >= ?
      AND timestamp <= ?
      GROUP BY STRFTIME(timestamp, '%Y-%m-%d'), EXTRACT(HOUR FROM timestamp)
    )
  `, [node, start.toISOString(), end.toISOString()]);

  const be = beRows[0] || {};
  const negHours = Math.round((r.negative_intervals || 0) / 12); // 12 intervals per hour

  return {
    avg: r.avg_lmp ? Math.round(r.avg_lmp * 100) / 100 : null,
    median: r.median_lmp ? Math.round(r.median_lmp * 100) / 100 : null,
    peak: r.peak_lmp ? Math.round(r.peak_lmp * 100) / 100 : null,
    trough: r.trough_lmp ? Math.round(r.trough_lmp * 100) / 100 : null,
    stdDev: r.std_dev ? Math.round(r.std_dev * 100) / 100 : null,
    dataPoints: r.data_points || 0,
    negativeHours: negHours,
    hoursAboveFleetBE: be.hours_above_fleet_be || 0,
    hoursAboveS19BE: be.hours_above_s19_be || 0,
  };
}

/**
 * Get current LMP for multiple settlement points.
 */
export async function getNodes(filter = null) {
  const glob = currentMonthGlob();

  let whereClause = '';
  if (filter === 'hubs') {
    whereClause = "AND node_type = 'hub'";
  } else if (filter === 'load_zones') {
    whereClause = "AND node_type = 'load_zone'";
  } else {
    whereClause = "AND node_type IN ('hub', 'load_zone')";
  }

  // Get latest timestamp first
  const latestRows = await query(`
    SELECT MAX(timestamp) as latest
    FROM read_parquet(${glob}, hive_partitioning=true)
    WHERE node_type IN ('hub', 'load_zone')
  `);
  const latest = latestRows[0]?.latest;
  if (!latest) return [];

  const latestDate = new Date(latest).toISOString().split('T')[0];
  const h24ago = new Date(new Date(latest) - 24 * 60 * 60 * 1000).toISOString();

  const rows = await query(`
    WITH current_prices AS (
      SELECT settlement_point, lmp, node_type
      FROM read_parquet(${glob}, hive_partitioning=true)
      WHERE timestamp = ? ${whereClause}
    ),
    daily_stats AS (
      SELECT
        settlement_point,
        AVG(lmp) as avg_24h,
        MAX(lmp) as peak_24h,
        SUM(CASE WHEN lmp < 0 THEN 1 ELSE 0 END) / 12 as neg_hours
      FROM read_parquet(${glob}, hive_partitioning=true)
      WHERE timestamp >= ? ${whereClause}
      GROUP BY settlement_point
    )
    SELECT
      c.settlement_point as node,
      c.node_type,
      ROUND(c.lmp, 2) as current_lmp,
      ROUND(d.avg_24h, 2) as avg_24h,
      ROUND(d.peak_24h, 2) as peak_24h,
      COALESCE(d.neg_hours, 0) as neg_hours
    FROM current_prices c
    LEFT JOIN daily_stats d ON c.settlement_point = d.settlement_point
    ORDER BY c.node_type, c.settlement_point
  `, [latest, h24ago]);

  return rows;
}

/**
 * Get available date range across all parquet files.
 */
export async function getDataRange() {
  const glob = `'${DATA_PATH}/year=*/month=*/*.parquet'`;
  const rows = await query(`
    SELECT
      MIN(year) as min_year,
      MAX(year) as max_year,
      COUNT(DISTINCT year || '-' || month) as total_months
    FROM read_parquet(${glob}, hive_partitioning=true)
    LIMIT 1
  `);
  return rows[0] || {};
}

/**
 * Get historical intraday data for a date range (for 7D/30D chart views).
 */
export async function getHistoricalIntraday(node = 'HB_NORTH', days = 7) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  const glob = buildGlob(start, end);

  // For multi-day views, return hourly averages to keep payload manageable
  const rows = await query(`
    SELECT
      date_trunc('hour', timestamp) as timestamp,
      AVG(lmp) as lmp,
      MIN(lmp) as min_lmp,
      MAX(lmp) as max_lmp
    FROM read_parquet(${glob}, hive_partitioning=true)
    WHERE settlement_point = ?
    AND timestamp >= ?
    AND timestamp <= ?
    GROUP BY date_trunc('hour', timestamp)
    ORDER BY timestamp
  `, [node, start.toISOString(), end.toISOString()]);

  return rows.map(r => ({
    timestamp: r.timestamp,
    lmp: Math.round(r.lmp * 100) / 100,
    minLmp: Math.round(r.min_lmp * 100) / 100,
    maxLmp: Math.round(r.max_lmp * 100) / 100,
  }));
}
