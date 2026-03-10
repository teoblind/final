/**
 * Seed Sangha tenant files from Google Drive manifest.
 * Run: node seed-sangha-files.js
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const db = new Database(join(__dirname, 'data/cache.db'));

// Create table if not exists
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

// Load manifest
const manifestPath = join(homedir(), 'sangha_file_manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function getFileType(name, mime) {
  const nameLower = name.toLowerCase();
  if (nameLower.endsWith('.pptx') || mime.includes('presentation')) return 'pptx';
  if (nameLower.endsWith('.xlsx') || mime.includes('spreadsheet')) return 'xlsx';
  if (nameLower.endsWith('.docx') || mime.includes('document')) return 'docx';
  if (nameLower.endsWith('.pdf')) return 'pdf';
  if (nameLower.endsWith('.csv')) return 'csv';
  return 'other';
}

// Also add the 4 unmatched files manually (we know their Drive IDs don't resolve but we have the local files)
const MANUAL_FILES = [
  {
    name: 'Pricing Tool Methodology',
    category: 'Financial',
    file_type: 'pdf',
    modified_at: '2025-09-03',
  },
  {
    name: 'Hash Price, Energy Costs, & DCF Analysis',
    category: 'Models & Analysis',
    file_type: 'pdf',
    modified_at: '2025-07-28',
  },
  {
    name: 'Multivariate Sensitivity Analysis + Trading Strategy',
    category: 'Models & Analysis',
    file_type: 'pdf',
    modified_at: '2025-07-29',
  },
  {
    name: 'Triple Turbo Treasury Strategy',
    category: 'Strategy',
    file_type: 'pdf',
    modified_at: '2025-01-01',
  },
];

const insert = db.prepare(`
  INSERT OR REPLACE INTO tenant_files (id, tenant_id, name, category, file_type, size_bytes, modified_at, drive_file_id, drive_url)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertMany = db.transaction(() => {
  let count = 0;

  for (const f of manifest) {
    const fileType = getFileType(f.name, f.mime);
    const modifiedAt = f.modified ? f.modified.slice(0, 10) : '';

    insert.run(
      `SF-${f.drive_id.slice(0, 12)}`,
      'default',  // Sangha is the default tenant
      f.name,
      f.category,
      fileType,
      f.size || 0,
      modifiedAt,
      f.drive_id,
      f.drive_url,
    );
    count++;
  }

  // Add manual files (no Drive URL — they'll show without the Drive badge)
  for (const mf of MANUAL_FILES) {
    const id = `SF-manual-${mf.name.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '')}`;
    insert.run(
      id,
      'default',
      mf.name,
      mf.category,
      mf.file_type,
      0,
      mf.modified_at,
      null,
      null,
    );
    count++;
  }

  return count;
});

const count = insertMany();
console.log(`Seeded ${count} files for Sangha tenant (default)`);

// Print summary
const categories = db.prepare(
  'SELECT category, COUNT(*) as count FROM tenant_files WHERE tenant_id = ? GROUP BY category ORDER BY count DESC'
).all('default');

console.log('\nBy category:');
for (const cat of categories) {
  console.log(`  ${cat.category}: ${cat.count} files`);
}

const total = db.prepare('SELECT COUNT(*) as count FROM tenant_files WHERE tenant_id = ?').get('default');
console.log(`\nTotal: ${total.count} files`);

db.close();
