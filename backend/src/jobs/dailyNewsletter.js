/**
 * Daily Intelligence Newsletter
 *
 * Runs each morning per tenant. Performs web research for industry-specific
 * intelligence (new projects, GC activity, market news), then emails a
 * formatted HTML digest to all tenant users.
 *
 * Architecture:
 *  1. Build search queries from tenant context (GC names, service areas, region)
 *  2. Run web_research (Perplexity) for each query
 *  3. Send results to Claude to analyze, score relevance, and format
 *  4. Email HTML newsletter to tenant users
 *  5. Store newsletter in knowledge_entries for dashboard display
 */

import { randomUUID } from 'crypto';
import {
  getAllTenants, runWithTenant, getUsersByTenant,
  getDacpBidRequests, getDacpJobs, getDacpStats, getTenantDb,
} from '../cache/database.js';

let timer = null;

// ── Tenant-specific search config ─────────────────────────────────────────────

const TENANT_SEARCH_CONFIG = {
  'dacp-construction-001': {
    name: 'DACP Construction',
    region: 'Dallas-Fort Worth Texas',
    services: ['concrete', 'masonry', 'foundations', 'flatwork', 'structural concrete', 'site work', 'asphalt', 'paving'],
    searchQueries: [
      'new commercial construction projects awarded {region} this week',
      'data center construction projects Texas general contractor awarded 2026',
      'large commercial construction projects breaking ground {region}',
      '{region} construction bid opportunities concrete masonry',
      'general contractor awarded new project Texas commercial industrial',
      'construction industry news Texas DFW infrastructure',
    ],
    linkedinQueries: [
      'site:linkedin.com construction project awarded Texas this week',
      'site:linkedin.com general contractor new project DFW concrete',
      'site:linkedin.com data center construction Texas groundbreaking',
    ],
  },
  // Default config for other tenants
  default: {
    name: 'Coppice',
    region: '',
    services: [],
    searchQueries: [
      'AI automation business news this week',
      'construction technology industry trends 2026',
    ],
    linkedinQueries: [],
  },
};

function getTenantConfig(tenantId) {
  return TENANT_SEARCH_CONFIG[tenantId] || TENANT_SEARCH_CONFIG.default;
}

// ── Web Research ──────────────────────────────────────────────────────────────

async function searchWeb(query, focus = 'news') {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          { role: 'system', content: 'You are a research assistant. Return factual, concise findings with specific names, numbers, and dates. Focus on the most recent and relevant results.' },
          { role: 'user', content: query },
        ],
        max_tokens: 1500,
      }),
    });

    if (!res.ok) {
      console.warn(`[Newsletter] Perplexity error ${res.status} for: ${query.slice(0, 60)}`);
      return null;
    }

    const data = await res.json();
    return {
      query,
      answer: data.choices?.[0]?.message?.content || '',
      citations: data.citations || [],
    };
  } catch (err) {
    console.warn(`[Newsletter] Search failed for: ${query.slice(0, 60)}`, err.message);
    return null;
  }
}

