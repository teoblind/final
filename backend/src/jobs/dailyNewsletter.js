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
  insertAgentAssignment, updateAgentAssignment,
  SANGHA_TENANT_ID,
} from '../cache/database.js';
import { apolloBulkMatch } from '../services/leadEngine.js';
import { gatherSocialIntelligence } from '../services/socialScraper.js';

let timer = null;

// ── Tenant-specific search config ─────────────────────────────────────────────

const TENANT_SEARCH_CONFIG = {
  'dacp-construction-001': {
    name: 'DACP Construction',
    region: 'Dallas-Fort Worth Texas',
    services: ['concrete', 'masonry', 'foundations', 'flatwork', 'structural concrete', 'site work', 'asphalt', 'paving'],
    color: '#1e3a5f', // navy
    // Expansion regions - searched if primary region returns < MIN_RESULTS
    expansionRegions: [
      'Houston Texas',
      'Austin San Antonio Texas',
      'Southeast United States',
      'Southwest United States',
      'United States nationwide',
    ],
    minResults: 4, // minimum Perplexity results before expanding
    searchQueries: [
      'new commercial construction projects awarded {region} today OR yesterday',
      'data center construction projects {region} general contractor awarded today',
      '{region} construction bid opportunities closing soon concrete masonry',
      'large commercial construction projects breaking ground {region} today OR yesterday',
      'general contractor awarded new project {region} today commercial industrial',
      'construction industry news {region} infrastructure today',
      'hyperscale data center construction {region} update today OR yesterday',
      '{region} municipal government construction bid invitation new today',
    ],
    linkedinQueries: [
      'site:linkedin.com construction project awarded Texas today',
      'site:linkedin.com general contractor new project DFW concrete',
      'site:linkedin.com data center construction Texas groundbreaking',
    ],
  },
  // Sangha Systems - Bitcoin mining & energy + renewables (weekly)
  [SANGHA_TENANT_ID]: {
    name: 'Sangha Systems',
    region: 'Texas ERCOT',
    services: ['bitcoin mining', 'behind-the-meter', 'hashrate', 'power curtailment', 'energy trading', 'renewable energy partnerships'],
    color: '#1a6b3c', // green
    frequency: 'weekly', // runs Monday mornings only
    runDay: 1, // 0=Sun, 1=Mon
    searchQueries: [
      // Part 1: Mining Market Dynamics
      'bitcoin mining hashrate difficulty network news this week',
      'ERCOT Texas electricity price wholesale market news',
      'bitcoin mining profitability hashprice revenue 2026',
      'data center power AI compute energy demand news',
      'bitcoin mining company acquisition merger fund raise 2026',
      'behind-the-meter bitcoin mining power purchase agreement',
      'Luxor hashrate forward NDF mining derivatives market',
      'bitcoin mining company distress bankruptcy shutdown 2026',
      // Part 2: Renewables Market Dynamics
      'Texas renewable energy solar wind curtailment ERCOT 2026',
      'solar IPP independent power producer Texas acquisition partnership',
      'wind farm developer Texas ERCOT new project construction',
      'battery energy storage BESS Texas ERCOT deployment',
      'renewable energy tax equity investment PPA corporate 2026',
      'ERCOT wind curtailment negative pricing transmission constraint',
      'behind-the-meter solar bitcoin mining colocation partnership',
      'renewable energy developer IPP fundraise acquisition 2026',
    ],
    linkedinQueries: [],
  },
};

function getTenantConfig(tenantId) {
  return TENANT_SEARCH_CONFIG[tenantId] || TENANT_SEARCH_CONFIG[SANGHA_TENANT_ID];
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
          { role: 'system', content: 'You are a research assistant. Return factual, concise findings with specific names, numbers, and dates. Focus on the most recent results from the past week. Always include source URLs for claims.' },
          { role: 'user', content: query },
        ],
        max_tokens: 1500,
        search_recency_filter: 'day',
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

