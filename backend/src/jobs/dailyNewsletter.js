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
 *  3. Extract mentioned contacts and verify via Apollo.io bulk_match
 *  4. Send results + verification data to Claude to analyze, score, and format
 *  5. Email HTML newsletter to tenant users
 *  6. Store newsletter in knowledge_entries for dashboard display
 */

import { randomUUID } from 'crypto';
import {
  getAllTenants, runWithTenant, getUsersByTenant,
  getDacpBidRequests, getDacpJobs, getDacpStats, getTenantDb,
} from '../cache/database.js';
import { apolloBulkMatch } from '../services/leadEngine.js';

let timer = null;

// ── Tenant-specific search config ─────────────────────────────────────────────

const TENANT_SEARCH_CONFIG = {
  'dacp-construction-001': {
    name: 'DACP Construction',
    region: 'Dallas-Fort Worth Texas',
    services: ['concrete', 'masonry', 'foundations', 'flatwork', 'structural concrete', 'site work', 'asphalt', 'paving'],
    color: '#1e3a5f', // navy
    searchQueries: [
      'new commercial construction projects awarded {region} this week',
      'data center construction projects Texas general contractor awarded 2026',
      'large commercial construction projects breaking ground {region}',
      '{region} construction bid opportunities concrete masonry',
      'general contractor awarded new project Texas commercial industrial',
      'construction industry news Texas DFW infrastructure',
      'hyperscale data center construction Texas concrete subcontractor needed',
      'semiconductor factory construction Texas groundbreaking 2026',
    ],
    linkedinQueries: [
      'site:linkedin.com construction project awarded Texas this week',
      'site:linkedin.com general contractor new project DFW concrete',
      'site:linkedin.com data center construction Texas groundbreaking',
      'site:linkedin.com "concrete" OR "masonry" OR "foundations" Dallas Fort Worth project',
    ],
  },
  // Sangha Systems - Bitcoin mining & energy
  default: {
    name: 'Sangha Systems',
    region: 'Texas ERCOT',
    services: ['bitcoin mining', 'behind-the-meter', 'hashrate', 'power curtailment', 'energy trading'],
    color: '#1a6b3c', // green
    searchQueries: [
      'bitcoin mining hashrate difficulty network news this week',
      'ERCOT Texas electricity price wholesale market news',
      'bitcoin mining profitability hashprice revenue 2026',
      'data center power AI compute energy demand news',
      'bitcoin mining company acquisition merger fund raise 2026',
      'Texas renewable energy solar wind curtailment ERCOT',
      'behind-the-meter bitcoin mining power purchase agreement',
      'Luxor hashrate forward NDF mining derivatives market',
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

// ── Contact Verification via Apollo ──────────────────────────────────────────

async function extractAndVerifyContacts(tenantId, searchResults) {
  if (!process.env.APOLLO_API_KEY) {
    console.log('[Newsletter] No APOLLO_API_KEY - skipping contact verification');
    return { verified: [], unverified: [] };
  }

  const { tunnelPrompt } = await import('../services/cliTunnel.js');

  // Step 1: Have Claude extract structured contacts from research
  const extractPrompt = `Extract all specific people mentioned in these research results. For each person, provide their first name, last name, and the company/organization they work for.

RESEARCH RESULTS:
${searchResults.map((r, i) => `--- ${i + 1}. "${r.query}" ---\n${r.answer}`).join('\n\n')}

Return ONLY a JSON array. Each object must have: first_name, last_name, organization_name, mentioned_role (their role/title if mentioned).
If no specific people are mentioned, return an empty array [].
Do NOT invent names. Only extract names explicitly stated in the research.
Return ONLY valid JSON, no commentary or markdown.`;

  let people = [];
  try {
    const raw = await tunnelPrompt({
      tenantId,
      agentId: 'hivemind',
      prompt: extractPrompt,
      maxTurns: 5,
      timeoutMs: 60_000,
      label: 'Newsletter Contact Extraction',
    });

    const cleaned = raw.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      people = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    console.warn('[Newsletter] Contact extraction failed:', err.message);
    return { verified: [], unverified: [] };
  }

  if (!Array.isArray(people) || people.length === 0) {
    console.log('[Newsletter] No contacts to verify');
    return { verified: [], unverified: [] };
  }

  // Step 2: Run through Apollo bulk_match
  const details = people
    .filter(p => p.first_name && p.last_name && p.organization_name)
    .slice(0, 20); // Cap at 20 to avoid burning credits

  if (details.length === 0) {
    return { verified: [], unverified: people };
  }

  console.log(`[Newsletter] Verifying ${details.length} contacts via Apollo...`);

  try {
    const matches = await apolloBulkMatch(
      details.map(p => ({
        first_name: p.first_name,
        last_name: p.last_name,
        organization_name: p.organization_name,
      }))
    );

    // Map verified results back to original mentions
    const verifiedNames = new Set(matches.map(m => m.name.toLowerCase()));
    const verified = matches.map(m => ({
      ...m,
      mentionedRole: details.find(
        d => `${d.first_name} ${d.last_name}`.toLowerCase() === m.name.toLowerCase()
      )?.mentioned_role || null,
    }));
    const unverified = people.filter(
      p => !verifiedNames.has(`${p.first_name} ${p.last_name}`.toLowerCase())
    );

    console.log(`[Newsletter] Apollo: ${verified.length} verified, ${unverified.length} unverified`);
    return { verified, unverified };
  } catch (err) {
    console.warn('[Newsletter] Apollo verification failed:', err.message);
    return { verified: [], unverified: people };
  }
}

// ── Newsletter Generation via Claude ──────────────────────────────────────────

async function generateNewsletter(tenantId, searchResults, businessContext, contactVerification = null) {
  const config = getTenantConfig(tenantId);
  const { tunnelPrompt } = await import('../services/cliTunnel.js');

  // Build verification context block
  let verificationBlock = '';
  if (contactVerification && (contactVerification.verified.length > 0 || contactVerification.unverified.length > 0)) {
    verificationBlock = `\n\nCONTACT VERIFICATION (via Apollo.io):
${contactVerification.verified.length > 0 ? `VERIFIED CONTACTS (confirmed real people at these companies):
${contactVerification.verified.map(c => `- ${c.name} | ${c.title || c.mentionedRole || 'N/A'} at ${c.org || 'N/A'}${c.email ? ' | ' + c.email : ''}${c.linkedin ? ' | LinkedIn: ' + c.linkedin : ''}${c.emailVerified ? ' [EMAIL VERIFIED]' : ''}`).join('\n')}` : ''}
${contactVerification.unverified.length > 0 ? `\nUNVERIFIED CONTACTS (could not confirm via Apollo - DO NOT include contact details for these people, only mention them by name if the project/news itself is real):
${contactVerification.unverified.map(c => `- ${c.first_name} ${c.last_name} at ${c.organization_name}`).join('\n')}` : ''}

IMPORTANT RULES FOR CONTACTS:
- Only include verified email addresses and LinkedIn URLs - never guess or fabricate contact info
- For VERIFIED contacts: include their real title, email, and LinkedIn if available
- For UNVERIFIED contacts: you may mention the person by name in context of a real project, but do NOT include email or direct contact details
- In RECOMMENDED ACTIONS, prefer suggesting outreach to verified contacts`;
  }

  const brandColor = config.color || '#1e3a5f';

  const prompt = `You are writing a daily intelligence newsletter for ${config.name}, specializing in ${config.services.join(', ')} in ${config.region}.

WEB RESEARCH RESULTS (gathered this morning):
${searchResults.map((r, i) => `--- Research ${i + 1}: "${r.query}" ---\n${r.answer}\n${r.citations?.length ? 'Sources: ' + r.citations.join(', ') : ''}`).join('\n\n')}

CURRENT BUSINESS STATE:
${JSON.stringify(businessContext, null, 2)}${verificationBlock}

Write a morning intelligence briefing newsletter. Structure it as clean HTML (no <html>/<body> tags, just the content).

SECTIONS (include only sections with actual findings):

1. **NEW PROJECT OPPORTUNITIES** - Projects where ${config.name} could bid. Include: project name, location, estimated value if known, GC(s) involved, why it's relevant. Flag if a GC is one they've worked with before.

2. **GC ACTIVITY** - News about general contractors active in ${config.region}. New hires, project awards, expansions. Focus on GCs relevant to ${config.name}'s services.

3. **MARKET INTELLIGENCE** - Material pricing trends, labor market, regulatory changes, infrastructure spending that affects the business.

4. **LINKEDIN HIGHLIGHTS** - Interesting posts or announcements from construction industry professionals (if any LinkedIn results were found).

5. **RECOMMENDED ACTIONS** - 2-3 specific actions based on the findings. E.g., "Reach out to JE Dunn about the Meta El Paso project - they'll need concrete subs for a 1.2M sqft data center." For verified contacts, include their email/LinkedIn so the reader can act immediately.

FORMATTING RULES:
- Use clean, professional HTML with inline styles
- Use ${brandColor} as the primary brand color for ALL headings, borders, accents, and section dividers. Do NOT use navy (#1e3a5f) unless that IS the brand color.
- Do NOT include a top-level header/banner/title block - the email wrapper already has one. Jump straight into the content sections.
- Keep it scannable - short paragraphs, bullet points
- Bold key names (GCs, project names, dollar amounts)
- Each opportunity should feel actionable, not just informational
- If no results for a section, omit it entirely
- Target length: 500-800 words
- Do NOT use em dashes, use regular hyphens
- For verified contacts, add a small "VERIFIED" badge next to their name using the brand color

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

function buildEmailHtml(newsletterHtml, tenantName, date, brandColor = '#1e3a5f') {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:24px;">
  <div style="background:white;padding:0;border:1px solid #e8e6e1;border-radius:12px;overflow:hidden;font-size:14px;line-height:1.7;color:#2d2d2d;">
    ${newsletterHtml}
  </div>
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
  const fullHtml = buildEmailHtml(html, config.name, date, config.color);

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

function stripHtmlToText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function storeNewsletter(tenantId, html, searchResults) {
  try {
    const db = getTenantDb(tenantId);
    const id = `newsletter-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 6)}`;
    const plainText = stripHtmlToText(html);
    const title = `Daily Intelligence - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
    db.prepare(`
      INSERT OR REPLACE INTO knowledge_entries (id, tenant_id, type, title, summary, content, source, source_agent, processed, created_at)
      VALUES (?, ?, 'newsletter', ?, ?, ?, 'daily-newsletter', 'coppice-newsletter', 1, datetime('now'))
    `).run(
      id,
      tenantId,
      title,
      plainText.substring(0, 8000),
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

        // Only run for tenants with an explicit config (or the 'default' tenant which maps to Sangha)
        if (!TENANT_SEARCH_CONFIG[tenant.id]) {
          console.log(`[Newsletter] Skipping ${tenant.id} - no specific newsletter config`);
          return;
        }
        const config = getTenantConfig(tenant.id);

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

        // Step 2: Verify contacts via Apollo
        console.log(`[Newsletter] Verifying contacts for ${tenant.id}...`);
        const contactVerification = await extractAndVerifyContacts(tenant.id, searchResults);

        // Step 3: Generate newsletter via Claude (with verification data)
        console.log(`[Newsletter] Generating newsletter for ${tenant.id}...`);
        const newsletterHtml = await generateNewsletter(tenant.id, searchResults, businessContext, contactVerification);
        if (!newsletterHtml || newsletterHtml.length < 100) {
          console.log(`[Newsletter] Generation failed or empty for ${tenant.id}`);
          return;
        }

        // Step 4: Store for dashboard
        storeNewsletter(tenant.id, newsletterHtml, searchResults);

        // Step 5: Email to all users
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
