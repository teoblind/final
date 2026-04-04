/**
 * Lead Engine Service - Discovery, enrichment, outreach, and follow-ups.
 *
 * Ported from ~/Charger-Bot/src/leadgen_bot.py to Node.js.
 * Uses Perplexity for discovery, Claude for parsing/email gen, DNS for MX validation.
 */

import { v4 as uuidv4 } from 'uuid';
import dns from 'dns';
import db from '../cache/database.js';
import {
  getLeads,
  getLead,
  insertLead,
  updateLead,
  getLeadContacts,
  insertLeadContact,
  getOutreachLog,
  insertOutreachEntry,
  updateOutreachEntry,
  getLeadDiscoveryConfig,
  upsertLeadDiscoveryConfig,
  getLeadStats,
  insertActivity,
  recordServiceUsage,
  getCurrentTenantId,
} from '../cache/database.js';

// ─── API Clients ────────────────────────────────────────────────────────────

async function callPerplexity(system, user) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error('PERPLEXITY_API_KEY not set');

  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Perplexity API error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // Track Perplexity usage
  try {
    const tenantId = getCurrentTenantId();
    if (tenantId) recordServiceUsage(tenantId, 'perplexity', 1, null, 'Lead engine research');
  } catch {}

  return data.choices?.[0]?.message?.content || '';
}

async function callClaude(model, system, user) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: user }],
  });

  return msg.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');
}

// ─── Apollo.io Contact Enrichment ────────────────────────────────────────────
// Two-step: Perplexity finds decision-maker names → Apollo bulk_match verifies emails

export async function apolloBulkMatch(details) {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) throw new Error('APOLLO_API_KEY not set');

  const res = await fetch('https://api.apollo.io/api/v1/people/bulk_match', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ details }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Apollo bulk_match error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // Track Apollo usage
  try {
    const tenantId = getCurrentTenantId();
    if (tenantId) recordServiceUsage(tenantId, 'apollo', details.length, null, 'Apollo bulk match');
  } catch {}

  return (data.matches || []).filter(Boolean).map(p => ({
    name: [p.first_name, p.last_name].filter(Boolean).join(' '),
    email: p.email,
    title: p.title || null,
    phone: p.phone_number || (p.phone_numbers?.[0]?.sanitized_number) || null,
    linkedin: p.linkedin_url || null,
    emailVerified: p.email_status === 'verified',
    org: p.organization?.name || null,
  }));
}

async function findAndVerifyContacts(companyName, website) {
  // Step 1: Use Perplexity to find decision-maker names
  const namePrompt = `Find the names and titles of key executives/leaders at ${companyName}${website ? ' (' + website + ')' : ''}. Focus on: CEO, President, CFO, VP Business Development, VP Strategy, VP Operations, Head of Mining, VP Energy.
Return a JSON array of objects with fields: first_name, last_name, title. Return ONLY valid JSON, no commentary. Return 3-5 people maximum.`;

  const raw = await callPerplexity(
    'You are a contact researcher. Return ONLY a valid JSON array.',
    namePrompt
  );

  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let people;
  try { people = JSON.parse(jsonMatch[0]); } catch { return []; }
  if (!Array.isArray(people) || people.length === 0) return [];

  // Step 2: Use Apollo bulk_match to verify emails
  const details = people
    .filter(p => p.first_name && p.last_name)
    .map(p => ({
      first_name: p.first_name,
      last_name: p.last_name,
      organization_name: companyName,
    }));

  if (details.length === 0) return [];

  return apolloBulkMatch(details);
}

// ─── Validation ─────────────────────────────────────────────────────────────

async function validateMx(email) {
  const domain = email.split('@')[1];
  if (!domain) return false;
  try {
    const records = await dns.promises.resolveMx(domain);
    return records && records.length > 0;
  } catch {
    return false;
  }
}

function isJunkEmail(email) {
  const lower = email.toLowerCase();
  const junkPrefixes = ['noreply', 'no-reply', 'donotreply', 'info@', 'support@', 'admin@', 'webmaster@', 'hello@', 'contact@', 'sales@', 'marketing@'];
  const junkDomains = ['facebook.com', 'twitter.com', 'linkedin.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com'];

  for (const prefix of junkPrefixes) {
    if (lower.startsWith(prefix)) return true;
  }
  const domain = lower.split('@')[1];
  return junkDomains.includes(domain);
}