async function gatherIntelligence(tenantId) {
  const config = getTenantConfig(tenantId);
  const results = [];

  // Replace {region} placeholder in queries
  const allQueries = [
    ...config.searchQueries.map(q => q.replace(/\{region\}/g, config.region)),
    ...config.linkedinQueries,
  ];

  // Run searches in parallel (max 4 concurrent to avoid rate limits)
  const batchSize = 4;
  for (let i = 0; i < allQueries.length; i += batchSize) {
    const batch = allQueries.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(q => searchWeb(q, 'news')));
    results.push(...batchResults.filter(Boolean));

    // Small delay between batches
    if (i + batchSize < allQueries.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return results;
}

// ── Newsletter Generation via Claude ──────────────────────────────────────────

async function generateNewsletter(tenantId, searchResults, businessContext) {
  const config = getTenantConfig(tenantId);
  const { tunnelPrompt } = await import('../services/cliTunnel.js');

  const prompt = `You are writing a daily intelligence newsletter for ${config.name}, a construction subcontractor specializing in ${config.services.join(', ')} in ${config.region}.

WEB RESEARCH RESULTS (gathered this morning):
${searchResults.map((r, i) => `--- Research ${i + 1}: "${r.query}" ---\n${r.answer}\n${r.citations?.length ? 'Sources: ' + r.citations.join(', ') : ''}`).join('\n\n')}

CURRENT BUSINESS STATE:
${JSON.stringify(businessContext, null, 2)}

Write a morning intelligence briefing newsletter. Structure it as clean HTML (no <html>/<body> tags, just the content).

SECTIONS (include only sections with actual findings):

1. **NEW PROJECT OPPORTUNITIES** - Projects where ${config.name} could bid. Include: project name, location, estimated value if known, GC(s) involved, why it's relevant. Flag if a GC is one they've worked with before.

2. **GC ACTIVITY** - News about general contractors active in ${config.region}. New hires, project awards, expansions. Focus on GCs relevant to ${config.name}'s services.

3. **MARKET INTELLIGENCE** - Material pricing trends, labor market, regulatory changes, infrastructure spending that affects the business.

4. **LINKEDIN HIGHLIGHTS** - Interesting posts or announcements from construction industry professionals (if any LinkedIn results were found).

5. **RECOMMENDED ACTIONS** - 2-3 specific actions based on the findings. E.g., "Reach out to JE Dunn about the Meta El Paso project - they'll need concrete subs for a 1.2M sqft data center."

FORMATTING RULES:
- Use clean, professional HTML with inline styles
- Use a navy (#1e3a5f) and white color scheme
- Keep it scannable - short paragraphs, bullet points
- Bold key names (GCs, project names, dollar amounts)
- Each opportunity should feel actionable, not just informational
- If no results for a section, omit it entirely
- Target length: 500-800 words
- Do NOT use em dashes, use regular hyphens

Return ONLY the HTML content, no markdown wrapping.`;

  const response = await tunnelPrompt({
    tenantId,
    agentId: 'hivemind',
    prompt,
    maxTurns: 30,
    timeoutMs: 300_000,
    label: 'Daily Newsletter',
  });

  // Clean up - remove markdown code fences if present
  return response.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '').trim();
}

// ── Email Delivery ────────────────────────────────────────────────────────────

function buildEmailHtml(newsletterHtml, tenantName, date) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:24px;">
  <!-- Header -->
  <div style="background:#1e3a5f;color:white;padding:20px 24px;border-radius:12px 12px 0 0;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;opacity:0.7;margin-bottom:4px;">Coppice Daily Intelligence</div>
    <div style="font-size:20px;font-weight:600;">${tenantName} - Morning Briefing</div>
    <div style="font-size:12px;opacity:0.6;margin-top:4px;">${date}</div>
  </div>
  <!-- Body -->
  <div style="background:white;padding:24px;border:1px solid #e8e6e1;border-top:none;border-radius:0 0 12px 12px;font-size:14px;line-height:1.7;color:#2d2d2d;">
    ${newsletterHtml}
  </div>
  <!-- Footer -->
  <div style="text-align:center;padding:16px;font-size:11px;color:#9a9a92;">
    Generated by Coppice AI - Your autonomous business intelligence agent
  </div>
</div>
</body>
</html>`;
}

async function deliverNewsletter(tenantId, html, recipients) {
  const { sendHtmlEmail } = await import('../services/emailService.js');
  const config = getTenantConfig(tenantId);
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const fullHtml = buildEmailHtml(html, config.name, date);

  for (const email of recipients) {
    try {
      await sendHtmlEmail({
        to: email,
        subject: `${config.name} Daily Intelligence - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
        html: fullHtml,
        tenantId,
        skipSignature: true,
      });
      console.log(`[Newsletter] Sent to ${email}`);
    } catch (err) {
      console.error(`[Newsletter] Failed to send to ${email}:`, err.message);
    }
  }
}

// ── Storage (for dashboard display) ───────────────────────────────────────────

