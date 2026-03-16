/**
 * Chat Service — Claude API backend for agent conversations
 *
 * Each agent gets a system prompt defining its role and knowledge.
 * Messages are persisted to SQLite and sent as conversation history to Claude.
 */

import Anthropic from '@anthropic-ai/sdk';
import { getCurrentTenantId, getTenantDb, getAgentMode, insertActivity } from '../cache/database.js';

// Lazy DB accessor — resolves to the current tenant's DB via AsyncLocalStorage context
const db = new Proxy({}, {
  get(target, prop) {
    const tenantId = getCurrentTenantId() || 'default';
    const realDb = getTenantDb(tenantId);
    const val = realDb[prop];
    if (typeof val === 'function') return val.bind(realDb);
    return val;
  },
});

let _anthropic;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

import { selectModel, estimateCost } from './modelRouter.js';
import { searchKnowledge, getOpenActionItems } from './knowledgeProcessor.js';
import { textToSpeech } from './elevenlabsService.js';

const MODEL = process.env.CHAT_MODEL || 'claude-sonnet-4-20250514';
const MAX_HISTORY = 50; // max messages to include in context
const WORKSPACE_AGENT_URL = process.env.WORKSPACE_AGENT_URL || 'http://localhost:3010';

// ─── Workspace Tools (Anthropic tool-use format) ────────────────────────────

const WORKSPACE_TOOLS = [
  {
    name: 'workspace_create_doc',
    description: 'Create a Google Doc with markdown content in a specific Drive folder.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        folder: { type: 'string', description: 'Google Drive folder ID or name' },
        content: { type: 'string', description: 'Document content in markdown format' },
        comment: { type: 'string', description: 'Optional comment to add to the document' },
        tag_users: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of email addresses to tag/mention',
        },
      },
      required: ['title', 'folder', 'content'],
    },
  },
  {
    name: 'workspace_create_sheet',
    description: 'Create a Google Sheet with structured data in a specific Drive folder.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Spreadsheet title' },
        folder: { type: 'string', description: 'Google Drive folder ID or name' },
        sheets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Sheet/tab name' },
              headers: { type: 'array', items: { type: 'string' }, description: 'Column headers' },
              rows: { type: 'array', items: { type: 'array' }, description: 'Row data (array of arrays)' },
              formatting: { type: 'object', description: 'Optional formatting rules' },
            },
          },
          description: 'Array of sheet definitions with name, headers, rows, and formatting',
        },
        comment: { type: 'string', description: 'Optional comment to add to the spreadsheet' },
      },
      required: ['title', 'folder', 'sheets'],
    },
  },
  {
    name: 'workspace_create_slides',
    description: 'Create a Google Slides presentation in a specific Drive folder.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Presentation title' },
        folder: { type: 'string', description: 'Google Drive folder ID or name' },
        slides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              layout: { type: 'string', description: 'Slide layout type' },
              title: { type: 'string', description: 'Slide title' },
              body: { type: 'string', description: 'Slide body content' },
            },
          },
          description: 'Array of slide definitions with layout, title, and body',
        },
        comment: { type: 'string', description: 'Optional comment to add to the presentation' },
      },
      required: ['title', 'folder', 'slides'],
    },
  },
  {
    name: 'workspace_search_drive',
    description: 'Search Google Drive for files matching a query.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query string' },
        folder: { type: 'string', description: 'Optional folder ID to scope the search' },
        file_type: {
          type: 'string',
          enum: ['doc', 'sheet', 'slides', 'pdf'],
          description: 'Optional file type filter',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'workspace_read_file',
    description: 'Read the contents of a Google Drive file by its ID.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'Google Drive file ID' },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'workspace_export_pdf',
    description: 'Export a Google Drive file to PDF format.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'Google Drive file ID to export' },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'workspace_add_comment',
    description: 'Add a comment to a Google Drive file.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'Google Drive file ID' },
        content: { type: 'string', description: 'Comment text' },
        anchor: { type: 'string', description: 'Optional anchor text to attach the comment to' },
      },
      required: ['file_id', 'content'],
    },
  },
  {
    name: 'plan_content',
    description: 'Generate a structured slide-by-slide content plan for a presentation (Stage 1 only). Returns a JSON outline with layout types, titles, content, visual descriptions, and speaker notes for each slide. ALWAYS call this first and present the plan to the user for approval BEFORE calling generate_presentation or generate_backgrounds. This avoids burning API/image credits on unapproved content.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'What the presentation is about' },
        context: { type: 'string', description: 'All relevant data, facts, and background the slides should reference' },
        audience: { type: 'string', description: 'Who will see this presentation' },
        slide_count: { type: 'integer', description: 'Number of slides (default 10)' },
        tone: { type: 'string', description: 'Presentation tone (default: professional, data-driven)' },
        include_backgrounds: { type: 'boolean', description: 'Whether to generate AI background images' },
      },
      required: ['topic', 'context'],
    },
  },
  {
    name: 'generate_presentation',
    description: 'Build the full presentation (Stages 2-6: CSS, images, HTML assembly, render, upload). Takes 2-3 minutes. ONLY call this AFTER the user has approved the content plan from plan_content. Pass the approved plan as slide_plan_json to skip re-generating it.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'What the presentation is about' },
        context: { type: 'string', description: 'All relevant data, facts, and background the slides should reference' },
        audience: { type: 'string', description: 'Who will see this presentation' },
        slide_count: { type: 'integer', description: 'Number of slides (default 10)' },
        tone: { type: 'string', description: 'Presentation tone (default: professional, data-driven)' },
        output_format: { type: 'string', enum: ['google_slides', 'pdf'], description: 'Output format (default: pdf)' },
        folder: { type: 'string', description: 'Google Drive folder path to save the presentation' },
        slide_plan_json: { type: 'string', description: 'The approved slide plan JSON from plan_content. Pass this to skip Stage 1.' },
      },
      required: ['topic', 'context'],
    },
  },
  {
    name: 'generate_backgrounds',
    description: 'Generate 2 AI background image options per visual slide using Gemini Imagen, then upload them to a Google Drive folder organized by slide. Use AFTER plan approval and BEFORE generate_presentation when the user wants to choose backgrounds. Pass the approved plan as slide_plan_json.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'What the presentation is about' },
        context: { type: 'string', description: 'Background info and data for the deck' },
        audience: { type: 'string', description: 'Who will see this presentation' },
        slide_count: { type: 'integer', description: 'Number of slides (default 10)' },
        tone: { type: 'string', description: 'Presentation tone' },
        options_per_slide: { type: 'integer', description: 'Number of background options per visual slide (default 2)' },
        folder: { type: 'string', description: 'Google Drive folder to save backgrounds to' },
        slide_plan_json: { type: 'string', description: 'The approved slide plan JSON from plan_content. Pass this to skip re-running Stage 1.' },
      },
      required: ['topic', 'context'],
    },
  },
];

// ─── Lead Engine Tools ──────────────────────────────────────────────────────

const LEAD_ENGINE_TOOLS = [
  {
    name: 'discover_leads',
    description: 'Run the lead discovery engine to find new potential leads using Perplexity search. Returns count of new leads found.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_leads',
    description: 'Get leads from the pipeline. Can filter by status (new, enriched, contacted, responded, meeting, qualified, closed, declined).',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by lead status', enum: ['new', 'enriched', 'contacted', 'responded', 'meeting', 'qualified', 'closed', 'declined'] },
        limit: { type: 'integer', description: 'Max leads to return (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_lead_stats',
    description: 'Get lead pipeline statistics — total leads, contacts, response rates, emails sent, pending drafts.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'generate_outreach',
    description: 'Generate outreach emails for enriched leads that have contacts but no outreach yet.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_outreach_log',
    description: 'Get the outreach log — all emails sent, with status, contact info, and response tracking.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by outreach status (draft, sent, bounced, responded)', enum: ['draft', 'sent', 'bounced', 'responded'] },
        limit: { type: 'integer', description: 'Max entries to return (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'get_reply_inbox',
    description: 'Get all outreach emails that received replies — shows who responded and when.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max replies to return (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'get_followup_queue',
    description: 'Get outreach emails that were sent but never got a reply and are past the follow-up delay — shows overdue follow-ups.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ─── HubSpot CRM Tools (Sangha tenant only) ────────────────────────────────

const HUBSPOT_TOOLS = [
  {
    name: 'search_hubspot_contacts',
    description: 'Search HubSpot CRM for contacts by name, email, company, or keyword. Returns up to 10 matching contacts with email, phone, title, company, lifecycle stage, and lead status.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — name, email, company name, or keyword' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_hubspot_companies',
    description: 'Search HubSpot CRM for companies by name or domain. Returns company details including industry, location, employee count, and revenue.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Company name or domain to search for' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_hubspot_deals',
    description: 'Search HubSpot deal pipeline by deal name, company, or keyword. Returns deal stage, amount, close date, and pipeline.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Deal name, company name, or keyword' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_hubspot_pipeline',
    description: 'Get full HubSpot deal pipeline summary — total deals, total value, and breakdown by stage. Use when asked about pipeline health, deal flow, or overall CRM status.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_hubspot_contact',
    description: 'Create a new contact in HubSpot CRM. Use when the user asks to add someone to the CRM or when syncing a new lead.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Contact email address' },
        first_name: { type: 'string', description: 'First name' },
        last_name: { type: 'string', description: 'Last name' },
        company: { type: 'string', description: 'Company name' },
        title: { type: 'string', description: 'Job title' },
        phone: { type: 'string', description: 'Phone number' },
      },
      required: ['email'],
    },
  },
];

async function callHubSpotTool(toolName, toolInput, tenantId) {
  const hs = await import('./hubspotService.js');

  switch (toolName) {
    case 'search_hubspot_contacts':
      return await hs.searchContacts(toolInput.query);
    case 'search_hubspot_companies':
      return await hs.searchCompanies(toolInput.query);
    case 'search_hubspot_deals':
      return await hs.searchDeals(toolInput.query);
    case 'get_hubspot_pipeline':
      return await hs.getPipelineStats();
    case 'create_hubspot_contact':
      return await hs.createContact({
        email: toolInput.email,
        firstName: toolInput.first_name,
        lastName: toolInput.last_name,
        company: toolInput.company,
        title: toolInput.title,
        phone: toolInput.phone,
        source: 'Coppice Hivemind',
      });
    default:
      throw new Error(`Unknown HubSpot tool: ${toolName}`);
  }
}

// ─── Email Security Tools (Hivemind only) ───────────────────────────────────