async function runSearchBatch(queries) {
  const results = [];
  const batchSize = 4;
  for (let i = 0; i < queries.length; i += batchSize) {
    const batch = queries.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(q => searchWeb(q, 'news')));
    results.push(...batchResults.filter(Boolean));
    if (i + batchSize < queries.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return results;
}

async function gatherIntelligence(tenantId) {
  const config = getTenantConfig(tenantId);
  const minResults = config.minResults || 4;

  // Phase 1: Primary region search
  const primaryQueries = [
    ...config.searchQueries.map(q => q.replace(/\{region\}/g, config.region)),
    ...config.linkedinQueries,
  ];
  const results = await runSearchBatch(primaryQueries);

  // Count results with actual content (not empty answers)
  const substantiveResults = results.filter(r => r.answer && r.answer.length > 100);
  console.log(`[Newsletter] Primary region (${config.region}): ${substantiveResults.length} substantive results`);

  // Phase 2: Progressive region expansion if primary is thin
  if (substantiveResults.length < minResults && config.expansionRegions?.length) {
    for (const expandRegion of config.expansionRegions) {
      console.log(`[Newsletter] Expanding search to: ${expandRegion}`);

      // Use a subset of queries for expansion (top 4 most relevant)
      const expandQueries = config.searchQueries.slice(0, 4).map(q => q.replace(/\{region\}/g, expandRegion));
      const expandResults = await runSearchBatch(expandQueries);
      const expandSubstantive = expandResults.filter(r => r.answer && r.answer.length > 100);

      results.push(...expandResults.filter(Boolean));
      console.log(`[Newsletter] ${expandRegion}: +${expandSubstantive.length} results (total: ${results.filter(r => r.answer?.length > 100).length})`);

      // Stop expanding once we have enough
      if (results.filter(r => r.answer?.length > 100).length >= minResults * 2) {
        console.log(`[Newsletter] Sufficient results, stopping expansion`);
        break;
      }
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

async function generateNewsletter(tenantId, searchResults, businessContext, contactVerification = null, socialResults = null) {
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

  // Tenant-specific prompt sections
  const isSangha = config.name === 'Sangha Systems';

  const sectionInstructions = isSangha
    ? `SECTIONS - The newsletter has TWO PARTS. Include both, with all subsections that have findings:

--- PART 1: MINING MARKET DYNAMICS ---

1. **NETWORK & HASHRATE UPDATE** - Bitcoin network hashrate, difficulty adjustments, hashprice trends, Luxor forward curves, NDF/derivatives market moves. Include specific numbers.

2. **COMPETITOR ANALYSIS** - Mining companies in the news: expansions, acquisitions, fundraises, new site deployments. Identify distress signals (shutdowns, debt, selling rigs, stock drops) and growth signals (new capital raises, fleet upgrades, site acquisitions).

3. **POWER & ERCOT MARKET** - ERCOT wholesale prices, demand/supply dynamics, congestion, natural gas trends. Include specific price levels and trends that affect mining profitability.

4. **AI COMPUTE & DATA CENTER CONVERGENCE** - News about data centers, AI compute demand, mining-to-AI pivots, hybrid sites. Opportunities for Sangha to leverage existing infrastructure.

--- PART 2: RENEWABLES MARKET DYNAMICS ---

5. **POTENTIAL CUSTOMERS / IPP TARGETS** - Solar, wind, battery, and hydro Independent Power Producers (IPPs) with activity in Texas or ERCOT. For each, note:
   - Company name, project type, and scale (MW)
   - Recent news (fundraise, project announcement, acquisition, partnership)
   - Why they could be a Sangha customer (behind-the-meter mining colocation, curtailment monetization, PPA opportunity)
   Target companies like: Zelestra, Origis Energy, Stardust Solar, Arevon Energy, Scatec, NextEra, Enel, Invenergy, and any new entrants.

6. **CURTAILMENT & NEGATIVE PRICING** - ERCOT wind/solar curtailment events, negative pricing windows, transmission constraints. These are direct opportunities for behind-the-meter mining to absorb excess generation.

7. **RENEWABLES INVESTMENT SIGNALS** - Tax equity deals, corporate PPAs, energy storage deployments, new renewable capacity announcements. Both distress signals (project cancellations, developer financial trouble) and growth signals (new investment, policy tailwinds).

8. **TOP RENEWABLES NEWS** - 2-3 most impactful renewable energy stories. For each include:
   - What happened
   - "Why it matters" for the energy market
   - "Sangha opportunity" - specific angle for Sangha to capitalize

--- RECOMMENDED ACTIONS ---

9. **MINING ACTIONS** - 1-2 actions related to mining operations, hashrate market, or competitor moves.

10. **RENEWABLES OUTREACH** - 2-3 specific outreach recommendations targeting renewable energy developers/IPPs. For each include:
    - Who to contact (name, company, role)
    - Why now (what triggered the outreach opportunity)
    - Suggested approach (e.g., "Propose BTM mining colocation at their new 200MW solar farm to monetize curtailment")
    - Draft one-liner message if a verified contact is available

For each recommended action in sections 9 and 10, add a button styled as:
<a href="#" class="action-btn" data-action="draft-email" data-title="ACTION_TITLE_HERE" style="display:inline-block;background:${config.color || '#1a6b3c'};color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;margin-top:8px;">Draft Email</a>

Use "Draft Email" for outreach actions and "Start Task" for operations/research actions. Replace ACTION_TITLE_HERE with a short title for the action.`
    : `SECTIONS (include only sections with actual findings):

1. **NEW PROJECT OPPORTUNITIES** - Projects where ${config.name} could bid. Include: project name, location, estimated value if known, GC(s) involved, why it's relevant. Flag if a GC is one they've worked with before.

2. **GC ACTIVITY** - News about general contractors active in ${config.region}. New hires, project awards, expansions. Focus on GCs relevant to ${config.name}'s services.

3. **MARKET INTELLIGENCE** - Material pricing trends, labor market, regulatory changes, infrastructure spending that affects the business.

4. **SOCIAL MEDIA HIGHLIGHTS** - DO NOT generate this section. It will be injected automatically after your output. You may reference social media posts inline within other sections (e.g., "According to @handle on X...") but do NOT create a standalone Social Media Highlights section.

5. **NATIONAL / REGIONAL OPPORTUNITIES** - Projects outside the primary region (${config.region}) that were found during expanded geographic searches. Label each with location and distance from primary region. Only include if out-of-region results exist.

6. **RECOMMENDED ACTIONS** - 2-3 specific actions based on the findings. E.g., "Reach out to JE Dunn about the Meta El Paso project - they'll need concrete subs for a 1.2M sqft data center." For verified contacts, include their email/LinkedIn so the reader can act immediately.

For each recommended action, add a button styled as:
<a href="#" class="action-btn" data-action="draft-email" data-title="ACTION_TITLE_HERE" style="display:inline-block;background:${config.color || '#1e3a5f'};color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;margin-top:8px;">Draft Email</a>

Use "Draft Email" for outreach actions and "Start Task" for research/analysis actions. Replace ACTION_TITLE_HERE with a short title for the action.`;

  const targetLength = isSangha ? '1200-1800 words' : '800-1200 words';

  const prompt = `You are writing a daily intelligence newsletter for ${config.name}, specializing in ${config.services.join(', ')} in ${config.region}.

IMPORTANT: This is a DAILY newsletter. Only include information from the past 24 hours. Do NOT recycle old news or restate projects from previous newsletters. Every item must have a clear "what's new TODAY" angle. If research results contain information older than 24 hours, skip it or clearly note it as background context. The goal is that each day's newsletter contains ONLY new information the reader hasn't seen before.

NOTE: If results include projects outside the primary region (${config.region}), organize them in a separate "NATIONAL / REGIONAL OPPORTUNITIES" section after the primary region content. Clearly label the location for each out-of-region project and note travel distance or strategic relevance.

WEB RESEARCH RESULTS (gathered this morning, filtered to past 24 hours):
${searchResults.map((r, i) => `--- Research ${i + 1}: "${r.query}" ---\n${r.answer}\n${r.citations?.length ? 'Sources: ' + r.citations.join(', ') : ''}`).join('\n\n')}

CURRENT BUSINESS STATE:
${JSON.stringify(businessContext, null, 2)}${verificationBlock}
${socialResults && (socialResults.xPosts?.length || socialResults.linkedinPosts?.length) ? `
SOCIAL MEDIA POSTS (real posts with direct URLs - include these in a "Social Media Highlights" section):

${socialResults.xPosts?.length ? 'X/TWITTER POSTS:\n' + socialResults.xPosts.slice(0, 20).map(p => `- @${p.handle || 'unknown'} (${p.author || ''}): ${p.summary} | URL: ${p.url}${p.date ? ' | Date: ' + p.date : ''}`).join('\n') : ''}

${socialResults.linkedinPosts?.length ? 'LINKEDIN POSTS:\n' + socialResults.linkedinPosts.slice(0, 15).map(p => `- ${p.author || 'Unknown'}: ${p.summary} | URL: ${p.url}${p.date ? ' | Date: ' + p.date : ''}`).join('\n') : ''}

IMPORTANT: For X posts, link directly to the tweet URL. For LinkedIn posts, link directly to the post URL. These are REAL URLs that have been scraped - always include them as clickable links.` : `
NO SOCIAL MEDIA DATA WAS COLLECTED TODAY. Do NOT create a "Social Media Highlights" section. Do NOT invent or fabricate any LinkedIn posts, X/Twitter posts, or social media URLs. Only include social media content when real scraped data is provided above. If no social media data block appears above this line, there is NO social media content to include.`}

Write a morning intelligence briefing newsletter. Structure it as clean HTML (no <html>/<body> tags, just the content).

${sectionInstructions}

FORMATTING RULES:
- Use clean, professional HTML with inline styles
- Use ${brandColor} as the primary brand color for ALL headings, borders, accents, and section dividers. Do NOT use navy (#1e3a5f) unless that IS the brand color.
- START with a branded header banner: ONE single full-width block with background color ${brandColor}, white text. Include the title "${config.name} ${config.frequency === 'weekly' ? 'Weekly' : 'Daily'} Intelligence", the date, AND the first part label (e.g. "PART 1: MINING MARKET DYNAMICS") all inside the same green banner div. Use generous padding (36px 44px) and rounded top corners. Do NOT make the part labels separate colored blocks - they are part of the header.
- After the header, wrap ALL body content in a div with padding: 28px 40px. This ensures comfortable whitespace between the text and the card edges. All section content goes inside this padded wrapper.
${isSangha ? '- For Part 2, use a similar full-width green banner (background ' + brandColor + ', white text, padding 20px 44px) as a section divider before the renewables content.' : ''}
${isSangha ? '- Use a clear visual divider between Part 1 (Mining) and Part 2 (Renewables) - a colored horizontal rule or banner' : ''}
- Keep it scannable - short paragraphs, bullet points
- Bold key names (companies, project names, dollar amounts, MW figures)
- Each opportunity should feel actionable, not just informational
- If no results for a section, omit it entirely
- Target length: ${targetLength}
- Do NOT use em dashes, use regular hyphens
- For verified contacts, add a small "VERIFIED" badge next to their name using the brand color
- CITATIONS: For every project, news item, or claim, include the source URL as a small linked citation at the end of that paragraph. Use format: <a href="URL" style="color:${brandColor};font-size:11px;text-decoration:underline;">Source</a>. If multiple sources support a claim, include all of them. The Sources URLs are provided after each research block - use them. This is critical for credibility.
- NEVER FABRICATE URLs: Only use URLs that appear in the research results or social media data above. Do NOT invent LinkedIn post URLs, X/Twitter URLs, or any other links. If a source URL is not provided in the data, do not create one. Readers WILL click these links - broken/fake links destroy credibility instantly.
- LINKEDIN/X LINKS: ONLY include LinkedIn/X links if real social media data was provided in the SOCIAL MEDIA POSTS block above. If no social media data was provided, do NOT create a social media section and do NOT fabricate any social post URLs.
- At the very end of the newsletter, include a "Sources" section listing all URLs referenced, as a numbered list with small font (11px)
${isSangha ? '- For IPP/developer targets, use a card-style layout with company name, type, and opportunity summary\n- For "Sangha opportunity" callouts, use a highlighted box with a left border in the brand color' : ''}

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
  let html = response.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '').trim();

  // ─── Hardcoded header guarantee ───
  // Claude sometimes drops the branded header banner. We strip any Claude-generated
  // header and always prepend the correct one so the newsletter never ships broken.
  const freq = config.frequency === 'weekly' ? 'Weekly' : 'Daily';
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const headerHtml = `<div style="background-color:${brandColor}; padding:28px 32px; border-radius:6px 6px 0 0;">
  <h1 style="color:#ffffff; margin:0; font-size:22px; font-weight:700; letter-spacing:0.3px;">${config.name} | ${isSangha ? 'Weekly' : 'Morning'} Intelligence Briefing</h1>
  <p style="color:${isSangha ? '#a8e0c4' : '#a8c4e0'}; margin:6px 0 0 0; font-size:14px;">${dateStr} | ${config.region}</p>
</div>`;

  // Strip any Claude-generated header banner (background-color + h1 inside a div at the start)
  html = html.replace(/^<div[^>]*style="[^"]*background[^"]*"[^>]*>[\s\S]*?<\/h1>[\s\S]*?<\/div>\s*/i, '');

  // ─── Hardcoded social media section guarantee ───
  // Claude frequently drops the Social Media Highlights section even when told it's
  // mandatory. We build the HTML ourselves and inject it so it always appears.
  if (socialResults && (socialResults.xPosts?.length || socialResults.linkedinPosts?.length)) {
    // Check if Claude already included a social media section - if so, don't duplicate
    const hasSocialSection = /social\s*media\s*highlights/i.test(html);
    if (!hasSocialSection) {
      let socialHtml = `<div style="margin-top:28px; border-top:2px solid ${brandColor}; padding-top:20px;">
  <h2 style="color:${brandColor}; font-size:18px; font-weight:700; margin:0 0 16px 0;">Social Media Highlights</h2>`;

      if (socialResults.xPosts?.length) {
        socialHtml += `\n  <h3 style="color:${brandColor}; font-size:14px; font-weight:600; margin:16px 0 10px 0;">From X/Twitter</h3>\n  <ul style="list-style:none; padding:0; margin:0;">`;
        for (const post of socialResults.xPosts.slice(0, 5)) {
          const author = post.handle ? `@${post.handle}` : (post.author || 'Unknown');
          const date = post.date ? ` - ${post.date}` : '';
          socialHtml += `\n    <li style="margin-bottom:10px; padding:10px 14px; background:#f8f9fa; border-radius:6px; border-left:3px solid ${brandColor};">
      <strong style="font-size:13px;">${author}</strong><span style="color:#666; font-size:11px;">${date}</span><br/>
      <span style="font-size:13px;">${(post.summary || '').substring(0, 180)}</span><br/>
      <a href="${post.url}" style="color:${brandColor}; font-size:11px; text-decoration:underline;">View on X</a>
    </li>`;
        }
        socialHtml += `\n  </ul>`;
      }

      if (socialResults.linkedinPosts?.length) {
        socialHtml += `\n  <h3 style="color:${brandColor}; font-size:14px; font-weight:600; margin:16px 0 10px 0;">From LinkedIn</h3>\n  <ul style="list-style:none; padding:0; margin:0;">`;
        for (const post of socialResults.linkedinPosts.slice(0, 5)) {
          const author = post.author || 'Unknown';
          const date = post.date ? ` - ${post.date}` : '';
          socialHtml += `\n    <li style="margin-bottom:10px; padding:10px 14px; background:#f8f9fa; border-radius:6px; border-left:3px solid #0077b5;">
      <strong style="font-size:13px;">${author}</strong>${post.authorTitle ? `<span style="color:#888; font-size:11px;"> - ${post.authorTitle}</span>` : ''}<span style="color:#666; font-size:11px;">${date}</span><br/>
      <span style="font-size:13px;">${(post.summary || '').substring(0, 250)}</span><br/>
      <a href="${post.url}" style="color:#0077b5; font-size:11px; text-decoration:underline;">View on LinkedIn</a>
    </li>`;
        }
        socialHtml += `\n  </ul>`;
      }

      socialHtml += `\n</div>`;

      // Inject before "Recommended Actions" or "Sources" section, or at the end
      const recActionsMatch = html.match(/<h2[^>]*>.*?recommended\s*actions/i);
      const sourcesMatch = html.match(/<h2[^>]*>.*?sources/i);
      if (recActionsMatch) {
        const idx = html.indexOf(recActionsMatch[0]);
        html = html.slice(0, idx) + socialHtml + '\n' + html.slice(idx);
      } else if (sourcesMatch) {
        const idx = html.indexOf(sourcesMatch[0]);
        html = html.slice(0, idx) + socialHtml + '\n' + html.slice(idx);
      } else {
        // Append before the closing div
        html += '\n' + socialHtml;
      }

      console.log(`[Newsletter] Injected social media section: ${socialResults.xPosts?.length || 0} X + ${socialResults.linkedinPosts?.length || 0} LinkedIn posts`);
    }
  }

  // Ensure body content is wrapped in padding div
  if (!html.startsWith('<div') || !html.includes('padding: 28px')) {
    html = `<div style="padding: 28px 40px;">\n${html}\n</div>`;
  }

  return `<div style="max-width:680px; margin:0 auto; font-family: 'Helvetica Neue', Arial, sans-serif; color:#222; line-height:1.6;">\n${headerHtml}\n${html}\n</div>`;
}

// ── Email Delivery ────────────────────────────────────────────────────────────

function buildEmailHtml(newsletterHtml, tenantName, date, brandColor = '#1e3a5f') {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:700px;margin:0 auto;padding:24px;">
  <div style="background:white;border:1px solid #e8e6e1;border-radius:12px;overflow:hidden;font-size:14px;line-height:1.7;color:#2d2d2d;">
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
        subject: `${config.name} ${config.frequency === 'weekly' ? 'Weekly' : 'Daily'} Intelligence - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
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
    // Deterministic ID per tenant per day - re-runs REPLACE instead of creating duplicates
    const dateKey = new Date().toISOString().slice(0, 10);
    const id = `newsletter-${dateKey}-${tenantId.slice(0, 8)}`;
    const plainText = stripHtmlToText(html);
    const config = getTenantConfig(tenantId);
    const freq = config.frequency === 'weekly' ? 'Weekly' : 'Daily';
    const title = `${freq} Intelligence - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
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
    console.log(`[Newsletter] Stored as ${id} (replaces any previous run for ${dateKey})`);
  } catch (err) {
    console.warn(`[Newsletter] Storage failed:`, err.message);
  }
}

// ── Task Generation from Newsletter ──────────────────────────────────────────

async function generateTasksFromNewsletter(tenantId, newsletterHtml) {
  try {
    const { tunnelPrompt } = await import('../services/cliTunnel.js');
    const config = getTenantConfig(tenantId);
    const plainText = stripHtmlToText(newsletterHtml);

    const prompt = `You just generated the following intelligence newsletter for ${config.name}:

---
${plainText.substring(0, 6000)}
---

Based on the newsletter findings, extract 3-5 specific, actionable tasks that the team should execute this week. For each task, return a JSON object with these fields:
- title: Short task title (under 60 chars)
- description: 1-2 sentence description of what to do
- category: One of "outreach", "research", "analysis", "operations"
- priority: "high", "medium", or "low"
- action_prompt: Detailed instructions for an AI agent to execute this task (include specific company names, contacts, data points from the newsletter)

IMPORTANT: For any "outreach" category task, also include an "email_draft" object with:
- to: The email address to contact (use a realistic placeholder like "biddesk@companyname.com" if unknown)
- subject: A professional email subject line
- body: A short, professional HTML email body (2-3 paragraphs, include specific project details from the newsletter, written from ${config.name}'s perspective expressing interest or requesting information). Use <p> tags for paragraphs. Keep it concise and action-oriented.

Return ONLY a JSON array of task objects. No markdown, no explanation.`;

    const response = await tunnelPrompt({
      tenantId,
      agentId: 'hivemind',
      prompt,
      maxTurns: 5,
      timeoutMs: 120_000,
      label: 'Newsletter Tasks',
    });

    // Parse the JSON array
    const cleaned = response.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    const tasks = JSON.parse(cleaned);

    if (!Array.isArray(tasks)) return;

    for (const task of tasks.slice(0, 5)) {
      const id = `TASK-${randomUUID().slice(0, 8).toUpperCase()}`;

      // For outreach tasks with email drafts, pre-populate artifacts
      let outputArtifacts = null;
      if (task.category === 'outreach' && task.email_draft) {
        outputArtifacts = JSON.stringify([{
          type: 'email_draft',
          status: 'pending_approval',
          to: task.email_draft.to || '',
          subject: task.email_draft.subject || task.title,
          body: task.email_draft.body || `<p>${task.description}</p>`,
          index: 0,
        }]);
      }

      insertAgentAssignment({
        id,
        tenant_id: tenantId,
        title: task.title,
        description: task.description,
        category: task.category || 'research',
        priority: task.priority || 'medium',
        action_prompt: task.action_prompt || task.description,
        agent_id: 'hivemind',
        context_json: JSON.stringify({ source: 'newsletter', date: new Date().toISOString().slice(0, 10) }),
      });

      // Set artifacts after insert (not in insertAgentAssignment schema)
      if (outputArtifacts) {
        updateAgentAssignment(tenantId, id, { output_artifacts_json: outputArtifacts });
      }

      console.log(`[Newsletter] Created task: ${id} "${task.title}"${outputArtifacts ? ' (with email draft)' : ''}`);
    }
    console.log(`[Newsletter] Generated ${Math.min(tasks.length, 5)} tasks for ${tenantId}`);
  } catch (err) {
    console.warn(`[Newsletter] Task generation failed (non-fatal):`, err.message);
  }
}

// ── Main Job ──────────────────────────────────────────────────────────────────

async function runDailyNewsletter({ tenantFilter, recipientOverride } = {}) {
  const tenants = getAllTenants();

  for (const tenant of tenants) {
    // Optional tenant filter (e.g. only re-run for DACP)
    if (tenantFilter && tenant.id !== tenantFilter) continue;

    try {
      await runWithTenant(tenant.id, async () => {
        console.log(`[Newsletter] Running for tenant: ${tenant.id}`);

        // Only run for tenants with an explicit config
        if (!TENANT_SEARCH_CONFIG[tenant.id]) {
          console.log(`[Newsletter] Skipping ${tenant.id} - no specific newsletter config`);
          return;
        }
        const config = getTenantConfig(tenant.id);

        // Weekly tenants only run on their configured day (unless manual trigger with tenantFilter)
        if (!tenantFilter && config.frequency === 'weekly') {
          const today = new Date().getDay(); // 0=Sun, 1=Mon, ...
          if (today !== (config.runDay ?? 1)) {
            console.log(`[Newsletter] Skipping ${tenant.id} - weekly newsletter, not run day (today=${today}, runDay=${config.runDay ?? 1})`);
            return;
          }
        }

        // Get recipients - override if provided, else all tenant users
        let recipients;
        if (recipientOverride) {
          recipients = Array.isArray(recipientOverride) ? recipientOverride : [recipientOverride];
        } else {
          const users = getUsersByTenant(tenant.id);
          recipients = users.map(u => u.email).filter(Boolean);
        }
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

        // Step 1b: Social media search (X + LinkedIn) - runs in parallel with contact verification
        console.log(`[Newsletter] Searching social media for ${tenant.id}...`);

        // Step 2: Verify contacts via Apollo + social scraping in parallel
        console.log(`[Newsletter] Verifying contacts for ${tenant.id}...`);
        const [contactVerification, socialResults] = await Promise.all([
          extractAndVerifyContacts(tenant.id, searchResults),
          Promise.race([
            gatherSocialIntelligence(config),
            new Promise(resolve => setTimeout(() => {
              console.warn('[Newsletter] Social scraper timed out after 180s');
              resolve({ xPosts: [], linkedinPosts: [] });
            }, 180000)),
          ]).catch(err => {
            console.warn(`[Newsletter] Social scraper failed:`, err.message);
            return { xPosts: [], linkedinPosts: [] };
          }),
        ]);

        // Step 3: Generate newsletter via Claude (with verification data + social posts)
        console.log(`[Newsletter] Generating newsletter for ${tenant.id}...`);
        const newsletterHtml = await generateNewsletter(tenant.id, searchResults, businessContext, contactVerification, socialResults);
        if (!newsletterHtml || newsletterHtml.length < 100) {
          console.log(`[Newsletter] Generation failed or empty for ${tenant.id}`);
          return;
        }

        // Step 4: Store for dashboard
        storeNewsletter(tenant.id, newsletterHtml, searchResults);

        // Step 4b: Generate actionable tasks from newsletter findings
        console.log(`[Newsletter] Generating tasks for ${tenant.id}...`);
        await generateTasksFromNewsletter(tenant.id, newsletterHtml);

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
