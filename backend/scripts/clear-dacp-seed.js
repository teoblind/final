/**
 * Clear all DACP seed/demo data from the database.
 * Leaves real data (meeting transcripts from actual Recall bots) intact.
 *
 * Usage: node scripts/clear-dacp-seed.js
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '..', 'data', 'cache.db');
const TENANT = 'dacp-construction-001';

console.log(`\n=== Clearing DACP Seed Data ===`);
console.log(`Database: ${DB_PATH}`);
console.log(`Tenant:   ${TENANT}\n`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function tableExists(name) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) != null;
}

const clearTransaction = db.transaction(() => {
  // Clear fake jobs, bids, estimates, field reports
  for (const table of ['dacp_jobs', 'dacp_bid_requests', 'dacp_estimates', 'dacp_field_reports']) {
    if (!tableExists(table)) continue;
    const r = db.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).run(TENANT);
    console.log(`  ${table}: deleted ${r.changes} rows`);
  }

  // Clear seeded GC profiles (knowledge_entities) — these are fake
  if (tableExists('knowledge_entities')) {
    const r = db.prepare(`DELETE FROM knowledge_entities WHERE tenant_id = ?`).run(TENANT);
    console.log(`  knowledge_entities: deleted ${r.changes} rows`);
  }

  // Clear knowledge_links referencing DACP entities
  if (tableExists('knowledge_links') && tableExists('knowledge_entities')) {
    // Links are already orphaned after entity deletion, clean them up
    const r = db.prepare(`DELETE FROM knowledge_links WHERE entity_id NOT IN (SELECT id FROM knowledge_entities)`).run();
    console.log(`  knowledge_links: deleted ${r.changes} orphaned rows`);
  }

  // Clear seeded approval items
  if (tableExists('approval_items')) {
    const r = db.prepare(`DELETE FROM approval_items WHERE tenant_id = ?`).run(TENANT);
    console.log(`  approval_items: deleted ${r.changes} rows`);
  }

  // Clear seeded notifications
  if (tableExists('platform_notifications')) {
    const r = db.prepare(`DELETE FROM platform_notifications WHERE tenant_id = ?`).run(TENANT);
    console.log(`  platform_notifications: deleted ${r.changes} rows`);
  }

  // Clear seeded fake chat messages (keep real ones — seeded ones have IDs starting with known patterns)
  // Actually just clear all chat messages for DACP — they're all demo
  if (tableExists('chat_messages')) {
    const r = db.prepare(`DELETE FROM chat_messages WHERE tenant_id = ?`).run(TENANT);
    console.log(`  chat_messages: deleted ${r.changes} rows`);
  }

  // Keep real meeting transcripts in knowledge_entries (type='meeting' with processed=1 from Recall bots)
  // Only delete seeded ones — they have IDs like MEET-001, MEET-002, MEET-003
  if (tableExists('knowledge_entries')) {
    const r = db.prepare(`DELETE FROM knowledge_entries WHERE tenant_id = ? AND id LIKE 'MEET-%'`).run(TENANT);
    console.log(`  knowledge_entries (seeded only): deleted ${r.changes} rows`);
  }
});

clearTransaction();
console.log('\nDone. Command dashboard should now show zeros.\n');
db.close();