const EMAIL_SECURITY_TOOLS = [
  {
    name: 'add_trusted_sender',
    description: 'Add an email address or domain to the trusted senders list. Trusted senders get automatic responses from the agent. Use when the user asks to whitelist, trust, or add a sender.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['email', 'domain'], description: 'Whether this is a full email address or a domain' },
        value: { type: 'string', description: 'The email address (e.g. john@acme.com) or domain (e.g. @acme.com or acme.com)' },
      },
      required: ['type', 'value'],
    },
  },
  {
    name: 'remove_trusted_sender',
    description: 'Remove an email address or domain from the trusted senders list. Use when the user asks to remove, untrust, or delete a sender from the whitelist.',
    input_schema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'The email address or domain to remove' },
      },
      required: ['value'],
    },
  },
  {
    name: 'list_trusted_senders',
    description: 'List all trusted senders for this tenant. Use when the user asks who the trusted senders are, what the whitelist looks like, or wants to see email security settings.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

const EMAIL_SECURITY_PROMPT_ADDON = `

You can manage the email security whitelist:
- add_trusted_sender: Add an email or domain to the trusted senders list
- remove_trusted_sender: Remove an entry from the trusted senders list
- list_trusted_senders: Show all trusted senders grouped by type

Examples: "Add @turnerconstruction.com to trusted senders", "Remove noreply@spam.com", "Who are our trusted senders?"`;

async function callEmailSecurityTool(toolName, toolInput, tenantId) {
  const { getTrustedSenders, addTrustedSender, removeTrustedSender } = await import('../cache/database.js');

  switch (toolName) {
    case 'add_trusted_sender': {
      let value = toolInput.value.trim();
      const isEmail = toolInput.type === 'email';
      if (!isEmail) {
        // Normalize domain — strip leading @
        value = value.replace(/^@/, '');
      }
      addTrustedSender({
        tenantId,
        email: isEmail ? value : null,
        domain: isEmail ? null : value,
        displayName: null,
        trustLevel: 'trusted',
        notes: 'Added via Hivemind',
      });
      const displayVal = isEmail ? value : `@${value}`;
      return { success: true, message: `Done — emails from ${displayVal} will now get automatic responses.` };
    }
    case 'remove_trusted_sender': {
      const value = toolInput.value.trim().replace(/^@/, '');
      const senders = getTrustedSenders(tenantId);
      const match = senders.find(s =>
        (s.email && s.email.toLowerCase() === value.toLowerCase()) ||
        (s.domain && s.domain.toLowerCase() === value.toLowerCase())
      );
      if (!match) {
        return { success: false, message: `No trusted sender found matching "${toolInput.value}".` };
      }
      removeTrustedSender(match.id);
      const displayVal = match.email || `@${match.domain}`;
      return { success: true, message: `Removed — ${displayVal} will no longer get automatic responses.` };
    }
    case 'list_trusted_senders': {
      const senders = getTrustedSenders(tenantId);
      if (senders.length === 0) {
        return { message: 'No trusted senders configured yet.' };
      }
      const domains = senders.filter(s => s.domain).map(s => `@${s.domain}`);
      const emails = senders.filter(s => s.email).map(s => s.email);
      let result = '';
      if (domains.length > 0) result += `**Trusted Domains (${domains.length}):**\n${domains.map(d => `• ${d}`).join('\n')}\n\n`;
      if (emails.length > 0) result += `**Trusted Emails (${emails.length}):**\n${emails.map(e => `• ${e}`).join('\n')}`;
      return { message: result.trim(), count: senders.length };
    }
    default:
      throw new Error(`Unknown email security tool: ${toolName}`);
  }
}

// ─── Knowledge Search Tool ──────────────────────────────────────────────────

const KNOWLEDGE_TOOLS = [
  {
    name: 'search_knowledge',
    description: 'Search meeting notes, documents, entity profiles, and action items. Use when the user asks about past discussions, action items, people, companies, deal status, or project updates.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — person name, company, topic, or keyword' },
        type: { type: 'string', enum: ['meeting', 'document', 'entity', 'task', 'all'], description: 'Type of knowledge to search. Default: all' },
      },
      required: ['query'],
    },
  },
];

// ─── Mining / IPP Tools (Sangha tenant) ─────────────────────────────────────

// ─── Web Browsing Tools ──────────────────────────────────────────────────────

const WEB_TOOLS = [
  {
    name: 'browse_url',
    description: 'Fetch a webpage and extract its text content, title, and links. Use when the user asks to look at a URL, research a website, or check something online.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to fetch (https://...)' },
        extract: { type: 'string', enum: ['text', 'links', 'all'], description: 'What to extract (default: all)' },
      },
      required: ['url'],
    },
  },
];

async function callWebTool(toolName, toolInput) {
  if (toolName === 'browse_url') {
    const { browseUrl } = await import('./webBrowseService.js');
    return await browseUrl(toolInput.url, { extract: toolInput.extract || 'all' });
  }
  throw new Error(`Unknown web tool: ${toolName}`);
}

// ─── Legal Document Tools ────────────────────────────────────────────────────

const LEGAL_TOOLS = [
  {
    name: 'generate_legal_doc',
    description: 'Generate a legal document (NDA or Service Agreement) from a template. Fills in parties, terms, dates, and governing law. Returns document content that can be saved to Google Docs.',
    input_schema: {
      type: 'object',
      properties: {
        template: { type: 'string', enum: ['nda_mutual', 'nda_one_way', 'msa'], description: 'Document template type' },
        party_a: { type: 'string', description: 'First party (your company name and state)' },
        party_b: { type: 'string', description: 'Second party (counterparty name and state)' },
        effective_date: { type: 'string', description: 'Effective date (default: today)' },
        duration_months: { type: 'integer', description: 'Duration in months (default: 24)' },
        governing_state: { type: 'string', description: 'Governing law state (default: Texas)' },
        additional_terms: { type: 'string', description: 'Any custom terms or modifications' },
        services_description: { type: 'string', description: 'MSA only: description of services' },
        payment_terms: { type: 'string', description: 'MSA only: payment terms (e.g. Net 30)' },
      },
      required: ['template', 'party_a', 'party_b'],
    },
  },
];

async function callLegalTool(toolName, toolInput, tenantId) {
  if (toolName === 'generate_legal_doc') {
    const { generateLegalDoc } = await import('./legalDocService.js');
    const doc = generateLegalDoc(toolInput);

    // Generate a DOCX file for attachment
    const { generateDocx } = await import('./documentService.js');
    const fileResult = await generateDocx({ title: doc.title, content: doc.content });

    // Also try Google Drive
    let googleDoc = null;
    try {
      const wsResult = await callWorkspaceTool('workspace_create_doc', {
        title: doc.title,
        content: doc.content,
        folder: 'Legal Documents',
      }, tenantId);
      googleDoc = wsResult;
    } catch (wsErr) {
      // Non-critical — file attachment still works
    }

    return { ...doc, file: fileResult, google_doc: googleDoc };
  }
  throw new Error(`Unknown legal tool: ${toolName}`);
}

// ─── Document Generation Tools ───────────────────────────────────────────────

const DOCUMENT_TOOLS = [
  {
    name: 'generate_document',
    description: 'Generate a formatted document (DOCX or PDF). Use for reports, memos, proposals, summaries, or any document the user requests. Returns a file that can be attached to an email reply.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Full document content in markdown format. Use # for headings, ** for bold, * for italic, - for bullet lists, numbered lists, --- for horizontal rules.' },
        format: { type: 'string', enum: ['docx', 'pdf'], description: 'Output format (default: docx)' },
        filename: { type: 'string', description: 'Custom filename (without extension)' },
      },
      required: ['title', 'content'],
    },
  },
];

async function callDocumentTool(toolName, toolInput, tenantId) {
  if (toolName === 'generate_document') {
    const { generateDocument } = await import('./documentService.js');
    const result = await generateDocument(toolInput);
    return result;
  }
  throw new Error(`Unknown document tool: ${toolName}`);
}

const DOCUMENT_TOOLS_PROMPT_ADDON = `

You can generate formatted documents on request:
- generate_document: Create DOCX or PDF files (reports, memos, proposals, summaries, letters, any document)
Write the full content in markdown format. The document will be generated and attached to your email reply or available for download.`;

// ─── Calendar Tools ──────────────────────────────────────────────────────────

const CALENDAR_TOOLS = [
  {
    name: 'create_meeting',
    description: 'Create a Google Calendar event with a Google Meet video link. Use when someone asks to schedule a meeting, call, or working session. Returns the event link and Meet URL.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title (e.g., "DACP Estimating Walkthrough")' },
        description: { type: 'string', description: 'Event description or agenda' },
        start_time: { type: 'string', description: 'Start time in ISO 8601 format (e.g., "2026-03-20T09:00:00-06:00" for 9am CST)' },
        end_time: { type: 'string', description: 'End time in ISO 8601 format (e.g., "2026-03-20T10:00:00-06:00" for 10am CST)' },
        duration_minutes: { type: 'number', description: 'Duration in minutes (used if end_time not provided, default 60)' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of attendee email addresses to invite',
        },
        timezone: { type: 'string', description: 'Timezone (default: America/Chicago for CST)' },
      },
      required: ['title', 'start_time', 'attendees'],
    },
  },
];