// US state filter
function isUsRegion(region) {
  if (!region) return true; // default to included
  const lower = region.toLowerCase();
  const intlBlocklist = ['uk', 'united kingdom', 'london', 'germany', 'france', 'japan', 'china', 'india', 'brazil', 'australia', 'canada', 'mexico', 'singapore', 'hong kong', 'dubai', 'uae'];
  if (intlBlocklist.some(kw => lower.includes(kw))) return false;
  const usStates = ['al','ak','az','ar','ca','co','ct','de','fl','ga','hi','id','il','in','ia','ks','ky','la','me','md','ma','mi','mn','ms','mo','mt','ne','nv','nh','nj','nm','ny','nc','nd','oh','ok','or','pa','ri','sc','sd','tn','tx','ut','vt','va','wa','wv','wi','wy'];
  const usKeywords = ['usa', 'united states', 'ercot', 'pjm', 'miso', 'spp', 'caiso', 'nyiso', 'isone', 'texas', 'california', 'new york', 'florida', 'miami', 'houston', 'austin', 'dallas', 'san antonio', 'fort lauderdale', 'orlando', 'tampa', 'atlanta', 'chicago', 'los angeles', 'san francisco', 'seattle', 'denver', 'phoenix', 'boston', 'philadelphia', 'washington', 'dc', 'nashville', 'charlotte', 'las vegas'];
  if (usKeywords.some(kw => lower.includes(kw))) return true;
  // Check for state abbreviation patterns like "Miami, FL" or "TX"
  const parts = lower.split(/[,\s]+/);
  return parts.some(p => usStates.includes(p.replace(/[^a-z]/g, '')));
}

// ─── Core Pipeline Functions ────────────────────────────────────────────────

/**
 * Discover new leads via Perplexity search.
 */
export async function discoverLeads(tenantId) {
  const config = getLeadDiscoveryConfig(tenantId);
  if (!config) return { newLeads: 0, error: 'No discovery config found' };

  const queries = config.queries || [];
  if (queries.length === 0) return { newLeads: 0, error: 'No search queries configured' };

  const pos = config.current_position || 0;
  const perCycle = config.queries_per_cycle || 2;
  const selectedQueries = [];
  for (let i = 0; i < perCycle; i++) {
    selectedQueries.push(queries[(pos + i) % queries.length]);
  }

  let totalNew = 0;

  for (const query of selectedQueries) {
    try {
      const systemPrompt = `You are a lead researcher. For each company found, return a JSON array of objects with fields: name, region, industry, website, triggerNews, priorityScore (1-100). Only include US-based companies. Return ONLY valid JSON, no commentary.`;
      const raw = await callPerplexity(systemPrompt, `Find companies matching: ${query}`);

      // Extract JSON from response
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) continue;

      let leads;
      try {
        leads = JSON.parse(jsonMatch[0]);
      } catch {
        continue;
      }

      for (const lead of leads) {
        if (!lead.name || !isUsRegion(lead.region)) continue;

        const id = `le-${uuidv4().slice(0, 8)}`;
        const result = insertLead({
          id,
          tenantId,
          venueName: lead.name,
          region: lead.region || null,
          industry: lead.industry || null,
          triggerNews: lead.triggerNews || null,
          priorityScore: lead.priorityScore || 50,
          website: lead.website || null,
          source: 'discovery',
          sourceQuery: query,
        });

        if (result.changes > 0) totalNew++;
      }
    } catch (err) {
      console.error(`Discovery error for query "${query}":`, err.message);
    }
  }

  // Advance position
  const newPos = (pos + perCycle) % queries.length;
  upsertLeadDiscoveryConfig({ ...config, tenantId, currentPosition: newPos, queries: config.queries, regions: config.regions });

  if (totalNew > 0) {
    insertActivity({
      tenantId, type: 'lead',
      title: `${totalNew} new leads discovered`,
      subtitle: selectedQueries.slice(0, 2).join(', '),
      detailJson: JSON.stringify({ queriesRun: selectedQueries, newLeads: totalNew }),
      sourceType: 'lead_engine', agentId: 'lead-engine',
    });
  }

  return { newLeads: totalNew, queriesRun: selectedQueries.length };
}