function storeNewsletter(tenantId, html, searchResults) {
  try {
    const db = getTenantDb(tenantId);
    const id = `newsletter-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`;
    db.prepare(`
      INSERT OR REPLACE INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, processed, created_at)
      VALUES (?, ?, 'newsletter', ?, ?, 'daily-newsletter', 'coppice-newsletter', 1, datetime('now'))
    `).run(
      id,
      tenantId,
      `Daily Intelligence - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
      html,
    );
    console.log(`[Newsletter] Stored as ${id}`);
  } catch (err) {
    console.warn(`[Newsletter] Storage failed:`, err.message);
  }
}

// ── Main Job ──────────────────────────────────────────────────────────────────

async function runDailyNewsletter() {
  const tenants = getAllTenants();

  for (const tenant of tenants) {
    try {
      await runWithTenant(tenant.id, async () => {
        console.log(`[Newsletter] Running for tenant: ${tenant.id}`);

        // Check if tenant has newsletter-worthy data
        const config = getTenantConfig(tenant.id);
        if (config === TENANT_SEARCH_CONFIG.default && !config.searchQueries.length) {
          console.log(`[Newsletter] Skipping ${tenant.id} - no search config`);
          return;
        }

        // Get recipients (all tenant users with email)
        const users = getUsersByTenant(tenant.id);
        const recipients = users.map(u => u.email).filter(Boolean);
        if (recipients.length === 0) {
          console.log(`[Newsletter] Skipping ${tenant.id} - no recipients`);
          return;
        }

        // Gather business context for relevance scoring
        let businessContext = {};
        try {
          const stats = getDacpStats(tenant.id);
          const bids = getDacpBidRequests(tenant.id);
          const jobs = getDacpJobs(tenant.id);
          const gcNames = [...new Set(bids.map(b => b.gc_name).filter(Boolean))];
          businessContext = {
            totalBids: stats?.totalBidRequests || 0,
            activeJobs: jobs.filter(j => j.status === 'active').length,
            knownGCs: gcNames.slice(0, 20),
            recentProjects: bids.slice(0, 10).map(b => b.project_name).filter(Boolean),
          };
        } catch {}

        // Step 1: Web research
        console.log(`[Newsletter] Searching web for ${tenant.id}...`);
        const searchResults = await gatherIntelligence(tenant.id);
        if (searchResults.length === 0) {
          console.log(`[Newsletter] No search results for ${tenant.id} - skipping`);
          return;
        }
        console.log(`[Newsletter] Got ${searchResults.length} research results`);

        // Step 2: Generate newsletter via Claude
        console.log(`[Newsletter] Generating newsletter for ${tenant.id}...`);
        const newsletterHtml = await generateNewsletter(tenant.id, searchResults, businessContext);
        if (!newsletterHtml || newsletterHtml.length < 100) {
          console.log(`[Newsletter] Generation failed or empty for ${tenant.id}`);
          return;
        }

        // Step 3: Store for dashboard
        storeNewsletter(tenant.id, newsletterHtml, searchResults);

        // Step 4: Email to all users
        console.log(`[Newsletter] Sending to ${recipients.length} recipients...`);
        await deliverNewsletter(tenant.id, newsletterHtml, recipients);

        console.log(`[Newsletter] Complete for ${tenant.id}`);
      });
    } catch (err) {
      console.error(`[Newsletter] Error for ${tenant.id}:`, err.message);
    }
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startDailyNewsletter({ runAtHour = 6, intervalHours = 24 } = {}) {
  if (timer) {
    console.log('[Newsletter] Already running');
    return;
  }

  const intervalMs = intervalHours * 3600000;

  // Calculate delay until next run
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(runAtHour, 0, 0, 0);
  if (nextRun <= now) nextRun.setDate(nextRun.getDate() + 1);
  const delay = nextRun - now;

  console.log(`[Newsletter] Scheduled - next run at ${nextRun.toISOString()} (in ${Math.round(delay / 60000)}m)`);

  setTimeout(() => {
    runDailyNewsletter().catch(err => console.error('[Newsletter] Error:', err.message));

    timer = setInterval(() => {
      runDailyNewsletter().catch(err => console.error('[Newsletter] Error:', err.message));
    }, intervalMs);
  }, delay);
}

export function stopDailyNewsletter() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Newsletter] Stopped');
  }
}

export { runDailyNewsletter };