async function callCalendarTool(toolName, toolInput, tenantId) {
  if (toolName === 'create_meeting') {
    const { google } = await import('googleapis');
    const { getTenantDb } = await import('../cache/database.js');

    // Get the tenant's refresh token from tenant_email_config
    const resolvedTenant = tenantId || 'default';
    let refreshToken = process.env.GMAIL_REFRESH_TOKEN; // fallback to default agent

    try {
      const tdb = getTenantDb(resolvedTenant);
      const row = tdb.prepare('SELECT gmail_refresh_token FROM tenant_email_config WHERE tenant_id = ? LIMIT 1').get(resolvedTenant);
      if (row?.gmail_refresh_token) refreshToken = row.gmail_refresh_token;
    } catch {}

    if (!refreshToken) throw new Error('No calendar credentials configured for this tenant');

    const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
    const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
    const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    auth.setCredentials({ refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth });

    const tz = toolInput.timezone || 'America/Chicago';
    let endTime = toolInput.end_time;
    if (!endTime) {
      const start = new Date(toolInput.start_time);
      const durationMs = (toolInput.duration_minutes || 60) * 60 * 1000;
      endTime = new Date(start.getTime() + durationMs).toISOString();
    }

    const event = {
      summary: toolInput.title,
      description: toolInput.description || '',
      start: { dateTime: toolInput.start_time, timeZone: tz },
      end: { dateTime: endTime, timeZone: tz },
      attendees: (toolInput.attendees || []).map(email => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: `coppice-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };

    const result = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
      sendUpdates: 'all',
    });

    const meetLink = result.data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri;

    return {
      eventId: result.data.id,
      htmlLink: result.data.htmlLink,
      meetLink: meetLink || null,
      summary: result.data.summary,
      start: result.data.start,
      end: result.data.end,
      attendees: (result.data.attendees || []).map(a => a.email),
      status: 'created',
    };
  }
  throw new Error(`Unknown calendar tool: ${toolName}`);
}

// ─── DACP Estimation Tools ───────────────────────────────────────────────────

const DACP_TOOLS = [
  {
    name: 'lookup_pricing',
    description: 'Look up DACP Construction pricing from the master pricing database. Returns unit prices for concrete work items (SOG, curb & gutter, rebar, sidewalks, etc.) with material, labor, and equipment cost breakdowns. Use when someone asks about pricing, rates, or costs for concrete work.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by category (e.g. "Flatwork", "Rebar", "Curb & Gutter", "Foundation"). Leave empty for all pricing.' },
      },
    },
  },
  {
    name: 'get_bid_requests',
    description: 'Get bid requests / RFQs received by DACP Construction. Returns bid details including GC name, scope, due date, status, and urgency.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['new', 'reviewing', 'estimated', 'sent', 'won', 'lost', 'declined'], description: 'Filter by status. Leave empty for all.' },
        id: { type: 'string', description: 'Get a specific bid request by ID' },
      },
    },
  },
  {
    name: 'get_estimates',
    description: 'Get estimates created by DACP Construction. Returns line items, subtotals, overhead, profit, mobilization, and total bid amount.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Get a specific estimate by ID. Leave empty for all estimates.' },
      },
    },
  },
  {
    name: 'create_estimate',
    description: 'Create a new concrete estimate for a project. Provide line items with quantities, units, and unit prices. The system calculates subtotal, applies overhead/profit percentages, adds mobilization, and returns the total bid.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Project name' },
        gc_name: { type: 'string', description: 'General contractor name' },
        bid_request_id: { type: 'string', description: 'Associated bid request ID (if applicable)' },
        line_items: {
          type: 'array',
          description: 'Array of line items',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit: { type: 'string' },
              unit_price: { type: 'number' },
            },
            required: ['description', 'quantity', 'unit', 'unit_price'],
          },
        },
        overhead_pct: { type: 'number', description: 'Overhead percentage (default: 10)' },
        profit_pct: { type: 'number', description: 'Profit percentage (default: 10)' },
        mobilization: { type: 'number', description: 'Mobilization cost (default: 2500)' },
        notes: { type: 'string', description: 'Additional notes or assumptions' },
      },
      required: ['project_name', 'line_items'],
    },
  },
  {
    name: 'get_jobs',
    description: 'Get DACP Construction jobs/projects. Returns project details including status, estimated vs actual cost, bid amount, margin, and dates.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'complete', 'lost', 'pending'], description: 'Filter by status. Leave empty for all.' },
        id: { type: 'string', description: 'Get a specific job by ID' },
      },
    },
  },
  {
    name: 'get_dacp_stats',
    description: 'Get DACP Construction business statistics: bid request counts, estimate counts, job win/loss rates, average margins, total revenue, and field report counts.',
    input_schema: { type: 'object', properties: {} },
  },
];

async function callDacpTool(toolName, toolInput, tenantId) {
  const {
    getDacpPricing, getDacpBidRequests, getDacpBidRequest,
    getDacpEstimates, getDacpEstimate, createDacpEstimate,
    getDacpJobs, getDacpJob, getDacpStats, updateDacpBidRequest,
  } = await import('../cache/database.js');
  const tid = tenantId || 'dacp-construction-001';

  switch (toolName) {
    case 'lookup_pricing':
      return getDacpPricing(tid, toolInput.category || null);
    case 'get_bid_requests':
      if (toolInput.id) return getDacpBidRequest(tid, toolInput.id);
      return getDacpBidRequests(tid, toolInput.status || null);
    case 'get_estimates':
      if (toolInput.id) return getDacpEstimate(tid, toolInput.id);
      return getDacpEstimates(tid);
    case 'create_estimate': {
      const items = toolInput.line_items || [];
      const subtotal = items.reduce((sum, i) => sum + (i.quantity * i.unit_price), 0);
      const overheadPct = toolInput.overhead_pct ?? 10;
      const profitPct = toolInput.profit_pct ?? 10;
      const mobilization = toolInput.mobilization ?? 2500;
      const totalBid = Math.round(subtotal * (1 + overheadPct / 100) * (1 + profitPct / 100) + mobilization);
      const id = `est-${Date.now().toString(36)}`;
      createDacpEstimate({
        id, tenantId: tid,
        bidRequestId: toolInput.bid_request_id || null,
        projectName: toolInput.project_name,
        gcName: toolInput.gc_name || '',
        status: 'draft',
        lineItemsJson: JSON.stringify(items),
        subtotal, overheadPct, profitPct, mobilization, totalBid,
        confidence: 'medium',
        notes: toolInput.notes || '',
      });
      if (toolInput.bid_request_id) {
        try { updateDacpBidRequest(tid, toolInput.bid_request_id, { status: 'estimated' }); } catch {}
      }
      return { id, projectName: toolInput.project_name, lineItems: items, subtotal, overheadPct, profitPct, mobilization, totalBid };
    }
    case 'get_jobs':
      if (toolInput.id) return getDacpJob(tid, toolInput.id);
      return getDacpJobs(tid, toolInput.status || null);
    case 'get_dacp_stats':
      return getDacpStats(tid);
    default:
      throw new Error(`Unknown DACP tool: ${toolName}`);
  }
}

const DACP_TOOLS_PROMPT_ADDON = `

You have access to DACP Construction's estimating and project database:
- lookup_pricing: Look up unit prices from the master pricing table (material, labor, equipment breakdowns)
- get_bid_requests: View incoming RFQs/bid requests from GCs (status, scope, due dates)
- get_estimates: View existing estimates with line items and totals
- create_estimate: Build a new estimate with line items, overhead, profit, and mobilization
- get_jobs: View project history (active, complete, won/lost, margins)
- get_dacp_stats: Get overall business statistics (win rates, revenue, pipeline)

When asked to estimate concrete work, ALWAYS use lookup_pricing first to get current rates, then create_estimate with proper line items. Be precise with quantities and units.`;

// ─── Mining / IPP Spec Tools ─────────────────────────────────────────────────

const MINING_TOOLS = [
  {
    name: 'generate_mine_specs',
    description: 'Generate a mine specification report for an IPP (Independent Power Producer). Takes generation data (capacity, MWh, nodal price, etc.) and returns fleet sizing, revenue projections across bull/base/bear hashprice scenarios, infrastructure requirements, and financial summary. Use when someone asks about mine specs, BTM mining analysis, or IPP evaluation.',
    input_schema: {
      type: 'object',
      properties: {
        capacity_mw: { type: 'number', description: 'Nameplate capacity in MW' },
        annual_generation_mwh: { type: 'number', description: 'Annual generation in MWh' },
        avg_nodal_price: { type: 'number', description: 'Average nodal price in $/MWh (default: 25)' },
        generation_hours: { type: 'number', description: 'Productive generation hours per year' },
        curtailment_pct: { type: 'number', description: 'Curtailment rate as percentage (default: 0)' },
        facility_type: { type: 'string', enum: ['Solar', 'Wind', 'Natural Gas', 'Renewable'], description: 'Type of generation facility' },
        location: { type: 'string', description: 'Facility location (e.g. "West Texas, ERCOT West")' },
        facility_name: { type: 'string', description: 'Name of the facility' },
      },
      required: ['capacity_mw'],
    },
  },
];

async function callMiningTool(toolName, toolInput, tenantId) {
  if (toolName === 'generate_mine_specs') {
    const { runPricingAnalysis, generateMineSpecExcel } = await import('./ippPipeline.js');

    const data = {
      capacityMW: toolInput.capacity_mw,
      annualGenerationMWh: toolInput.annual_generation_mwh || null,
      generationHours: toolInput.generation_hours || null,
      curtailmentPct: toolInput.curtailment_pct || 0,
      facilityType: toolInput.facility_type || 'Renewable',
      location: toolInput.location || null,
      facilityName: toolInput.facility_name || null,
    };

    // Derive missing fields
    if (!data.annualGenerationMWh) {
      const cfMap = { Solar: 0.25, Wind: 0.35, 'Natural Gas': 0.85, Renewable: 0.30 };
      data.annualGenerationMWh = Math.round(data.capacityMW * 8760 * (cfMap[data.facilityType] || 0.30));
    }
    if (!data.generationHours) {
      data.generationHours = Math.round(data.annualGenerationMWh / data.capacityMW);
    }

    const analysis = runPricingAnalysis(data, 'Base');
    const { filepath, filename } = await generateMineSpecExcel(analysis, data);
    const w = analysis.winner;

    return {
      optimalMineSize: `${analysis.bestMineSize} MW`,
      scenario: `${analysis.scenario} ($${analysis.hashprice}/PH/day)`,
      strikePrice: `$${analysis.strikePrice}/MWh`,
      facility: `${data.capacityMW}MW ${data.facilityType}`,
      annualGeneration: `${(data.annualGenerationMWh || analysis.totalGeneration).toLocaleString()} MWh`,
      hoursAnalyzed: analysis.totalHoursProcessed,
      winner: {
        btmOfftake: `${w.annual_btm_offtake_MWh?.toLocaleString()} MWh`,
        annualImport: `${w.annual_import_MWh?.toLocaleString()} MWh`,
        mineUptime: `${w.uptime_pct}%`,
        avgBlendedLmp: `$${w.avg_blended_lmp}/MWh`,
        allInElectricityCost: `$${w.all_in_electricity_cost_miner}/MWh`,
        curtailmentHours: w.curtailment_hours,
        ippRevenueGrid: `$${w.ipp_revenue_base_mwh}/MWh ($${w.ipp_revenue_base_dollar?.toLocaleString()}/yr)`,
        ippRevenueOfftake: `$${w.ipp_revenue_offtake_mwh}/MWh ($${w.ipp_revenue_offtake_dollar?.toLocaleString()}/yr)`,
        ippRevenueVI: `$${w.ipp_revenue_vi_mwh}/MWh ($${w.ipp_revenue_vi_dollar?.toLocaleString()}/yr)`,
        dealValueOfftake: `$${w.deal_value_offtake_mwh}/MWh ($${w.deal_value_offtake_dollar?.toLocaleString()}/yr)`,
        dealValueVI: `$${w.deal_value_vi_mwh}/MWh ($${w.deal_value_vi_dollar?.toLocaleString()}/yr)`,
      },
      mineSizeSensitivity: analysis.allResults.map(r => ({
        size: `${r.mine_size}MW`,
        dealValuePerMwh: `$${r.deal_value_vi_per_mwh}/MWh`,
        dealValueAnnual: `$${r.deal_value_vi?.toLocaleString()}`,
        allInCost: `$${r.all_in_electricity_cost}/MWh`,
        uptime: `${r.mine_uptime_pct}%`,
        best: r.mine_size === analysis.bestMineSize,
      })),
      excelFile: filename,
      excelPath: filepath,
    };
  }
  throw new Error(`Unknown mining tool: ${toolName}`);
}

// ─── Email Tools ──────────────────────────────────────────────────────────────

const EMAIL_TOOLS = [
  {
    name: 'send_email',
    description: 'Send an email on behalf of the team. Use this when the user asks you to email someone, draft and send a message, or reply to a thread.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Email body (plain text)' },
        cc: { type: 'string', description: 'CC recipients (comma-separated)' },
        bcc: { type: 'string', description: 'BCC recipients (comma-separated)' },
        attachment_path: { type: 'string', description: 'Path to a file to attach (e.g. an Excel report generated by generate_mine_specs)' },
        attachment_filename: { type: 'string', description: 'Display filename for the attachment' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'list_emails',
    description: 'List recent emails from the inbox. Use this when the user asks to check email, see what came in, or look at recent messages.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g. "from:john@example.com", "subject:proposal", "is:unread"). Defaults to recent emails.' },
        max_results: { type: 'number', description: 'Number of emails to return (default 10, max 20)' },
      },
    },
  },
  {
    name: 'read_email',
    description: 'Read the full content of a specific email by its message ID. Use after list_emails to read a specific message.',
    input_schema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Gmail message ID' },
      },
      required: ['message_id'],
    },
  },
];

function getEmailPromptAddon(tenantId) {
  const emailMap = {
    'default': 'agent@sangha.coppice.ai',
    'dacp-construction-001': 'agent@dacp.coppice.ai',
    'zhan-capital': 'agent@zhan.coppice.ai',
  };
  const email = emailMap[tenantId] || 'agent@zhan.coppice.ai';
  return `

You have full email access via ${email}. You can:
- Send emails on behalf of the team (send_email)
- Check the inbox and search for emails (list_emails)
- Read the full content of any email (read_email)

When sending emails, use a professional tone. Always confirm with the user before sending unless they explicitly told you to send it.`;
}

async function callEmailTool(toolName, toolInput, tenantId) {
  const { google } = await import('googleapis');

  // Build Gmail client for this tenant
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  let refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  // Check for tenant-specific email config
  try {
    const { getTenantEmailConfig } = await import('../cache/database.js');
    const config = getTenantEmailConfig(tenantId);
    if (config?.gmailRefreshToken) {
      refreshToken = config.gmailRefreshToken;
    }
  } catch {}

  if (!clientId || !clientSecret || !refreshToken) {
    return { error: 'Email not configured — missing Gmail API credentials' };
  }

  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:8099');
  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

  if (toolName === 'send_email') {
    const { sendEmail, sendEmailWithAttachments } = await import('./emailService.js');
    const attachments = [];
    if (toolInput.attachment_path) {
      attachments.push({
        path: toolInput.attachment_path,
        filename: toolInput.attachment_filename || toolInput.attachment_path.split('/').pop(),
        contentType: toolInput.attachment_path.endsWith('.xlsx')
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/octet-stream',
      });
    }
    const result = await sendEmailWithAttachments({
      to: toolInput.to,
      subject: toolInput.subject,
      body: toolInput.body,
      cc: toolInput.cc || undefined,
      bcc: toolInput.bcc || undefined,
      attachments,
      tenantId,
    });
    return { success: true, messageId: result.messageId, message: `Email sent to ${toolInput.to}${attachments.length ? ' with attachment' : ''}` };
  }

  if (toolName === 'list_emails') {
    const maxResults = Math.min(toolInput.max_results || 10, 20);
    const query = toolInput.query || 'newer_than:7d';

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) return { emails: [], message: 'No emails found matching your query.' };

    const emails = [];
    for (const msg of messages) {
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });
      const headers = full.data.payload?.headers || [];
      emails.push({
        id: msg.id,
        threadId: full.data.threadId,
        from: headers.find(h => h.name === 'From')?.value || '',
        to: headers.find(h => h.name === 'To')?.value || '',
        subject: headers.find(h => h.name === 'Subject')?.value || '',
        date: headers.find(h => h.name === 'Date')?.value || '',
        snippet: full.data.snippet || '',
        unread: (full.data.labelIds || []).includes('UNREAD'),
      });
    }
    return { emails, count: emails.length };
  }

  if (toolName === 'read_email') {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: toolInput.message_id,
      format: 'full',
    });
    const headers = full.data.payload?.headers || [];

    // Extract body
    function extractBody(payload) {
      if (!payload) return '';
      if (payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            return Buffer.from(part.body.data, 'base64url').toString('utf-8');
          }
        }
        for (const part of payload.parts) {
          const nested = extractBody(part);
          if (nested) return nested;
        }
      }
      return '';
    }

    return {
      id: toolInput.message_id,
      threadId: full.data.threadId,
      from: headers.find(h => h.name.toLowerCase() === 'from')?.value || '',
      to: headers.find(h => h.name.toLowerCase() === 'to')?.value || '',
      cc: headers.find(h => h.name.toLowerCase() === 'cc')?.value || '',
      subject: headers.find(h => h.name.toLowerCase() === 'subject')?.value || '',
      date: headers.find(h => h.name.toLowerCase() === 'date')?.value || '',
      body: extractBody(full.data.payload),
      labels: full.data.labelIds || [],
    };
  }

  throw new Error(`Unknown email tool: ${toolName}`);
}

async function callKnowledgeTool(toolName, toolInput, tenantId) {
  if (toolName === 'search_knowledge') {
    const results = { entries: [], entities: [], actionItems: [] };
    const query = toolInput.query;
    const type = toolInput.type || 'all';

    if (type === 'all' || type === 'meeting' || type === 'document') {
      results.entries = searchKnowledge(tenantId, query, { type: type === 'all' ? undefined : type, limit: 5 });
      // Include content for the top result
      if (results.entries.length > 0 && results.entries[0].content) {
        results.fullContent = results.entries[0].content;
      }
    }

    if (type === 'all' || type === 'entity') {
      const { getEntityKnowledge } = await import('./knowledgeProcessor.js');
      const entityResult = getEntityKnowledge(tenantId, query);
      if (entityResult.entity) {
        results.entities.push({
          name: entityResult.entity.name,
          type: entityResult.entity.entity_type,
          metadata: entityResult.entity.metadata_json ? JSON.parse(entityResult.entity.metadata_json) : {},
          relatedEntries: entityResult.entries.map(e => ({ title: e.title, type: e.type, date: e.recorded_at || e.created_at })),
        });
      }
    }

    if (type === 'all' || type === 'task') {
      const actions = getOpenActionItems(tenantId, 20);
      // Filter by query if searching for a specific person or topic
      const q = query.toLowerCase();
      results.actionItems = actions.filter(a =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.assignee || '').toLowerCase().includes(q)
      );
      if (results.actionItems.length === 0 && type === 'task') {
        results.actionItems = actions; // Return all if no specific match
      }
    }

    return results;
  }
  throw new Error(`Unknown knowledge tool: ${toolName}`);
}

// ─── Knowledge Context Builder ──────────────────────────────────────────────

function buildKnowledgeContext(tenantId, userMessage) {
  const contextBlocks = [];

  try {
    // Search knowledge base for relevant entries
    const relevant = searchKnowledge(tenantId, userMessage, { limit: 5 });
    if (relevant.length > 0) {
      let kb = 'RELEVANT KNOWLEDGE BASE ENTRIES:\n\n';
      for (const entry of relevant) {
        kb += `[${(entry.type || '').toUpperCase()}] ${entry.title} (${entry.recorded_at || entry.created_at})\n`;
        if (entry.summary) kb += `${entry.summary}\n`;
        if (entry.linked_entities) kb += `Related: ${entry.linked_entities}\n`;
        kb += '\n';
      }
      contextBlocks.push(kb);
    }

    // Get open action items
    const actions = getOpenActionItems(tenantId, 10);
    if (actions.length > 0) {
      let ai = 'OPEN ACTION ITEMS:\n';
      for (const item of actions) {
        ai += `- ${item.title}`;
        if (item.assignee) ai += ` (${item.assignee})`;
        if (item.due_date) ai += ` — due ${item.due_date}`;
        ai += '\n';
      }
      contextBlocks.push(ai);
    }
  } catch (err) {
    // Non-fatal — proceed without knowledge context
  }

  return contextBlocks.length > 0 ? '\n\n---\n\n' + contextBlocks.join('\n\n---\n\n') : '';
}

// ─── Workspace Tool Caller ──────────────────────────────────────────────────

async function callWorkspaceTool(toolName, toolInput, tenantId) {
  const url = `${WORKSPACE_AGENT_URL}/tools/${toolName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
      'X-Internal-Secret': 'dev-secret',
    },
    body: JSON.stringify(toolInput),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Workspace tool ${toolName} failed (${res.status}): ${errText}`);
  }
  return res.json();
}

// ─── Lead Engine Tool Caller ─────────────────────────────────────────────────

async function callLeadEngineTool(toolName, toolInput, tenantId) {
  // Lazy import to avoid circular dependency
  const le = await import('./leadEngine.js');

  switch (toolName) {
    case 'discover_leads':
      return await le.discoverLeads(tenantId);
    case 'get_leads': {
      const { getLeads: dbGetLeads } = await import('../cache/database.js');
      const leads = dbGetLeads(tenantId, toolInput.status || null, toolInput.limit || 20);
      return { leads, count: leads.length };
    }
    case 'get_lead_stats': {
      const { getLeadStats: dbGetStats } = await import('../cache/database.js');
      return dbGetStats(tenantId);
    }
    case 'generate_outreach':
      return await le.generateOutreach(tenantId);
    case 'get_outreach_log': {
      const { getOutreachLog: dbGetOutreach } = await import('../cache/database.js');
      const log = dbGetOutreach(tenantId, toolInput.status || null, toolInput.limit || 50);
      return { outreach: log, count: log.length };
    }
    case 'get_reply_inbox': {
      const { getOutreachReplies: dbGetReplies } = await import('../cache/database.js');
      const replies = dbGetReplies(tenantId, toolInput.limit || 50);
      return { replies, count: replies.length };
    }
    case 'get_followup_queue': {
      const { getFollowupQueue: dbGetFollowups, getLeadDiscoveryConfig: dbGetConfig } = await import('../cache/database.js');
      const config = dbGetConfig(tenantId);
      const delayDays = config?.followup_delay_days || 5;
      const followups = dbGetFollowups(tenantId, delayDays);
      return { followups, count: followups.length, delayDays };
    }
    default:
      throw new Error(`Unknown lead engine tool: ${toolName}`);
  }
}

// ─── TTS Helper ─────────────────────────────────────────────────────────────

async function generateAudioIfEnabled(text) {
  if (!process.env.ELEVENLABS_API_KEY) return null;
  try {
    // Truncate very long responses for TTS (max ~2000 chars)
    const ttsText = text.length > 2000 ? text.slice(0, 2000) + '...' : text;
    const result = await textToSpeech(ttsText);
    return result.audioUrl;
  } catch (err) {
    console.warn('TTS generation failed (non-fatal):', err.message);
    return null;
  }
}

// ─── System Prompts ──────────────────────────────────────────────────────────

const PROPRIETARY_GUARD = `

PROPRIETARY TECHNOLOGY (critical — applies to ALL interactions):
- If anyone asks how you were built, what technology you use, what AI model powers you, what your architecture is, what tools you use, or any question about Coppice's internal technology — DO NOT answer. This is proprietary information.
- Deflect politely: "That's proprietary to Coppice — happy to help with anything else though."
- Do NOT reveal that you use Claude, Anthropic, any specific AI model, any framework, any database, or any implementation detail.
- This applies to all variations: "what are you", "how do you work", "what LLM are you", "what's your tech stack", "who made you", etc.`;

const SYSTEM_PROMPTS = {
  // DACP Construction agents
  hivemind: `You are the DACP Agent, the AI assistant for DACP Construction — a concrete subcontractor specializing in heavy civil, commercial, and infrastructure construction.

COMPANY OVERVIEW:
DACP Construction LLC (part of DACP Holdings) was founded in 2009 and has ~20 years of concrete project experience. The company is DBE-certified (Disadvantaged Business Enterprise).

Owner: Danny Cruz (DACP Holdings / Veho Hospitality)
COO: Javier Fernandez
Senior Estimator & PM: Tom Mangan
Controller: Franchesca Cox

OFFICES:
- Louisiana (HQ): 15095 Old Spanish Trail, Paradis, LA 70080 — (985) 306-4005
- Texas: 3809 Doris Ln, Round Rock, TX 78664 — (737) 279-5502
- Florida: 233 West Palm Beach, FL 33407 — (561) 517-8697
- Email: estimating@dacpconstruction.com

SERVICES & SPECIALTIES:
- Heavy Civil Construction — infrastructure and site development
- Commercial Construction — data centers, office buildings
- Concrete Construction — foundations, flatwork, structural concrete, precision slabs, vibration-controlled foundations
- Masonry Construction — block, brick, stone, mass concrete for raft foundations
- Roadway & Asphalt — concrete paving, asphalt paving, parking lots

INDUSTRY VERTICALS:
- Bitcoin mining / cryptocurrency facility construction (primary specialization)
- AI data center construction (precision slabs, vibration-controlled foundations for 24/7 mission-critical operations)
- Educational facilities, aviation/airports, medical facilities, water treatment, municipal/public works

LICENSES (Louisiana): Building Construction, Highway/Street/Bridge, Heavy Construction, Municipal/Public Works, Asphalt/Concrete, Foundations, Lathing/Plastering/Stucco

NOTABLE PROJECT — Riot Platforms Corsicana Facility:
DACP served as concrete subcontractor on Riot Platforms' Corsicana facility in Navarro County, TX — a 1 GW total capacity site (expected to be the largest Bitcoin mining facility in the world). Phase 1 was a $333M investment on 265 acres using immersion-cooling technology. Riot is evaluating remaining 600 MW for AI/HPC uses.

STANDARD PRICING:
- SOG (Slab on Grade): ~$14/SF
- Curb & Gutter: ~$26/LF
- Sidewalks: ~$10-11/SF
- #4 Rebar: ~$1.49/LF
- Typical markups: 10-15% overhead, 10% profit, $2,500-5,000 mobilization

You coordinate across all departments: estimating, field operations, documents, meetings, and email.

You can help with:
- Answering questions about DACP's capabilities, services, past projects, and pricing
- Routing tasks to the right sub-agent (estimating, documents, meetings, email)
- Generating estimates and bid proposals for concrete work
- Answering questions about active jobs, bids, and field reports
- Looking up pricing, job history, and company data
- Drafting RFQ responses, bid letters, and project correspondence
- General project management and business questions

You have access to Google Workspace tools — you can create Docs, Sheets, and Slides, search Drive, and add comments to files.

When the user requests a PDF, report, or document:
- Before generating, ask what style they prefer:
  Option 1: Clean/legal — plain text, numbered sections, no cover page
  Option 2: Formatted — branded cover page with background image, styled headings, professional layout

When the user requests a presentation or pitch deck:
- Ask if they want AI-generated background images for each slide (adds ~60 seconds per slide)
- Ask about tone: formal/corporate, casual/startup, or data-heavy

Keep responses concise and professional. Use construction industry terminology naturally. When referencing numbers, be specific with quantities, units, and pricing.`,

  estimating: `You are the Estimating Bot for DACP Construction, a concrete subcontractor in Houston, Texas. You specialize in concrete estimating and bid preparation.

Your knowledge includes:
- Concrete work: foundations, slabs, curb & gutter, sidewalks, retaining walls, elevated decks, post-tension
- Standard pricing: SOG ~$14/SF, curb & gutter ~$26/LF, sidewalks ~$10-11/SF, #4 rebar ~$1.49/LF
- Typical markups: 10-15% overhead, 10% profit, mobilization $2,500-5,000
- Houston-area market conditions and GC relationships

When estimating:
- Break down scope into line items with quantities, units, and unit prices
- Show subtotals, overhead, profit, and total
- Reference similar past jobs when relevant
- Flag missing information or assumptions
- Be precise with numbers, round to nearest dollar

You can create Google Docs, Sheets, and Slides to produce estimates, bid packages, and comparison tables.

Keep responses focused on estimating. If asked about something outside your scope, suggest the right agent.`,

  documents: `You are the Documents Agent for DACP Construction. You help manage and search the company's document library including plans, specifications, contracts, submittals, and drawings.

You can help with:
- Finding specific documents or drawings
- Extracting information from uploaded files
- Organizing and categorizing documents
- Answering questions about project specifications

Keep responses concise. Reference specific document names and sections when possible.`,

  meetings: `You are the Meeting Bot for DACP Construction. You help with meeting notes, transcripts, action items, and scheduling.

You can help with:
- Summarizing past meetings
- Tracking action items and decisions
- Searching across meeting transcripts
- Preparing agendas for upcoming meetings

Keep responses concise. Reference specific meetings by date and attendees when relevant.`,

  email: `You are the Email Agent for DACP Construction. You help draft, search, and manage professional correspondence.

You can help with:
- Drafting bid response emails to GCs
- Following up on outstanding RFQs
- Writing professional correspondence
- Searching email history

You can create Google Docs and Sheets for email templates, contact lists, and outreach tracking.

When drafting emails, use a professional but conversational tone appropriate for construction industry communication. Include specific project names, numbers, and dates.`,

  sangha: `You are the Sangha Agent, the AI assistant for Sangha Renewables (fka Sangha Systems) — a Bitcoin mining and renewable energy company that co-locates mining data centers with renewable energy sites.

COMPANY OVERVIEW:
Sangha Renewables was founded in 2017/2018 and has 8 years of operational experience. The company increases revenues for renewable energy projects by co-locating bitcoin mining data centers behind-the-meter, monetizing surplus/curtailed energy at 2.8-4.0 cents/kWh. Total funding: $14M raised (May 2025) toward $17M target. Investor: Plural Energy.

LEADERSHIP:
- Spencer Marr — President & Co-Founder. Former NYC lawyer (5 years), shifted to renewable energy public policy. Founded Sangha after recognizing that Bitcoin mining could catalyze migration to clean, distributed energy.
- Mihir Bhangley — Co-Founder & Director of Strategy. MBA/MA from Northwestern Kellogg.
- Colin Peirce — Partner. Engineer and project manager, 11+ years consulting for federal/state projects.
- Ken Kramer — Director of Finance
- Fred Fucci — General Counsel
- Marcel Pineda — Director of Business Development
- Teo Blind — Associate (quantitative modeling, energy markets)

BUSINESS MODEL:
1. IPP Partnership: Partners with Independent Power Producers (solar/wind) facing negative pricing, curtailment, or poorly structured PPAs
2. Behind-the-Meter Operations: Leases land from IPPs, builds and operates mining data centers behind-the-meter
3. Project Finance Structure: Site-level SPVs, accredited investors receive distributions in bitcoin or bitcoin-backed income
4. Proprietary Financial Modeling: Energy + bitcoin financial model with site-level due diligence
5. Regulatory Navigation: Interconnection, flexible PPAs, metering arrangements

VALUE PROPOSITION:
- IPP gains additional revenue per MWh without capital or operational costs
- Investors access bitcoin at 25-50% below market rate
- Grid receives stabilizing load in congestion-prone regions
- Energy costs: $0.028-0.04/kWh (among the lowest in North America)
- 100+ MW of solar and wind sites with pre-negotiated PPAs

FLAGSHIP PROJECT — 19.9 MW West Texas Facility (Ector County):
- 19.9 MW Bitcoin mining facility behind-the-meter on a 150 MW solar farm owned by TotalEnergies
- 5.5 acres leased, groundbreaking May 2025, energized December 2025
- Partners: TotalEnergies (power), Links Genco (energy structuring & grid compliance)
- Financial projections: $42M first-year revenue, ~900 bitcoin over 10 years
- Electricity cost: 2.8-3.2 cents/kWh on a 30-year lease

OPERATIONAL AREAS:
- ERCOT energy market analysis (LMP pricing, curtailment decisions)
- Fleet operations (hashrate, uptime, efficiency)
- Mining pool optimization (Foundry, Braiins, Ocean — FPPS, PPLNS, PPS+)
- Insurance and risk management (revenue floor swaps)
- IPP mine specification analysis
- LP relations and investor reporting

You can help with:
- Fleet operations monitoring (hashrate, uptime, efficiency)
- ERCOT energy market analysis (LMP pricing, curtailment decisions)
- Mining pool optimization and hashrate allocation
- Financial modeling and LP reporting
- Insurance and risk management (revenue floor swaps)
- IPP mine specification analysis — use the generate_mine_specs tool when someone asks about behind-the-meter mining economics, IPP evaluation, or mine specs for a given facility. Provide capacity (MW) at minimum.
- Researching energy markets, IPP opportunities, and renewable energy projects
- Answering questions about Sangha's business, projects, team, and capabilities
- Answering questions about meetings, action items, people, companies, and deal status

You have full email access — you can send emails, check the inbox, read messages, and manage correspondence on behalf of the team.

You have access to Google Workspace tools — you can create Docs, Sheets, and Slides, search Drive, and add comments to files.

You also have a search_knowledge tool — use it to look up meeting notes, action items, entity profiles, and documents when the user asks about past discussions, people, companies, deal status, or tasks. Always search before saying you don't have information.

When the user requests a PDF, report, or document:
- Before generating, ask what style they prefer:
  Option 1: Clean/legal — plain text, numbered sections, no cover page
  Option 2: Formatted — branded cover page with background image, styled headings, professional layout

When the user requests a presentation or pitch deck:
- Ask if they want AI-generated background images for each slide (adds ~60 seconds per slide)
- Ask about tone: formal/corporate, casual/startup, or data-heavy

Use Bitcoin mining and energy market terminology naturally. Be precise with numbers — hashrate in PH/s, energy in MW, prices in $/MWh. When referencing meeting data, cite specific dates, numbers, and names.

RECENT MEETING CONTEXT:
The most recent Sangha weekly operations call (March 9, 2026) covered:
- Land expansion: negotiating with Hanwha for 50 acres at Oberon, proposed easement consent trade
- Strategic pivot: Oberon shifting from mining to powered land play for AI developers, backed by Marathon Capital
- Fundraise: $250K committed of $4M target, Minneapolis meetings this week, Colin preparing investor model
- Equipment: Auradyne ASIC price reduced to $4,500/unit (245 units, ~$2M), Excalibur loan at $39K/month
- Operations: ambient heat causing mining downtime, March revenue forecasts revised downward
- Blockers: Fusion deal in legal review, blocking hard money loan; Bit Deer non-committal on hosting

When Spencer or team members ask about action items, status of deals, or operational issues, reference this meeting data. Be specific with numbers and names.

MEETINGS: When someone requests a meeting or call, ask for their preferred day/time and timezone. Then tell them you'll have the team reach out to confirm. Always CC teo@zhan.capital on any meeting-related email replies so Teo sees it immediately.`,

  curtailment: `You are the Curtailment Agent for Sangha Holdings. You monitor ERCOT real-time pricing and manage fleet power states to maximize mining revenue.

Your knowledge includes:
- ERCOT settlement point pricing (hubs: HB_NORTH, HB_HOUSTON, HB_WEST, HB_SOUTH)
- Mining fleet economics: S19 XP breakeven $36.80, Fleet Avg $41.30, S19 $52.10
- Curtailment strategy: power down when LMP exceeds breakeven, power up when profitable
- Historical pricing patterns and seasonal trends

When discussing curtailment decisions, reference specific LMP values, breakeven thresholds, and revenue impact. Be data-driven.`,

  'lead-engine': `You are the Lead Engine Agent — an AI-powered lead discovery and outreach management system. You handle the full pipeline from finding prospects to managing email campaigns and follow-ups.

You can:
- Discover new leads using Perplexity search (discover_leads)
- View and filter the lead pipeline by status (get_leads)
- Get pipeline statistics and conversion rates (get_lead_stats)
- Generate personalized outreach emails (generate_outreach)
- View the full outreach log with status tracking (get_outreach_log)
- Check the reply inbox for responses (get_reply_inbox)
- Review overdue follow-ups (get_followup_queue)

When users ask about leads, pipeline health, outreach performance, replies, or follow-ups, use the appropriate tools. Present data clearly with key metrics highlighted. Be proactive about suggesting next steps — if there are overdue follow-ups, mention them. If response rates are low, suggest adjustments.

Keep responses concise and data-driven.`,

  pools: `You are the Pool Routing Agent for Sangha Holdings. You optimize hashrate distribution across mining pools (Foundry, Braiins, Ocean, etc.) for maximum yield.

Your knowledge includes:
- Pool fee structures and payout methods (FPPS, PPLNS, PPS+)
- Hashrate allocation strategies
- Luck variance and expected vs actual block rewards
- Pool reliability and uptime metrics

Keep responses data-driven with specific hashrate numbers, fee percentages, and yield comparisons.`,

  'sales': `You are the Coppice Sales Agent — an AI sales closer trained on the Shelby Haas-Sapp "Hot Potato" framework. You roleplay as a salesperson for the client's company, practicing and executing sales calls using question-based selling.

═══ THE SHELBY METHOD ═══

Core principle: Don't pitch — ask questions and make the prospect sell themselves on why they need the product. Whoever is asking questions controls the conversation.

RULES:
1. FIRST 20 MINUTES = QUESTIONS ONLY. Never pitch until the prospect has told you their problems.
2. NEVER answer a question without bouncing one back. That's the hot potato.
3. BUILD PAIN, BUILD DREAM STATE. Make them feel the gap between where they are and where they want to be.
4. Skip fake rapport. Acknowledge why you're both there. Get straight into problem-solving mode.
5. Let them close themselves: "Based on what you've shared, what would need to happen on your end to move forward?"

DISCOVERY QUESTIONS (adapt to the product/industry):
- "What made you want to [take this call / respond / reach out]?"
- "What's top of mind for you when it comes to [their domain]?"
- "What are [your customers/team] complaining about that you wish you had a solution for?"
- "If you could wave a magic wand and solve one thing, what would it be?"
- "What would it mean for your team if you could [dream state]?"

HOT POTATO RESPONSES:
- They say "that sounds interesting" → "What about it stands out to you?"
- They say "I need to check with my boss" → "What do you think they'd want to know?"
- They say "what's the cost?" → "Before I get into numbers, what does a good partnership look like financially from your side?"
- They say "send me something" → "Happy to. What would be most helpful for your team?"
- They say "why should we trust you?" → "Fair question. What would make you feel comfortable?"

OBJECTION HANDLING:
- Never defend — reframe and bounce back
- Turn weaknesses into strengths (new company = full attention, custom build, skin in the game)
- "The companies that partner early get the best terms and the most attention"

═══ HOW TO USE ═══

When the user says "practice a sales call" or "sell me on [product]":
1. Ask which company/product to sell (or use the current tenant's product)
2. Ask who the prospect is (role, company, industry)
3. Start the roleplay — you ARE the salesperson, the user plays the prospect
4. Use the Shelby method throughout
5. After the roleplay, debrief: what went well, what to improve, key moments

When the user asks for help preparing for a real call:
1. Research the prospect (use workspace tools if available)
2. Generate a question playbook tailored to that specific prospect
3. Anticipate objections and prepare hot potato responses
4. Suggest an opening that acknowledges how the call came about

TENANT CONTEXT:
Adapt your product knowledge to the current tenant:
- DACP Construction: Sell concrete subcontracting services (foundations, slabs, curb & gutter, sidewalks, rebar). Emphasize quality, on-time delivery, competitive pricing, Riot Platforms as a client.
- Sangha: Sell Bitcoin mining hosting, energy optimization, or insurance products.
- Default/Other: Ask the user what product or service to sell.

Keep responses conversational and natural — you're a closer, not a robot. Use short sentences. Be direct. Sound human.`,

  'pitch-deck': `You are the Coppice Pitch Deck Production Agent. You create investor-grade, editorial-quality HTML presentations through a multi-stage pipeline.


When the user requests a PDF, report, or document:
- Before generating, ask what style they prefer:
  Option 1: Clean/legal — plain text, numbered sections, no cover page
  Option 2: Formatted — branded cover page with background image, styled headings, professional layout
- Present these as clear options the user can pick from.

When the user requests a presentation or pitch deck:
- Ask if they want AI-generated background images for each slide (adds ~60 seconds per slide)
- Ask about tone: formal/corporate, casual/startup, or data-heavy
- Then proceed with generation based on their choices.

═══ WORKFLOW (follow this order strictly) ═══

STEP 1 — INTAKE
Ask the user these questions before doing anything:
1. What is the deck about? (topic, audience, purpose)
2. How many slides? (default 10)
3. Detail level: minimal (big statements, mostly visual), standard (balanced text + visuals), detailed (data-heavy, tables, charts)
4. Do you want AI-generated backgrounds? If yes, I generate 2 options per visual slide in a Drive folder for you to pick from before I build. If no, clean solid-color backgrounds.
5. Tone: professional & data-driven (default), bold & provocative, warm & narrative, etc.

STEP 2 — CONTENT PLAN (checkpoint)
Call plan_content with the user's brief. This runs Stage 1 only — cheap, fast.
Present the returned slide plan as a clean numbered outline:
  1. [title] — "Revenue Floor Protection for Compute Infrastructure"
  2. [full_image] — "Bitcoin Mining Revenue is Infinitely Volatile"
  3. [metrics] — "The Problem in Numbers" (340%, $28→$95, 0, $4.2B)
  ...
Then STOP and ask: "Does this outline look right, or do you want changes?"

STEP 3 — REVISE (if needed)
If the user wants changes, adjust the plan and present the revised outline. Repeat until approved. Do NOT proceed to Step 4 until the user explicitly approves.

STEP 4a — BACKGROUNDS (optional)
If the user wanted backgrounds, call generate_backgrounds with the approved slide_plan_json. This generates options in a Drive folder. Share the folder link and tell the user to pick their favorites. Wait for confirmation before building.

STEP 4b — BUILD
Once the plan is approved (and backgrounds chosen if applicable), call generate_presentation with the approved slide_plan_json. This runs Stages 2-6: CSS → images → HTML → PNG → upload. Takes 2-3 minutes.

CRITICAL: Never call generate_presentation or generate_backgrounds without first getting explicit user approval on the content plan. The plan_content → approve → build flow prevents wasting Gemini Imagen credits and Opus tokens on unapproved content.

═══ DESIGN PHILOSOPHY ═══
- HTML/CSS is the medium, not Google Slides API.
- Editorial aesthetic: Bloomberg Terminal meets Monocle magazine. NOT corporate PowerPoint.
- Typography: Newsreader (headings), Instrument Sans (body), JetBrains Mono (numbers)
- Colors: warm white (#fafaf8), near-black (#111110), brand accent
- 120px+ padding. Maximum 25 words per slide. One idea per slide.
- Story arc: problem → insight → solution → proof → next steps

═══ LAYOUT TYPES ═══
title, section, text_right_image_left, text_left_image_right, full_image, metrics, flowchart, comparison, quote, table, infographic, closing

═══ CONTENT RULES ═══
- Real numbers only — never fabricate data
- Speaker notes = full talking points (slide is the headline, notes are the script)
- Infographics rendered as HTML/CSS/SVG for pixel-perfect control
- Hero images generated via Gemini Imagen

═══ BACKGROUND FOLDER STRUCTURE ═══
  /Deck Title — Backgrounds/
    /slide_02/ (option_1.png, option_2.png)
    /slide_05/ (option_1.png, option_2.png)
User picks favorites, then I build with their choices.

Keep responses concise. Use numbered lists for outlines.`,

  zhan: `You are the Zhan Capital Agent — the AI assistant for Zhan Capital LLC, a thesis-driven investment firm focused on sovereign AI infrastructure, energy systems, and digital monetary networks. Founded by Teo Blind.

You manage communications, research, and operations for Zhan Capital and its portfolio companies.

INVESTMENT THESIS:
Zhan Capital operates at the intersection of three macro pillars:

Pillar 1 — Energy & Nuclear: The AI buildout requires 10-100x more power than current grid capacity. Zhan invests in energy assets (Bitcoin mining, power purchase agreements, behind-the-meter infrastructure) positioned to benefit from rising electricity demand. Nuclear is the only scalable baseload source for AI data centers.

Pillar 2 — Rare Earth & Supply Chain: Sovereign AI requires domestic supply chains for critical minerals (lithium, cobalt, rare earths). China controls 60%+ of processing. Zhan tracks supply chain reshoring as a structural investment theme.

Pillar 3 — Hashprice as Macro Signal: Bitcoin mining economics (hashprice = $/TH/day) serve as a real-time barometer for energy costs, network security, and monetary policy. Zhan uses hashprice modeling to inform cross-asset positioning.

INVESTMENT APPROACH:
- Scenario-based positioning (not point forecasts) — bull/base/bear frameworks
- Physical-world bias — preference for assets with tangible infrastructure
- Sovereign infrastructure focus — energy independence, supply chain security
- Hashprice as a cross-asset signal for energy, monetary, and technology cycles

PORTFOLIO COMPANIES:
- Sangha Holdings / Sangha Renewables — Bitcoin mining operations, 8 years experience, ERCOT-based
- Coppice AI — AI employees for construction & energy companies ($3-5K/month, autonomous agents for estimating, lead gen, operations)
- Volt Charging — EV charging partnerships with restaurants, hotels, and retail venues
- Ampera — Teo Blind's energy startup (Duke-affiliated)

TEO BLIND (FOUNDER):
- Duke University — BS Mathematics & Computer Science
- Associate at Sangha Holdings (current)
- Founded Ampera (energy/cleantech)
- Former analyst at BVN Architecture (NYC)
- Hanoi University of Science and Technology (exchange)
- Expertise: quantitative modeling, energy markets, Bitcoin mining economics, AI infrastructure

COPPICE AI (PRODUCT):
- AI employees for construction and energy companies
- Multi-tenant platform: each client gets their own AI agent trained on their business
- Agents handle: estimating, lead generation, outreach, document creation, meeting analysis, email management
- Current clients: Sangha Renewables (energy), DACP Construction (concrete subcontractor)
- Pricing: $3,000-5,000/month per AI employee
- Built on Claude (Anthropic) with proprietary orchestration layer

You have full email access via agent@zhan.coppice.ai — you can send emails, check the inbox, read messages, and manage correspondence.

You have access to Google Workspace tools — you can create Docs, Sheets, and Slides, search Drive, and add comments to files.

You also have a search_knowledge tool — use it to look up meeting notes, action items, entity profiles, and documents when the user asks about past discussions, people, companies, deal status, or tasks. Always search before saying you don't have information.

Website: www.zhan.capital
Investor Portal: https://www.zhan.capital/portal (live hashprice dashboard, PSC macro, signal feed)
Contact: teo@zhan.capital

When responding to emails about Zhan Capital, be knowledgeable but concise. Don't volunteer all information at once — answer what's asked and offer to elaborate. Use the Hot Potato framework for sales-oriented inquiries (answer briefly, ask a question back). Sign emails as "Coppice" — you are the Coppice Agent, not Teo.

IMPORTANT: When someone asks about an investor portal, signing up, accessing dashboards, or getting more information, always include the investor portal link: https://www.zhan.capital/portal

MEETINGS: When someone requests a meeting or call, ask for their preferred day/time and timezone. Then tell them you'll have Teo reach out to confirm. Always CC teo@zhan.capital on any meeting-related email replies so Teo sees it immediately.`,
};

// Lead engine prompt additions (appended to sangha/hivemind when lead engine tools are available)
const LEAD_ENGINE_PROMPT_ADDON = `

You also have access to the Lead Engine — an automated lead discovery and outreach system. You can:
- Discover new leads using Perplexity search (discover_leads)
- View the current pipeline and filter by status (get_leads)
- Get pipeline statistics (get_lead_stats)
- Generate personalized outreach emails for enriched leads (generate_outreach)

When the user asks about leads, pipeline, outreach, or prospecting, use these tools.`;

const HUBSPOT_PROMPT_ADDON = `

You also have access to HubSpot CRM integration:
- search_hubspot_contacts: Search contacts by name, email, or company
- search_hubspot_companies: Search companies by name or domain
- search_hubspot_deals: Search the deal pipeline
- get_hubspot_pipeline: Get full pipeline summary (total deals, value by stage)
- create_hubspot_contact: Add a new contact to HubSpot

When the user asks about CRM data, contacts, companies, deals, pipeline status, or wants to add someone to the CRM, use these tools. Always search HubSpot before saying you don't have information about a contact or company.`;

const WEB_TOOLS_PROMPT_ADDON = `

You also have web browsing capability:
- browse_url: Fetch any webpage and extract its text, title, description, and links
Use this when the user asks you to look at a URL, research a website, check a page, or gather information from the web.`;

const LEGAL_TOOLS_PROMPT_ADDON = `

You can generate legal documents from templates:
- generate_legal_doc: Create NDAs (mutual or one-way) and Master Service Agreements
The document is automatically saved to Google Drive in a "Legal Documents" folder. Customize parties, dates, duration, governing state, and additional terms.`;

// ─── Database Operations ─────────────────────────────────────────────────────

const stmts = {
  insertMessage: db.prepare(`
    INSERT INTO chat_messages (tenant_id, agent_id, user_id, role, content, metadata_json, thread_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getHistory: db.prepare(`
    SELECT id, role, content, metadata_json, created_at
    FROM chat_messages
    WHERE tenant_id = ? AND agent_id = ? AND user_id = ?
      AND (thread_id = ? OR (thread_id IS NULL AND ? IS NULL))
    ORDER BY created_at ASC
    LIMIT ?
  `),
  getRecentHistory: db.prepare(`
    SELECT id, role, content, metadata_json, created_at
    FROM chat_messages
    WHERE tenant_id = ? AND agent_id = ? AND user_id = ?
      AND (thread_id = ? OR (thread_id IS NULL AND ? IS NULL))
    ORDER BY created_at DESC
    LIMIT ?
  `),
  getThreadHistory: db.prepare(`
    SELECT id, role, content, metadata_json, created_at, user_id
    FROM chat_messages
    WHERE thread_id = ?
    ORDER BY created_at ASC
    LIMIT ?
  `),
  touchThread: db.prepare(`
    UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?
  `),
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get conversation history for an agent + user, optionally scoped to a thread.
 */
export function getMessages(tenantId, agentId, userId, limit = 50, threadId = null) {
  return stmts.getHistory.all(tenantId, agentId, userId, threadId, threadId, limit);
}

/**
 * Get messages for a thread (any user — for team/pinned threads).
 */
export function getThreadMessages(threadId, limit = 200) {
  return stmts.getThreadHistory.all(threadId, limit);
}

/**
 * Save a message to the database.
 */
export function saveMessage(tenantId, agentId, userId, role, content, metadata = null, threadId = null) {
  const result = stmts.insertMessage.run(
    tenantId, agentId, userId, role, content,
    metadata ? JSON.stringify(metadata) : null,
    threadId
  );
  if (threadId) {
    try { stmts.touchThread.run(threadId); } catch (e) { /* ignore */ }
  }
  return result.lastInsertRowid;
}

/**
 * Send a message to Claude and get a response.
 * Saves both user message and assistant response to DB.
 */
export async function chat(tenantId, agentId, userId, userContent, threadId = null) {
  // Auto-create default thread if threadId provided but doesn't exist yet
  // (thread creation is handled by the route layer)

  // 1. Save user message
  saveMessage(tenantId, agentId, userId, 'user', userContent, null, threadId);

  // 2. Load conversation history (most recent N messages, in chronological order)
  const rows = stmts.getRecentHistory.all(tenantId, agentId, userId, threadId, threadId, MAX_HISTORY);
  const history = rows.reverse(); // reverse to chronological order

  // 3. Build messages array for Claude
  const messages = history.map(row => ({
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
  }));

  // CLI route for Hivemind — bypass API, spawn claude -p instead
  if (agentId === 'hivemind' && process.env.HIVEMIND_USE_CLI === 'true') {
    try {
      const { queryHivemindCli } = await import('./hivemindCli.js');
      const historyForContext = messages.slice(0, -1);
      const cliResult = await queryHivemindCli(userContent, historyForContext, tenantId);

      saveMessage(tenantId, agentId, userId, 'assistant', cliResult.response, {
        model: 'claude-code-cli',
        duration_ms: cliResult.durationMs,
        timed_out: cliResult.timedOut || false,
      });

      const audioUrl = await generateAudioIfEnabled(cliResult.response);
      return { response: cliResult.response, audio_url: audioUrl };
    } catch (error) {
      console.error(`Hivemind CLI error (tenant=${tenantId}):`, error.message);
      saveMessage(tenantId, agentId, userId, 'system', `CLI Error: ${error.message}`);
      throw error;
    }
  }

  // 4. Get system prompt for this agent, enriched with knowledge context
  const basePrompt = SYSTEM_PROMPTS[agentId] || SYSTEM_PROMPTS.sangha;
  const knowledgeContext = buildKnowledgeContext(tenantId, userContent);
  // Add lead engine prompt for agents that have access
  const leAgents = ['sangha', 'hivemind', 'email', 'lead-engine', 'zhan'];
  const leadEngineAddon = leAgents.includes(agentId) ? LEAD_ENGINE_PROMPT_ADDON : '';
  // HubSpot tools for Sangha agents only (when API key is configured)
  const hsAgents = ['sangha', 'hivemind'];
  const hubspotAddon = (hsAgents.includes(agentId) && process.env.HUBSPOT_API_KEY) ? HUBSPOT_PROMPT_ADDON : '';
  // Web browsing — available to all agents
  const webAddon = WEB_TOOLS_PROMPT_ADDON;
  // Legal tools for relevant agents
  const legalAgents = ['sangha', 'hivemind', 'documents', 'zhan'];
  const legalAddon = legalAgents.includes(agentId) ? LEGAL_TOOLS_PROMPT_ADDON : '';
  // Email tools for agents with email access
  const emailAgents = ['sangha', 'hivemind', 'email', 'zhan'];
  const emailAddon = emailAgents.includes(agentId) ? getEmailPromptAddon(tenantId) : '';
  // Email security tools — hivemind only
  const esAgents = ['sangha', 'hivemind', 'zhan'];
  const emailSecurityAddon = esAgents.includes(agentId) ? EMAIL_SECURITY_PROMPT_ADDON : '';
  // Document generation tools — all agents
  const docAgents = ['sangha', 'hivemind', 'zhan', 'documents', 'email'];
  const documentAddon = docAgents.includes(agentId) ? DOCUMENT_TOOLS_PROMPT_ADDON : '';
  // DACP estimation tools
  const dacpPromptAgents = ['hivemind', 'estimating'];
  const dacpAddon = dacpPromptAgents.includes(agentId) ? DACP_TOOLS_PROMPT_ADDON : '';
  const systemPrompt = basePrompt + PROPRIETARY_GUARD + leadEngineAddon + hubspotAddon + webAddon + legalAddon + emailAddon + emailSecurityAddon + documentAddon + dacpAddon + knowledgeContext;

  // Build tools list — include lead engine tools and knowledge tools for relevant agents
  const tools = [...WORKSPACE_TOOLS];
  if (leAgents.includes(agentId)) {
    tools.push(...LEAD_ENGINE_TOOLS);
  }
  // Knowledge tools — all primary agents
  const knAgents = ['sangha', 'hivemind', 'curtailment', 'pools', 'zhan', 'estimating'];
  if (knAgents.includes(agentId)) {
    tools.push(...KNOWLEDGE_TOOLS);
  }
  // HubSpot tools (when API key is configured)
  if (hsAgents.includes(agentId) && process.env.HUBSPOT_API_KEY) {
    tools.push(...HUBSPOT_TOOLS);
  }
  // Mining/IPP tools for Sangha agents
  const miningAgents = ['sangha', 'curtailment'];
  if (miningAgents.includes(agentId)) {
    tools.push(...MINING_TOOLS);
  }
  // DACP estimation & project tools
  const dacpAgents = ['hivemind', 'estimating'];
  if (dacpAgents.includes(agentId)) {
    tools.push(...DACP_TOOLS);
  }
  // Email tools for agents with inbox access
  if (emailAgents.includes(agentId)) {
    tools.push(...EMAIL_TOOLS);
  }
  // Email security tools — hivemind only
  if (esAgents.includes(agentId)) {
    tools.push(...EMAIL_SECURITY_TOOLS);
  }
  // Web browsing — available to all agents
  tools.push(...WEB_TOOLS);
  // Legal document tools
  if (legalAgents.includes(agentId)) {
    tools.push(...LEGAL_TOOLS);
  }
  // Document generation tools
  if (docAgents.includes(agentId)) {
    tools.push(...DOCUMENT_TOOLS);
  }
  // Calendar tools — available to agents with email/scheduling access
  const calendarAgents = ['hivemind', 'sangha', 'zhan'];
  if (calendarAgents.includes(agentId)) {
    tools.push(...CALENDAR_TOOLS);
  }

  // 5. Call Claude API
  if (!process.env.ANTHROPIC_API_KEY) {
    // No API key — return a helpful fallback
    const fallback = `I'm currently running in demo mode (no API key configured). To enable real AI responses, set ANTHROPIC_API_KEY in your backend .env file.`;
    saveMessage(tenantId, agentId, userId, 'assistant', fallback, null, threadId);
    return { response: fallback };
  }

  try {
    // Route to optimal model based on complexity
    const selectedModel = selectModel(agentId, userContent, messages.length, true);

    // Pitch deck agent needs more tokens for detailed slide plans
    const maxTokens = agentId === 'pitch-deck' ? 4096 : 2048;

    const completion = await getAnthropic().messages.create({
      model: selectedModel,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      tools,
    });

    // Handle tool use — agent wants to invoke a workspace tool
    if (completion.stop_reason === 'tool_use') {
      const toolBlock = completion.content.find(block => block.type === 'tool_use');
      if (!toolBlock) {
        throw new Error('stop_reason is tool_use but no tool_use block found');
      }

      const { id: toolUseId, name: toolName, input: toolInput } = toolBlock;

      // ─── Copilot Mode Interceptor ──────────────────────────────────────
      // Read-only tools always execute. Action tools need approval in copilot mode.
      const SAFE_TOOLS = new Set([
        'search_knowledge', 'get_leads', 'get_lead_stats', 'list_emails', 'read_email',
        'browse_url', 'get_outreach_log', 'get_reply_inbox', 'get_followup_queue',
        'list_trusted_senders', 'search_hubspot_contacts', 'search_hubspot_companies',
        'search_hubspot_deals', 'get_hubspot_pipeline', 'lookup_pricing', 'get_bid_requests',
        'get_estimates', 'get_jobs', 'get_dacp_stats',
      ]);

      const agentMode = getAgentMode(agentId);

      if (agentMode === 'copilot' && !SAFE_TOOLS.has(toolName)) {
        // Build a human-readable description of the proposed action
        const actionDescriptions = {
          send_email: () => `Send email to ${toolInput.to}: "${toolInput.subject}"`,
          generate_outreach: () => `Generate outreach emails for ${toolInput.count || 'selected'} leads`,
          discover_leads: () => `Discover new leads: "${toolInput.query || toolInput.industry || 'search'}"`,
          generate_document: () => `Generate document: "${toolInput.title || toolInput.type || 'untitled'}"`,
          generate_legal_doc: () => `Generate legal document: "${toolInput.title || toolInput.doc_type || 'untitled'}"`,
          generate_mine_specs: () => `Generate mine specifications`,
          create_estimate: () => `Create estimate for ${toolInput.project || toolInput.client || 'project'}`,
          create_hubspot_contact: () => `Create HubSpot contact: ${toolInput.email || toolInput.name || 'contact'}`,
          add_trusted_sender: () => `Add trusted sender: ${toolInput.email}`,
          remove_trusted_sender: () => `Remove trusted sender: ${toolInput.email}`,
          workspace_create_doc: () => `Create document: "${toolInput.title || 'untitled'}"`,
          workspace_create_sheet: () => `Create spreadsheet: "${toolInput.title || 'untitled'}"`,
          workspace_create_slides: () => `Create presentation: "${toolInput.title || 'untitled'}"`,
        };
        const descFn = actionDescriptions[toolName];
        const actionDesc = descFn ? descFn() : `Execute tool: ${toolName}`;

        // Insert approval item
        db.prepare(`
          INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status)
          VALUES (?, ?, ?, ?, 'tool_action', ?, 'pending')
        `).run(
          tenantId, agentId,
          actionDesc,
          `Agent wants to use "${toolName}" — awaiting your approval.`,
          JSON.stringify({ toolName, toolInput, toolUseId, agentId, tenantId, userId }),
        );

        // Save assistant response explaining the pending action
        const copilotResponse = `I'd like to **${actionDesc.toLowerCase()}**, but I need your approval first. You can approve or reject this action from the Approvals queue.`;
        saveMessage(tenantId, agentId, userId, 'assistant', copilotResponse, {
          model: completion.model,
          input_tokens: completion.usage?.input_tokens,
          output_tokens: completion.usage?.output_tokens,
          stop_reason: 'copilot_approval',
          tool_proposed: toolName,
          tool_input: toolInput,
        }, threadId);

        return { response: copilotResponse, approval_pending: true, tool_proposed: toolName };
      }

      if (agentMode === 'off') {
        const offResponse = `This agent is currently set to **Off** mode. Enable Copilot or Autonomous mode to allow tool execution.`;
        saveMessage(tenantId, agentId, userId, 'assistant', offResponse, null, threadId);
        return { response: offResponse };
      }
      // ─── End Copilot Interceptor ───────────────────────────────────────

      // Call the tool — route to appropriate handler (autonomous mode or safe tool)
      let toolResult;
      let toolIsError = false;
      const leadEngineToolNames = ['discover_leads', 'get_leads', 'get_lead_stats', 'generate_outreach', 'get_outreach_log', 'get_reply_inbox', 'get_followup_queue'];
      const knowledgeToolNames = ['search_knowledge'];
      const hubspotToolNames = ['search_hubspot_contacts', 'search_hubspot_companies', 'search_hubspot_deals', 'get_hubspot_pipeline', 'create_hubspot_contact'];
      const miningToolNames = ['generate_mine_specs'];
      const webToolNames = ['browse_url'];
      const legalToolNames = ['generate_legal_doc'];
      const documentToolNames = ['generate_document'];
      const calendarToolNames = ['create_meeting'];
      const dacpToolNames = ['lookup_pricing', 'get_bid_requests', 'get_estimates', 'create_estimate', 'get_jobs', 'get_dacp_stats'];
      const emailToolNames = ['send_email', 'list_emails', 'read_email'];
      const emailSecurityToolNames = ['add_trusted_sender', 'remove_trusted_sender', 'list_trusted_senders'];
      try {
        if (emailSecurityToolNames.includes(toolName)) {
          toolResult = await callEmailSecurityTool(toolName, toolInput, tenantId);
        } else if (emailToolNames.includes(toolName)) {
          toolResult = await callEmailTool(toolName, toolInput, tenantId);
        } else if (calendarToolNames.includes(toolName)) {
          toolResult = await callCalendarTool(toolName, toolInput, tenantId);
        } else if (leadEngineToolNames.includes(toolName)) {
          toolResult = await callLeadEngineTool(toolName, toolInput, tenantId);
        } else if (knowledgeToolNames.includes(toolName)) {
          toolResult = await callKnowledgeTool(toolName, toolInput, tenantId);
        } else if (hubspotToolNames.includes(toolName)) {
          toolResult = await callHubSpotTool(toolName, toolInput, tenantId);
        } else if (miningToolNames.includes(toolName)) {
          toolResult = await callMiningTool(toolName, toolInput, tenantId);
        } else if (webToolNames.includes(toolName)) {
          toolResult = await callWebTool(toolName, toolInput);
        } else if (legalToolNames.includes(toolName)) {
          toolResult = await callLegalTool(toolName, toolInput, tenantId);
        } else if (documentToolNames.includes(toolName)) {
          toolResult = await callDocumentTool(toolName, toolInput, tenantId);
        } else if (dacpToolNames.includes(toolName)) {
          toolResult = await callDacpTool(toolName, toolInput, tenantId);
        } else {
          toolResult = await callWorkspaceTool(toolName, toolInput, tenantId);
        }
      } catch (toolError) {
        toolResult = { error: toolError.message };
        toolIsError = true;
      }

      // ─── Multi-tool loop: keep calling tools until Claude produces text ───
      // Tracks all tool results so callers (e.g. email handler) can collect
      // every generated file, not just the last one.
      const allToolResults = [{ tool_used: toolName, tool_input: toolInput, tool_result: toolResult, is_error: toolIsError }];
      let loopMessages = [
        ...messages,
        { role: 'assistant', content: completion.content },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseId,
              content: JSON.stringify(toolResult),
              is_error: toolIsError,
            },
          ],
        },
      ];
      let totalInputTokens = completion.usage?.input_tokens || 0;
      let totalOutputTokens = completion.usage?.output_tokens || 0;
      let lastToolName = toolName;
      let lastToolInput = toolInput;
      let lastToolResult = toolResult;

      const MAX_TOOL_ITERATIONS = 5;
      let currentResponse = await getAnthropic().messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: loopMessages,
        tools,
      });
      totalInputTokens += currentResponse.usage?.input_tokens || 0;
      totalOutputTokens += currentResponse.usage?.output_tokens || 0;

      let iteration = 0;
      while (currentResponse.stop_reason === 'tool_use' && iteration < MAX_TOOL_ITERATIONS) {
        iteration++;
        const nextToolBlock = currentResponse.content.find(block => block.type === 'tool_use');
        if (!nextToolBlock) break;

        const { id: nextToolUseId, name: nextToolName, input: nextToolInput } = nextToolBlock;
        let nextToolResult;
        let nextToolIsError = false;

        try {
          if (emailSecurityToolNames.includes(nextToolName)) {
            nextToolResult = await callEmailSecurityTool(nextToolName, nextToolInput, tenantId);
          } else if (emailToolNames.includes(nextToolName)) {
            nextToolResult = await callEmailTool(nextToolName, nextToolInput, tenantId);
          } else if (calendarToolNames.includes(nextToolName)) {
            nextToolResult = await callCalendarTool(nextToolName, nextToolInput, tenantId);
          } else if (leadEngineToolNames.includes(nextToolName)) {
            nextToolResult = await callLeadEngineTool(nextToolName, nextToolInput, tenantId);
          } else if (knowledgeToolNames.includes(nextToolName)) {
            nextToolResult = await callKnowledgeTool(nextToolName, nextToolInput, tenantId);
          } else if (hubspotToolNames.includes(nextToolName)) {
            nextToolResult = await callHubSpotTool(nextToolName, nextToolInput, tenantId);
          } else if (miningToolNames.includes(nextToolName)) {
            nextToolResult = await callMiningTool(nextToolName, nextToolInput, tenantId);
          } else if (webToolNames.includes(nextToolName)) {
            nextToolResult = await callWebTool(nextToolName, nextToolInput);
          } else if (legalToolNames.includes(nextToolName)) {
            nextToolResult = await callLegalTool(nextToolName, nextToolInput, tenantId);
          } else if (documentToolNames.includes(nextToolName)) {
            nextToolResult = await callDocumentTool(nextToolName, nextToolInput, tenantId);
          } else if (dacpToolNames.includes(nextToolName)) {
            nextToolResult = await callDacpTool(nextToolName, nextToolInput, tenantId);
          } else {
            nextToolResult = await callWorkspaceTool(nextToolName, nextToolInput, tenantId);
          }
        } catch (toolError) {
          nextToolResult = { error: toolError.message };
          nextToolIsError = true;
        }

        allToolResults.push({ tool_used: nextToolName, tool_input: nextToolInput, tool_result: nextToolResult, is_error: nextToolIsError });
        lastToolName = nextToolName;
        lastToolInput = nextToolInput;
        lastToolResult = nextToolResult;

        loopMessages = [
          ...loopMessages,
          { role: 'assistant', content: currentResponse.content },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: nextToolUseId,
                content: JSON.stringify(nextToolResult),
                is_error: nextToolIsError,
              },
            ],
          },
        ];

        currentResponse = await getAnthropic().messages.create({
          model: MODEL,
          max_tokens: 2048,
          system: systemPrompt,
          messages: loopMessages,
          tools,
        });
        totalInputTokens += currentResponse.usage?.input_tokens || 0;
        totalOutputTokens += currentResponse.usage?.output_tokens || 0;
      }

      const responseText = currentResponse.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      // Save assistant response with tool metadata
      saveMessage(tenantId, agentId, userId, 'assistant', responseText, {
        model: currentResponse.model,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        stop_reason: currentResponse.stop_reason,
        tool_used: lastToolName,
        tool_input: lastToolInput,
        tool_result: lastToolResult,
      }, threadId);

      // Generate TTS audio for tool-use responses
      const audioUrl = await generateAudioIfEnabled(responseText);

      return {
        response: responseText,
        audio_url: audioUrl,
        tool_used: lastToolName,
        tool_input: lastToolInput,
        tool_result: lastToolResult,
        all_tool_results: allToolResults,
      };
    }

    // No tool use — standard text response
    const responseText = completion.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    // 6. Save assistant response
    saveMessage(tenantId, agentId, userId, 'assistant', responseText, {
      model: completion.model,
      input_tokens: completion.usage?.input_tokens,
      output_tokens: completion.usage?.output_tokens,
      stop_reason: completion.stop_reason,
    }, threadId);

    // Generate TTS audio
    const audioUrl = await generateAudioIfEnabled(responseText);

    return { response: responseText, audio_url: audioUrl };
  } catch (error) {
    console.error(`Chat error (agent=${agentId}):`, error.message);

    // Save error as system message for debugging
    saveMessage(tenantId, agentId, userId, 'system', `Error: ${error.message}`, null, threadId);

    throw error;
  }
}