/**
 * Enrich leads with contact information.
 * Two-step: Perplexity finds decision-maker names → Apollo bulk_match verifies emails.
 */
export async function enrichContacts(tenantId, maxLeads = 10) {
  const leads = getLeads(tenantId, 'new', maxLeads);
  let enriched = 0;

  for (const lead of leads) {
    const existing = getLeadContacts(tenantId, lead.id);
    if (existing.length > 0) continue;

    try {
      const contacts = await findAndVerifyContacts(lead.venue_name, lead.website);

      let addedAny = false;
      for (const c of contacts) {
        if (!c.email || isJunkEmail(c.email)) continue;

        const mxValid = c.emailVerified || await validateMx(c.email);
        const contactId = `lc-${uuidv4().slice(0, 8)}`;
        const result = insertLeadContact({
          id: contactId,
          tenantId,
          leadId: lead.id,
          name: c.name || null,
          email: c.email,
          title: c.title || null,
          phone: c.phone || null,
          source: 'apollo',
          mxValid: mxValid ? 1 : 0,
        });
        if (result.changes > 0) addedAny = true;
      }

      if (addedAny) {
        updateLead(tenantId, lead.id, { status: 'enriched' });
        enriched++;
      }
    } catch (err) {
      console.error(`Enrichment error for ${lead.venue_name}:`, err.message);
    }
  }

  return { enriched };
}

/**
 * Generate outreach emails for enriched leads.
 */
export async function generateOutreach(tenantId) {
  const config = getLeadDiscoveryConfig(tenantId);
  const mode = config?.mode || 'copilot';

  // Find leads that have contacts but no outreach yet
  const enrichedLeads = getLeads(tenantId, 'enriched', config?.max_emails_per_cycle || 10);
  let generated = 0;

  for (const lead of enrichedLeads) {
    const contacts = getLeadContacts(tenantId, lead.id);
    const validContacts = contacts.filter(c => c.mx_valid);
    if (validContacts.length === 0) continue;

    const contact = validContacts[0]; // Primary contact

    try {
      const senderName = config?.sender_name || 'The Team';
      const systemPrompt = `You are an expert cold email writer. Write a personalized outreach email that is concise, professional, and references specific details about the recipient's company. Keep it under 150 words. Do NOT use generic templates. Output ONLY the email body text, no subject line or headers.`;
      const userPrompt = `Write an outreach email from ${senderName} to ${contact.name || 'the team'} at ${lead.venue_name}.
Company details: ${lead.industry || 'N/A'} in ${lead.region || 'US'}.
Trigger: ${lead.trigger_news || 'N/A'}.
Our value prop: We help companies like theirs optimize operations and create new revenue streams.
Sign off as: ${senderName}`;

      const body = await callClaude('claude-sonnet-4-20250514', systemPrompt, userPrompt);

      // Generate subject
      const subjectPrompt = `Generate a short (5-8 word) email subject line for a cold outreach email to ${contact.name} at ${lead.venue_name}. Output ONLY the subject line, nothing else.`;
      const subject = await callClaude('claude-haiku-4-5-20251001', 'You write email subject lines.', subjectPrompt);

      const outreachId = `lo-${uuidv4().slice(0, 8)}`;
      const status = mode === 'autonomous' ? 'pending_approval' : 'draft';

      insertOutreachEntry({
        id: outreachId,
        tenantId,
        leadId: lead.id,
        contactId: contact.id,
        emailType: 'initial',
        subject: subject.trim(),
        body,
        status,
      });

      insertActivity({
        tenantId, type: 'out',
        title: `Outreach drafted for ${contact.name || 'contact'} at ${lead.venue_name}`,
        subtitle: `Subject: ${subject.trim()}`,
        detailJson: JSON.stringify({ to: contact.email, subject: subject.trim(), body, leadId: lead.id }),
        sourceType: 'email', sourceId: outreachId, agentId: 'lead-engine',
      });

      // Insert into approval queue so operator can approve/reject before sending
      try {
        db.prepare(`INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json) VALUES (?, 'outreach', ?, ?, 'email_draft', ?)`)
          .run(
            tenantId,
            `Outreach draft: ${contact.name || 'contact'} - ${lead.venue_name}`,
            `Subject: ${subject.trim()}`,
            JSON.stringify({
              to: contact.email,
              demo_to: 'teo@zhan.capital',
              subject: subject.trim(),
              body,
              outreach_id: outreachId,
            }),
          );
      } catch (approvalErr) {
        console.error('Failed to insert approval item:', approvalErr.message);
      }

      updateLead(tenantId, lead.id, { status: 'contacted', contactedAt: new Date().toISOString() });
      generated++;
    } catch (err) {
      console.error(`Outreach gen error for ${lead.venue_name}:`, err.message);
    }
  }

  return { generated };
}

