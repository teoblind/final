import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TENANT_ID = 'dacp-construction-001';

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(join(__dirname, filename), 'utf-8'));
}

export function seedDacpData(db) {
  const pricing = loadJson('pricing_master.json');
  const jobs = loadJson('jobs_history.json');
  const bidRequests = loadJson('bid_requests_inbox.json');
  const fieldLogs = loadJson('field_logs.json');

  // Seed pricing
  const insertPricing = db.prepare(`
    INSERT OR IGNORE INTO dacp_pricing (id, tenant_id, category, item, unit, material_cost, labor_cost, equipment_cost, unit_price, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const p of pricing) {
    insertPricing.run(p.id, TENANT_ID, p.category, p.item, p.unit, p.material_cost, p.labor_cost, p.equipment_cost, p.unit_price, p.notes);
  }
  console.log(`DACP: Seeded ${pricing.length} pricing items`);

  // Seed jobs
  const insertJob = db.prepare(`
    INSERT OR IGNORE INTO dacp_jobs (id, tenant_id, estimate_id, project_name, gc_name, project_type, location, status, estimated_cost, actual_cost, bid_amount, margin_pct, start_date, end_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const j of jobs) {
    insertJob.run(j.id, TENANT_ID, null, j.project_name, j.gc_name, j.project_type, j.location, j.status, j.estimated_cost, j.actual_cost, j.bid_amount, j.margin_pct, j.start_date, j.end_date, j.notes);
  }
  console.log(`DACP: Seeded ${jobs.length} jobs`);

  // Seed bid requests
  const insertBid = db.prepare(`
    INSERT OR IGNORE INTO dacp_bid_requests (id, tenant_id, from_email, from_name, gc_name, subject, body, attachments_json, scope_json, due_date, status, urgency, missing_info_json, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const b of bidRequests) {
    insertBid.run(b.id, TENANT_ID, b.from_email, b.from_name, b.gc_name, b.subject, b.body,
      JSON.stringify(b.attachments), JSON.stringify(b.scope), b.due_date, b.status, b.urgency,
      JSON.stringify(b.missing_info), b.received_at);
  }
  console.log(`DACP: Seeded ${bidRequests.length} bid requests`);

  // Seed field reports
  const insertReport = db.prepare(`
    INSERT OR IGNORE INTO dacp_field_reports (id, tenant_id, job_id, date, reported_by, work_json, materials_json, labor_json, equipment_json, weather, notes, issues_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const f of fieldLogs) {
    insertReport.run(f.id, TENANT_ID, f.job_id, f.date, f.reported_by,
      JSON.stringify(f.work_performed), JSON.stringify(f.materials_used),
      JSON.stringify(f.labor), JSON.stringify(f.equipment),
      f.weather, f.notes, JSON.stringify(f.issues));
  }
  console.log(`DACP: Seeded ${fieldLogs.length} field reports`);
}
