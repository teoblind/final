/**
 * Landing Page Routes - Demo request form handler
 *
 * POST /api/v1/demo-request - Submit demo request from coppice.ai landing page
 * GET  /api/v1/demo-request - List demo requests (admin)
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendEmail } from '../services/emailService.js';
import { getSubdomainForSlug } from '../middleware/tenantResolver.js';
import { getTenantDb, getAllTenants, getDefaultTenantId } from '../cache/database.js';

const router = express.Router();

function getDb() {
  const db = getTenantDb(getDefaultTenantId());
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_requests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      specialty TEXT,
      notes TEXT,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return db;
}

/**
 * POST /demo-request - Submit a demo request
 */
router.post('/demo-request', (req, res) => {
  try {
    const { name, company, email, phone, specialty, notes } = req.body;

    if (!name || !email || !company) {
      return res.status(400).json({ error: 'Name, email, and company are required' });
    }

    const db = getDb();
    const id = `DEMO-${Date.now()}`;

    db.prepare(`
      INSERT INTO demo_requests (id, name, company, email, phone, specialty, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, company, email, phone || null, specialty || null, notes || null);

    console.log(`New demo request: ${name} @ ${company} (${email})`);

    // Send notification email to Teo
    sendEmail({
      to: 'teo@coppice.ai',
      subject: `New Demo Request: ${name} @ ${company}`,
      body: `New demo request from coppice.ai:\n\nName: ${name}\nCompany: ${company}\nEmail: ${email}\nPhone: ${phone || 'N/A'}\nSpecialty: ${specialty || 'N/A'}\nNotes: ${notes || 'N/A'}\n\nSubmitted: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}`,
      tenantId: 'zhan-capital',
    }).catch(err => console.error('Demo notification email error:', err.message));

    res.json({ success: true, message: "Thanks! We'll be in touch within 24 hours." });
  } catch (error) {
    console.error('Demo request error:', error);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

/**
 * GET /demo-request - List all demo requests (admin use)
 */
router.get('/demo-request', authenticate, (req, res) => {
  try {
    const db = getDb();
    const requests = db.prepare('SELECT * FROM demo_requests ORDER BY created_at DESC').all();
    res.json({ count: requests.length, requests });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /auth/lookup-tenant - Find which tenant an email belongs to
 */
router.post('/auth/lookup-tenant', (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const db = getDb();

    // Look up all user records for this email across ALL tenant databases
    const allTenants = getAllTenants();
    const users = [];
    for (const tenant of allTenants) {
      try {
        const tenantDb = getTenantDb(tenant.id);
        const u = tenantDb.prepare('SELECT email, role, tenant_id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
        if (u) {
          const isAdmin = u.role && (u.role.includes('admin') || u.role === 'owner' || u.role === 'super_admin');
          const subdomain = (isAdmin && tenant.id === getDefaultTenantId()) ? 'admin' : getSubdomainForSlug(tenant.slug);
          const displayName = (isAdmin && tenant.id === getDefaultTenantId()) ? 'Platform Admin' : tenant.name;
          users.push({ slug: subdomain, name: displayName, id: tenant.id, role: u.role });
        }
      } catch (e) { /* tenant DB may not have users table */ }
    }

    if (users.length > 1) {
      return res.json({ tenants: users });
    }
    if (users.length === 1) {
      return res.json({ tenant_slug: users[0].slug, tenant_name: users[0].name });
    }

    // Fallback: match by email domain
    const domain = email.split('@')[1]?.toLowerCase();
    if (domain) {
      const domainMap = {
        'dacpholdings.com': { slug: 'dacp', name: 'DACP Construction' },
        'dacpconstruction.com': { slug: 'dacp', name: 'DACP Construction' },
        'sanghasystems.com': { slug: 'sangha', name: 'Sangha Renewables' },
        'sangharenewables.com': { slug: 'sangha', name: 'Sangha Renewables' },
      };

      if (domainMap[domain]) {
        return res.json({ tenant_slug: domainMap[domain].slug, tenant_name: domainMap[domain].name });
      }
    }

    return res.json({ tenant_slug: null });
  } catch (error) {
    console.error('Tenant lookup error:', error);
    return res.json({ tenant_slug: null });
  }
});

export default router;