/**
 * Generate follow-up emails for non-responders.
 */
export async function generateFollowups(tenantId) {
  const config = getLeadDiscoveryConfig(tenantId);
  const delayDays = config?.followup_delay_days || 5;
  const maxFollowups = config?.max_followups || 2;

  // Find sent outreach that hasn't received a response and is old enough
  const outreach = getOutreachLog(tenantId, 'sent', 100);
  const cutoff = new Date(Date.now() - delayDays * 24 * 60 * 60 * 1000).toISOString();
  let generated = 0;

  for (const entry of outreach) {
    if (entry.responded_at) continue;
    if (!entry.sent_at || entry.sent_at > cutoff) continue;

    // Count existing follow-ups for this lead
    const existingFollowups = getOutreachLog(tenantId, null, 100)
      .filter(o => o.lead_id === entry.lead_id && o.email_type.startsWith('followup'));
    if (existingFollowups.length >= maxFollowups) continue;

    try {
      const followupNum = existingFollowups.length + 1;
      const systemPrompt = `Write a brief follow-up email (under 80 words). Reference the original email naturally. Be polite but direct. Output ONLY the email body.`;
      const userPrompt = `Follow-up #${followupNum} to ${entry.contact_name || 'them'} at ${entry.venue_name}. Original subject: "${entry.subject}". Original sent: ${entry.sent_at}.`;

      const body = await callClaude('claude-haiku-4-5-20251001', systemPrompt, userPrompt);

      const outreachId = `lo-${uuidv4().slice(0, 8)}`;
      insertOutreachEntry({
        id: outreachId,
        tenantId,
        leadId: entry.lead_id,
        contactId: entry.contact_id,
        emailType: `followup_${followupNum}`,
        subject: `Re: ${entry.subject}`,
        body,
        status: 'draft',
      });

      generated++;
    } catch (err) {
      console.error(`Follow-up gen error:`, err.message);
    }
  }

  return { generated };
}

/**
 * Approve a draft outreach email.
 */
export function approveOutreach(tenantId, outreachId, approvedBy) {
  updateOutreachEntry(tenantId, outreachId, {
    status: 'approved',
    approvedBy: approvedBy || 'operator',
  });
  // TODO: Gmail sending integration
  return { approved: true, outreachId };
}

/**
 * Check inbox for replies. Placeholder for Gmail API integration.
 */
export function checkInbox(tenantId) {
  // Future: Gmail API via googleapis npm
  return { replies: [], checked: false, message: 'Gmail inbox check not yet configured' };
}

/**
 * Run full lead engine cycle: discover → enrich → outreach → follow-ups.
 */
export async function runFullCycle(tenantId) {
  const results = {};

  try {
    results.discovery = await discoverLeads(tenantId);
  } catch (err) {
    results.discovery = { error: err.message };
  }

  try {
    results.enrichment = await enrichContacts(tenantId);
  } catch (err) {
    results.enrichment = { error: err.message };
  }

  try {
    results.outreach = await generateOutreach(tenantId);
  } catch (err) {
    results.outreach = { error: err.message };
  }

  try {
    results.followups = await generateFollowups(tenantId);
  } catch (err) {
    results.followups = { error: err.message };
  }

  results.inbox = checkInbox(tenantId);
  results.stats = getLeadStats(tenantId);

  return results;
}

/**
 * Get detailed lead info with contacts and outreach history.
 */
export function getLeadDetail(tenantId, leadId) {
  const lead = getLead(tenantId, leadId);
  if (!lead) return null;

  const contacts = getLeadContacts(tenantId, leadId);
  const outreach = getOutreachLog(tenantId, null, 100)
    .filter(o => o.lead_id === leadId);

  return { lead, contacts, outreach };
}
