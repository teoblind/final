#!/usr/bin/env node
/**
 * Regenerate missing PDF/DOC files for completed assignments.
 * Usage: node scripts/regen_pdfs.js [--tenant <id>]
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateReport } from '../src/services/documentService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const tenantId = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : 'dacp-construction-001';
const tenantDir = tenantId;

const DB_PATH = join(__dirname, '..', 'data', tenantDir, `${tenantDir}.db`);
console.log(`DB: ${DB_PATH}\nTenant: ${tenantId}\n`);

const db = new Database(DB_PATH);

const rows = db.prepare(`
  SELECT id, title, full_response, output_artifacts_json, category, agent_id
  FROM agent_assignments
  WHERE status = 'completed' AND full_response IS NOT NULL AND length(full_response) > 100
`).all();

console.log(`Found ${rows.length} completed assignments with content\n`);

let regenerated = 0;

for (const r of rows) {
  const arts = JSON.parse(r.output_artifacts_json || '[]');
  const hasPdf = arts.some(a => a.type === 'pdf' && a.filename);

  // Check if files exist on disk
  const pdfArt = arts.find(a => a.type === 'pdf');
  const docDir = join(__dirname, '..', 'data', 'generated-docs');
  const { existsSync } = await import('fs');

  const pdfExists = pdfArt?.filename && existsSync(join(docDir, pdfArt.filename));

  if (pdfExists) {
    console.log(`SKIP ${r.id} | ${r.title.slice(0, 50)} (PDF exists)`);
    continue;
  }

  console.log(`REGEN ${r.id} | ${r.title.slice(0, 60)}`);

  try {
    const report = await generateReport({
      title: r.title,
      content: r.full_response,
      tenantName: 'DACP Construction',
      agentName: 'DACP Agent',
      agentLabel: 'DACP Construction - Estimating',
      assignmentId: r.id,
      tenantId,
    });

    // Keep non-pdf/docx artifacts (like gdoc links), replace pdf/docx
    const kept = arts.filter(a => a.type !== 'pdf' && a.type !== 'docx');
    const newArts = [...kept, ...report.artifacts];

    db.prepare('UPDATE agent_assignments SET output_artifacts_json = ? WHERE id = ?')
      .run(JSON.stringify(newArts), r.id);

    console.log(`  -> Generated: ${report.artifacts.map(a => a.type).join(', ')}`);
    regenerated++;
  } catch (err) {
    console.error(`  -> FAILED: ${err.message}`);
  }
}

db.close();
console.log(`\nDone. Regenerated ${regenerated}/${rows.length} assignments.`);
