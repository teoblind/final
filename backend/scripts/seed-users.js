/**
 * Seed Users Script
 *
 * Seeds Sangha + DACP users with default password, updates tenant names
 * and seat limits. Handles schema migration for multi-tenant email support.
 *
 * Usage: node scripts/seed-users.js
 */

import Database from 'better-sqlite3';
import bcryptPkg from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db = new Database(join(__dirname, '../data/cache.db'));

const DEFAULT_PASSWORD = 'Coppice2026';
const SALT_ROUNDS = 12;

// ─── Schema Migration ─────────────────────────────────────────────────────────
// SQLite can't ALTER column constraints, so we recreate the users table
// to replace UNIQUE(email) with UNIQUE(email, tenant_id) and add must_change_password.

function migrateSchema() {
  // Check if must_change_password column already exists
  const cols = db.pragma('table_info(users)');
  const hasMustChange = cols.some(c => c.name === 'must_change_password');

  // Check if the unique index is on email alone
  const indexes = db.pragma('index_list(users)');
  const emailUniqueIdx = indexes.find(idx => {
    const info = db.pragma(`index_info(${idx.name})`);
    return info.length === 1 && cols[info[0].cid]?.name === 'email';
  });

  const needsMigration = emailUniqueIdx || !hasMustChange;

  if (!needsMigration) {
    console.log('  Schema already migrated.');
    return;
  }

  console.log('  Migrating users table schema...');

  // Disable foreign keys for migration
  db.pragma('foreign_keys = OFF');

  db.exec('BEGIN TRANSACTION');
  try {
    // Create new table with correct schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS users_new (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
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

    // Copy existing data
    const existingCols = cols.map(c => c.name).join(', ');
    // Only copy columns that exist in both tables
    const safeCols = cols.map(c => c.name).filter(n =>
      ['id','email','name','password_hash','tenant_id','role','status','mfa_enabled','mfa_secret','last_login','notification_prefs_json','created_at','updated_at'].includes(n)
    ).join(', ');

    if (safeCols) {
      db.exec(`INSERT OR IGNORE INTO users_new (${safeCols}) SELECT ${safeCols} FROM users`);
    }

    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_new RENAME TO users');
    db.exec('COMMIT');
    db.pragma('foreign_keys = ON');
    console.log('  Schema migration complete.');
  } catch (err) {
    db.exec('ROLLBACK');
    db.pragma('foreign_keys = ON');
    throw err;
  }
}

// ─── Seed Data ─────────────────────────────────────────────────────────────────

const SANGHA_USERS = [
  { id: 'USR-SANGHA-01', email: 'spencer@sanghasystems.com', name: 'Spencer Marr', role: 'owner' },
  { id: 'USR-SANGHA-02', email: 'teo@zhan.capital', name: 'Teo Blind', role: 'admin' },
  { id: 'USR-SANGHA-03', email: 'mihir@sanghasystems.com', name: 'Mihir Bhangley', role: 'admin' },
  { id: 'USR-SANGHA-04', email: 'colin@sanghasystems.com', name: 'Colin Peirce', role: 'member' },
  { id: 'USR-SANGHA-05', email: 'kishan@sanghasystems.com', name: 'Kishan Sutariya', role: 'member' },
];

const DACP_USERS = [
  { id: 'USR-DACP-01', email: 'Mpineda@dacpholdings.com', name: 'Marcel Pineda', role: 'owner' },
  { id: 'USR-DACP-02', email: 'teo@zhan.capital', name: 'Teo Blind', role: 'admin' },
  { id: 'USR-DACP-03', email: 'david@dacpconstruction.com', name: 'David Castillo', role: 'member' },
];

async function main() {
  console.log('Seeding users...\n');

  // 1. Migrate schema
  console.log('[1/4] Schema migration');
  migrateSchema();

  // 2. Update tenant names and limits
  console.log('\n[2/4] Updating tenants');

  // Sangha tenant
  const sangha = db.prepare('SELECT * FROM tenants WHERE id = ?').get('default');
  if (sangha) {
    const limits = JSON.parse(sangha.limits_json || '{}');
    limits.maxUsers = 5;
    db.prepare('UPDATE tenants SET name = ?, limits_json = ? WHERE id = ?')
      .run('Sangha Renewables', JSON.stringify(limits), 'default');
    console.log('  Updated Sangha tenant: name="Sangha Renewables", maxUsers=5');
  } else {
    console.log('  WARNING: Sangha tenant (id=default) not found!');
  }

  // DACP tenant
  const dacp = db.prepare('SELECT * FROM tenants WHERE id = ?').get('dacp-construction-001');
  if (dacp) {
    const limits = JSON.parse(dacp.limits_json || '{}');
    limits.maxUsers = 3;
    db.prepare('UPDATE tenants SET limits_json = ? WHERE id = ?')
      .run(JSON.stringify(limits), 'dacp-construction-001');
    console.log('  Updated DACP tenant: maxUsers=3');
  } else {
    console.log('  WARNING: DACP tenant (id=dacp-construction-001) not found!');
  }

  // 3. Hash password
  console.log('\n[3/4] Hashing default password');
  const passwordHash = await bcryptPkg.hash(DEFAULT_PASSWORD, SALT_ROUNDS);
  console.log('  Password hashed (bcrypt, 12 rounds)');

  // 4. Seed users
  console.log('\n[4/4] Seeding users');

  const upsertUser = db.prepare(`
    INSERT INTO users (id, email, name, password_hash, tenant_id, role, status, must_change_password)
    VALUES (?, ?, ?, ?, ?, ?, 'active', 1)
    ON CONFLICT(email, tenant_id) DO UPDATE SET
      name = excluded.name,
      password_hash = excluded.password_hash,
      role = excluded.role,
      status = 'active',
      must_change_password = 1,
      updated_at = datetime('now')
  `);

  console.log('\n  Sangha Renewables (tenant: default):');
  for (const u of SANGHA_USERS) {
    // Check if user exists with this ID already
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(u.id);
    if (existing) {
      db.prepare('UPDATE users SET email = ?, name = ?, password_hash = ?, tenant_id = ?, role = ?, status = ?, must_change_password = 1, updated_at = datetime(\'now\') WHERE id = ?')
        .run(u.email, u.name, passwordHash, 'default', u.role, 'active', u.id);
    } else {
      upsertUser.run(u.id, u.email, u.name, passwordHash, 'default', u.role);
    }
    console.log(`    ${u.role.padEnd(8)} ${u.email.padEnd(35)} ${u.name}`);
  }

  console.log('\n  DACP Construction (tenant: dacp-construction-001):');
  for (const u of DACP_USERS) {
    const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(u.id);
    if (existing) {
      db.prepare('UPDATE users SET email = ?, name = ?, password_hash = ?, tenant_id = ?, role = ?, status = ?, must_change_password = 1, updated_at = datetime(\'now\') WHERE id = ?')
        .run(u.email, u.name, passwordHash, 'dacp-construction-001', u.role, 'active', u.id);
    } else {
      upsertUser.run(u.id, u.email, u.name, passwordHash, 'dacp-construction-001', u.role);
    }
    console.log(`    ${u.role.padEnd(8)} ${u.email.padEnd(35)} ${u.name}`);
  }

  // Verify
  const sanghaCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE tenant_id = 'default'").get().c;
  const dacpCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE tenant_id = 'dacp-construction-001'").get().c;

  console.log(`\nDone! Sangha: ${sanghaCount} users, DACP: ${dacpCount} users`);
  console.log('Default password: Coppice2026 (users must change on first login)');

  db.close();
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
