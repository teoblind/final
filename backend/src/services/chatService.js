/**
 * Chat Service — Claude API backend for agent conversations
 *
 * Each agent gets a system prompt defining its role and knowledge.
 * Messages are persisted to SQLite and sent as conversation history to Claude.
 */

import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import { getCurrentTenantId, getTenantDb, getAgentMode, insertActivity, saveThreadSummary, getSiblingThreadSummaries, searchDriveContents, insertAgentRun } from '../cache/database.js';
import { randomUUID } from 'node:crypto';

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
import { queryClaudeAgent, isComplexQuery } from './claudeAgent.js';

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
  {
    name: 'run_full_cycle',
    description: 'Run a complete lead engine cycle: discover new leads → enrich contacts → generate outreach emails → generate follow-ups. Returns results from each step.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'update_lead',
    description: 'Update a lead\'s status, notes, or priority.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'integer', description: 'The lead ID to update' },
        status: { type: 'string', description: 'New status', enum: ['new', 'enriched', 'contacted', 'responded', 'meeting', 'qualified', 'closed', 'declined'] },
        notes: { type: 'string', description: 'Notes to add to the lead' },
        priority_score: { type: 'number', description: 'Priority score (0-100)' },
      },
      required: ['lead_id'],
    },
  },
  {
    name: 'update_discovery_config',
    description: 'Update lead discovery configuration — queries, regions, schedule, sender info, mode, enabled state. Use this to set up or modify the lead discovery pipeline.',
    input_schema: {
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' }, description: 'Search queries for lead discovery (Perplexity)' },
        regions: { type: 'array', items: { type: 'string' }, description: 'Target regions' },
        queries_per_cycle: { type: 'integer', description: 'Queries to run per discovery cycle' },
        max_emails_per_cycle: { type: 'integer', description: 'Max outreach emails per cycle' },
        followup_delay_days: { type: 'integer', description: 'Days before sending follow-up' },
        max_followups: { type: 'integer', description: 'Max follow-ups per lead' },
        enabled: { type: 'boolean', description: 'Enable/disable the nightly discovery job' },
        mode: { type: 'string', description: 'copilot (drafts need approval) or autonomous', enum: ['copilot', 'autonomous'] },
        sender_name: { type: 'string', description: 'Outreach sender display name' },
        sender_email: { type: 'string', description: 'Outreach sender email' },
      },
      required: [],
    },
  },
  {
    name: 'get_discovery_config',
    description: 'Get the current lead discovery configuration — queries, schedule, sender, mode, enabled state.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'setup_crm_sheet',
    description: 'Create a CRM pipeline Google Sheet for tracking deals. Sets up columns (Deal Name, Company, Stage, Value, Contact, Email, Notes, Updated) with stage dropdowns and connects it to the dashboard. Only one sheet can be active at a time.',
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

// ─── Context Panel Tools ────────────────────────────────────────────────────

const CONTEXT_TOOLS = [
  {
    name: 'update_entity_profile',
    description: 'Create or update a profile for a person, company, or project in the knowledge base. Use this when the user repeatedly discusses someone or you want to record key facts about them.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Entity name (person, company, or project name)' },
        entity_type: { type: 'string', enum: ['person', 'company', 'project'], description: 'Type of entity' },
        metadata: { type: 'object', description: 'Key-value pairs: email, phone, role, notes, tags, company, title, etc.' },
      },
      required: ['name', 'entity_type'],
    },
  },
  {
    name: 'pin_to_context',
    description: 'Pin an entity, file, or note to the current conversation context panel so the user can reference it.',
    input_schema: {
      type: 'object',
      properties: {
        pin_type: { type: 'string', enum: ['entity', 'file', 'thread', 'note'], description: 'Type of item to pin' },
        ref_id: { type: 'string', description: 'ID of the item to pin (entity ID, file ID, thread ID). Optional for notes.' },
        label: { type: 'string', description: 'Display label for the pin' },
        note: { type: 'string', description: 'Note text content (for pin_type=note)' },
      },
      required: ['pin_type', 'label'],
    },
  },
];

// ─── Task Proposal Tool ─────────────────────────────────────────────────────
// Allows the agent to propose a background task during chat instead of
// attempting a complex task inline. Creates an assignment the user can confirm.

const TASK_PROPOSAL_TOOLS = [
  {
    name: 'propose_task',
    description: `Propose a background task for the user to approve and run asynchronously. Use this when the user asks for something complex that requires multiple steps, research, document creation, or analysis that would take more than a quick answer. Instead of attempting it inline, propose it as a runnable task with a clear scope. The user will see an interactive card in the chat and can review, refine, or run it.`,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title (5-10 words)' },
        description: { type: 'string', description: '1-2 sentence description of what will be done and what deliverables will be produced' },
        category: { type: 'string', enum: ['research', 'analysis', 'estimate', 'outreach', 'document', 'admin', 'follow_up', 'pitch_deck'], description: 'Task category' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Priority level' },
        action_prompt: { type: 'string', description: 'Detailed execution instructions for when the task runs. Include specific data sources, analysis steps, deliverable format, and who to email results to.' },
        sources: {
          type: 'array',
          items: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' }, id: { type: 'string' } } },
          description: 'Files, knowledge entries, or data sources the task will use. Helps the user understand scope.',
        },
      },
      required: ['title', 'description', 'category', 'action_prompt'],
    },
  },
];

const TASK_PROPOSAL_PROMPT_ADDON = `

═══ BACKGROUND TASK PROPOSALS ═══
You have a "propose_task" tool that lets you propose background tasks the user can approve and run asynchronously.

WHEN TO USE propose_task:
- The user describes work that requires multiple steps, research, document creation, or analysis
- The task would take more than a quick conversational answer (e.g., "write a report on...", "research...", "put together a one-pager on...")
- The user explicitly asks you to "run a task", "create a task", or "queue this up"

WHEN NOT TO USE propose_task:
- Simple questions you can answer directly in chat
- Quick lookups or single-step operations
- The user just wants information, not a deliverable

HOW TO USE IT WELL:
- Write a clear, specific action_prompt — this is the instruction the background executor will follow
- Include any relevant entity names, file references, or data sources in the action_prompt
- Set the right category: research, analysis, estimate, outreach, document, admin, or follow_up
- If the user mentioned specific entities or documents in the conversation, include them in the sources array
- After proposing, tell the user what you proposed and that they can review/approve it in chat or on the Command dashboard`;

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
  {
    name: 'web_research',
    description: 'Perform deep web research on a topic using AI-powered search. Returns a synthesized answer with citations. Use this for market research, competitive analysis, technical questions, industry data, company research, or any query requiring up-to-date web knowledge. You can call this multiple times with different queries to build comprehensive understanding.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The research question to investigate. Be specific — e.g. "What is the current installed capacity of solar+storage in ERCOT as of 2026?" rather than "solar in Texas"' },
        focus: { type: 'string', enum: ['general', 'academic', 'news', 'finance'], description: 'Search focus area (default: general). Use "finance" for market data, "news" for recent events, "academic" for research papers.' },
      },
      required: ['query'],
    },
  },
];

async function callWebTool(toolName, toolInput) {
  if (toolName === 'browse_url') {
    const { browseUrl } = await import('./webBrowseService.js');
    return await browseUrl(toolInput.url, { extract: toolInput.extract || 'all' });
  }
  if (toolName === 'web_research') {
    return await callWebResearch(toolInput.query, toolInput.focus || 'general');
  }
  throw new Error(`Unknown web tool: ${toolName}`);
}

async function callWebResearch(query, focus) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return { error: 'Web research unavailable — PERPLEXITY_API_KEY not configured.' };
  }

  const modelMap = {
    general: 'sonar-pro',
    academic: 'sonar-pro',
    news: 'sonar-pro',
    finance: 'sonar-pro',
  };

  const focusPrompts = {
    general: '',
    academic: 'Focus on peer-reviewed research, technical papers, and authoritative sources.',
    news: 'Focus on the most recent news, press releases, and current events.',
    finance: 'Focus on financial data, market analysis, earnings, valuations, and economic indicators.',
  };

  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelMap[focus] || 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: `You are a research assistant. Provide thorough, well-sourced answers with specific data points, numbers, and facts. ${focusPrompts[focus] || ''} Always cite your sources.`,
          },
          { role: 'user', content: query },
        ],
        max_tokens: 2048,
        return_citations: true,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { error: `Perplexity API error (${res.status}): ${errText}` };
    }

    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content || 'No results found.';
    const citations = data.citations || [];

    return {
      answer,
      citations,
      query,
      focus,
    };
  } catch (err) {
    return { error: `Web research failed: ${err.message}` };
  }
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

    // Generate a PDF file for attachment
    const { generatePdf } = await import('./documentService.js');
    const fileResult = await generatePdf({ title: doc.title, content: doc.content });

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

// ─── Scheduler Tools ─────────────────────────────────────────────────────────

const SCHEDULER_TOOLS = [
  {
    name: 'create_scheduled_task',
    description: 'Create a recurring scheduled task that runs automatically on a cron schedule. The task will execute the given prompt as if a user sent it to the agent. Use for daily reports, weekly summaries, periodic checks, recurring emails, or any repeated task.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short human-readable title for the task (e.g. "Weekly Pipeline Report")' },
        prompt: { type: 'string', description: 'The full prompt to execute on each run — write it exactly as a user would type it' },
        schedule: { type: 'string', description: 'Cron expression for the schedule. Examples: "0 9 * * 1" (Mon 9AM), "0 8 * * *" (daily 8AM), "0 */4 * * *" (every 4h), "0 9 * * 1-5" (weekdays 9AM)' },
        timezone: { type: 'string', description: 'IANA timezone (default: America/Chicago). Examples: America/New_York, America/Los_Angeles, UTC' },
        max_runs: { type: 'integer', description: 'Optional: stop after this many runs. Omit for unlimited.' },
      },
      required: ['title', 'prompt', 'schedule'],
    },
  },
  {
    name: 'list_scheduled_tasks',
    description: 'List all scheduled tasks for the current tenant. Shows title, schedule, next run time, run count, and enabled status.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'delete_scheduled_task',
    description: 'Delete a scheduled task by its ID. Use list_scheduled_tasks first to find the task ID.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The ID of the scheduled task to delete' },
      },
      required: ['task_id'],
    },
  },
];

async function callSchedulerTool(toolName, toolInput, tenantId) {
  const { createScheduledTask, getScheduledTasks, deleteScheduledTask } = await import('../cache/database.js');
  const { computeNextRun, isValidCron } = await import('../jobs/scheduledTaskRunner.js');

  switch (toolName) {
    case 'create_scheduled_task': {
      const { title, prompt, schedule, timezone, max_runs } = toolInput;
      if (!isValidCron(schedule)) {
        return { error: `Invalid cron expression: "${schedule}". Use standard 5-field cron format: minute hour day-of-month month day-of-week` };
      }
      const tz = timezone || 'America/Chicago';
      const nextRun = computeNextRun(schedule, tz);
      // Use the current tenant context's user — fallback to 'system'
      const userId = toolInput._userId || 'system';
      const task = createScheduledTask({
        tenant_id: tenantId,
        user_id: userId,
        agent_id: toolInput._agentId || 'hivemind',
        title,
        prompt,
        cron_expression: schedule,
        timezone: tz,
        next_run_at: nextRun,
        max_runs: max_runs || null,
      });
      return {
        message: `Scheduled task "${title}" created successfully.`,
        task_id: task.id,
        schedule,
        timezone: tz,
        next_run_at: nextRun,
        max_runs: max_runs || 'unlimited',
      };
    }
    case 'list_scheduled_tasks': {
      const tasks = getScheduledTasks(tenantId);
      if (tasks.length === 0) {
        return { message: 'No scheduled tasks found.', tasks: [] };
      }
      return {
        count: tasks.length,
        tasks: tasks.map(t => ({
          id: t.id,
          title: t.title,
          prompt: t.prompt.slice(0, 100) + (t.prompt.length > 100 ? '...' : ''),
          schedule: t.cron_expression,
          timezone: t.timezone,
          enabled: !!t.enabled,
          next_run_at: t.next_run_at,
          last_run_at: t.last_run_at,
          run_count: t.run_count,
          max_runs: t.max_runs,
        })),
      };
    }
    case 'delete_scheduled_task': {
      const { task_id } = toolInput;
      const { getScheduledTask } = await import('../cache/database.js');
      const existing = getScheduledTask(task_id);
      if (!existing || existing.tenant_id !== tenantId) {
        return { error: `Task not found: "${task_id}"` };
      }
      deleteScheduledTask(task_id, tenantId);
      return { message: `Scheduled task "${existing.title}" deleted.`, deleted_id: task_id };
    }
    default:
      throw new Error(`Unknown scheduler tool: ${toolName}`);
  }
}

const SCHEDULER_TOOLS_PROMPT_ADDON = `

You can create and manage recurring scheduled tasks:
- create_scheduled_task: Set up automated recurring tasks that run on a cron schedule (daily reports, weekly emails, periodic checks). The prompt runs as if a user sent it.
- list_scheduled_tasks: View all scheduled tasks with their status, schedule, and run history.
- delete_scheduled_task: Remove a scheduled task by ID.

Common cron patterns:
- "0 9 * * *" = daily at 9 AM
- "0 9 * * 1" = every Monday at 9 AM
- "0 9 * * 1-5" = weekdays at 9 AM
- "0 */4 * * *" = every 4 hours
- "30 8 1 * *" = 1st of each month at 8:30 AM`;

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
  // ── Construction Copilot Tools (Steps 1, 5, 8) ──
  {
    name: 'analyze_itb',
    description: 'Deep-analyze an Invitation to Bid (ITB). Extracts project summary, scope breakdown by CSI division, specification requirements (concrete psi, rebar grade, special mixes), compliance requirements (DBE, Buy America, prevailing wage), flags missing critical information, identifies risk factors, and provides a bid/no-bid recommendation. Use when a new bid request comes in and the estimator needs a comprehensive analysis before deciding to bid.',
    input_schema: {
      type: 'object',
      properties: {
        bid_request_id: { type: 'string', description: 'The bid request ID to analyze (e.g. "BR-001")' },
      },
      required: ['bid_request_id'],
    },
  },
  {
    name: 'draft_supplier_quotes',
    description: 'Draft email quote requests to material suppliers (concrete, rebar, masonry, formwork). Takes material specifications and quantities from a bid request and generates professionally formatted emails to preferred suppliers requesting pricing. Use after analyzing an ITB when the estimator needs material pricing from suppliers.',
    input_schema: {
      type: 'object',
      properties: {
        bid_request_id: { type: 'string', description: 'The bid request ID to generate quotes for' },
        project_name: { type: 'string', description: 'Project name for the quote request' },
        gc_name: { type: 'string', description: 'General contractor name' },
        project_location: { type: 'string', description: 'Project location (city, state)' },
        bid_due_date: { type: 'string', description: 'Bid due date' },
        materials: {
          type: 'array',
          description: 'Array of materials to request quotes for',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string', enum: ['concrete', 'rebar', 'masonry', 'formwork'], description: 'Material category' },
              type: { type: 'string', description: 'Specific material type (e.g. "4000 psi concrete", "Grade 60 rebar")' },
              specifications: { type: 'array', items: { type: 'string' }, description: 'Spec requirements (ASTM standards, mix design, etc.)' },
              quantities: { type: 'array', items: { type: 'string' }, description: 'Quantity descriptions (e.g. "~2,400 CY total", "Foundations: 800 CY at 4000 psi")' },
              special_requirements: { type: 'string', description: 'Any special requirements' },
              delivery_notes: { type: 'string', description: 'Delivery requirements or schedule notes' },
            },
            required: ['category', 'type'],
          },
        },
      },
      required: ['project_name', 'materials'],
    },
  },
  {
    name: 'compare_contract',
    description: 'Compare a GC subcontract against DACP\'s submitted proposal. Performs line-by-line comparison of scope items, exclusions, financial terms, insurance requirements, and legal clauses. Flags scope additions not in original bid, missing exclusions that expose DACP to cost, unfavorable terms, and generates recommended redlines. Use when DACP receives a contract from a GC and needs to verify it matches the proposal before signing.',
    input_schema: {
      type: 'object',
      properties: {
        proposal_text: { type: 'string', description: 'Full text of DACP\'s submitted proposal' },
        contract_text: { type: 'string', description: 'Full text of the GC\'s subcontract' },
        bid_request_id: { type: 'string', description: 'Associated bid request ID (optional)' },
      },
      required: ['proposal_text', 'contract_text'],
    },
  },
  // ── Construction Copilot V2 Tools (Steps 2-4, 6-7 + extras) ──
  {
    name: 'generate_proposal',
    description: 'Generate a professional Word proposal document for a DACP bid. Includes company letterhead, project details, scope breakdown (concrete, masonry, site work), material specs, exclusions, clarifications, total bid, and signature block. Returns a downloadable .docx file. Use after the estimate is finalized and ready to submit to the GC.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Project name' },
        gc_name: { type: 'string', description: 'General contractor name' },
        owner: { type: 'string', description: 'Project owner' },
        architect: { type: 'string', description: 'Architect of record' },
        plan_date: { type: 'string', description: 'Plan/drawing date' },
        addenda: { type: 'string', description: 'Addenda acknowledged' },
        location: { type: 'string', description: 'Project location' },
        bid_due_date: { type: 'string', description: 'Bid due date' },
        concrete_scope: { type: 'array', items: { type: 'string' }, description: 'Concrete scope items' },
        masonry_scope: { type: 'array', items: { type: 'string' }, description: 'Masonry scope items' },
        site_work_scope: { type: 'array', items: { type: 'string' }, description: 'Site work scope items' },
        material_specs: { type: 'array', items: { type: 'string' }, description: 'Material specifications' },
        equipment: { type: 'array', items: { type: 'string' }, description: 'Equipment list' },
        exclusions: { type: 'array', items: { type: 'string' }, description: 'Exclusions from bid' },
        clarifications: { type: 'array', items: { type: 'string' }, description: 'Clarifications and assumptions' },
        total_bid: { type: 'number', description: 'Total bid amount in dollars' },
        estimated_duration: { type: 'string', description: 'Estimated project duration' },
      },
      required: ['project_name', 'gc_name', 'total_bid'],
    },
  },
  {
    name: 'run_bid_checks',
    description: 'Run sanity checks on an estimate to flag cost outliers and potential issues. Checks: $/CY range ($700-$1,300), SOG $/SF range ($6.80-$10.14), 50% labor stress test, effective margin (20%+ target), and labor percentage of field cost. Returns pass/warn/fail for each check with an overall verdict. Use before finalizing any estimate.',
    input_schema: {
      type: 'object',
      properties: {
        estimate_id: { type: 'string', description: 'The estimate ID to check' },
      },
      required: ['estimate_id'],
    },
  },
  {
    name: 'generate_takeoff_template',
    description: 'Generate a pre-populated Excel takeoff template with 4 sheets: Takeoff (with quantity formulas), Pricing (linked to takeoff), Masonry (common block types), and Equipment. Configured for the specific project and assemblies. Use at Step 3-4 when the estimator is about to start the quantity takeoff in PlanSwift.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Project name' },
        gc_name: { type: 'string', description: 'General contractor name' },
        assemblies: {
          type: 'array',
          description: 'Assembly categories for this project',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Assembly name (e.g. "Footings", "SOG", "Walls")' },
              csi_division: { type: 'string', description: 'CSI division (e.g. "03 30 00")' },
              unit: { type: 'string', description: 'Unit of measure (CY, SF, LF, EA)' },
            },
          },
        },
      },
      required: ['project_name'],
    },
  },
  {
    name: 'generate_compliance_forms',
    description: 'Generate pre-filled compliance forms as a Word document. Includes: DBE Participation Form, Buy America Certificate, Non-Collusion Affidavit, and Certificate on Primary Debarment. All pre-filled with DACP company data. Use when submitting a bid that requires compliance documentation.',
    input_schema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', description: 'Project name' },
        gc_name: { type: 'string', description: 'General contractor name' },
        bid_date: { type: 'string', description: 'Bid submission date' },
      },
      required: ['project_name'],
    },
  },
  {
    name: 'generate_contract_redline',
    description: 'Generate a Word document with color-coded redlines from a contract comparison. Red strikethrough for removals, green underline for additions, amber for discussion items. Organizes findings by: scope additions, missing exclusions, recommended redlines, legal concerns, and action items. Use after compare_contract to create a shareable redline document.',
    input_schema: {
      type: 'object',
      properties: {
        comparison: { type: 'object', description: 'The comparison result from compare_contract tool' },
        project_name: { type: 'string', description: 'Project name' },
      },
      required: ['comparison', 'project_name'],
    },
  },
  {
    name: 'parse_supplier_quote',
    description: 'Parse an incoming supplier quote email to extract pricing, materials, quantities, delivery info, and validity dates. Use when a supplier responds to a quote request and the estimator needs to update pricing in the estimate.',
    input_schema: {
      type: 'object',
      properties: {
        email_body: { type: 'string', description: 'Full text of the supplier quote email' },
        from_name: { type: 'string', description: 'Sender name' },
        from_email: { type: 'string', description: 'Sender email address' },
      },
      required: ['email_body'],
    },
  },
  {
    name: 'get_approval_draft',
    description: 'Read the current email draft from an approval item. Use this to see what the draft currently says before editing it with update_approval_draft.',
    input_schema: {
      type: 'object',
      properties: {
        approval_id: { type: 'integer', description: 'The approval item ID to read' },
      },
      required: ['approval_id'],
    },
  },
  {
    name: 'update_approval_draft',
    description: 'Update a pending approval item\'s email draft. Use this after the user asks you to edit an estimate reply or email draft. Updates the email body/HTML and optionally the subject line. The user can then review the updated draft on the Command Dashboard and approve it to send.',
    input_schema: {
      type: 'object',
      properties: {
        approval_id: { type: 'integer', description: 'The approval item ID to update' },
        body: { type: 'string', description: 'The updated email body text (plain text / markdown). Will be auto-converted to HTML.' },
        subject: { type: 'string', description: 'Updated subject line (optional — only if the subject needs to change)' },
        to: { type: 'string', description: 'Updated recipient email (optional — only if the recipient needs to change)' },
      },
      required: ['approval_id', 'body'],
    },
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

    // ── Construction Copilot Tools ──
    case 'analyze_itb': {
      const { analyzeItb, DEMO_ITB } = await import('./constructionCopilot.js');
      let bidReq;
      if (toolInput.bid_request_id === 'BR-DEMO-001') {
        bidReq = DEMO_ITB;
      } else {
        bidReq = getDacpBidRequest(tid, toolInput.bid_request_id);
      }
      if (!bidReq) throw new Error(`Bid request ${toolInput.bid_request_id} not found`);
      const analysis = await analyzeItb(bidReq);
      return { bid_request_id: toolInput.bid_request_id, analysis };
    }

    case 'draft_supplier_quotes': {
      const { draftSupplierQuotes } = await import('./constructionCopilot.js');
      const quotes = draftSupplierQuotes(
        toolInput.project_name,
        toolInput.gc_name || '',
        toolInput.bid_due_date || '',
        toolInput.materials || [],
        toolInput.project_location || '',
      );
      return { project_name: toolInput.project_name, quotes };
    }

    case 'compare_contract': {
      const { compareContractProposal, DEMO_PROPOSAL, DEMO_CONTRACT } = await import('./constructionCopilot.js');
      const proposalText = toolInput.proposal_text || DEMO_PROPOSAL;
      const contractText = toolInput.contract_text || DEMO_CONTRACT;
      const comparison = await compareContractProposal(proposalText, contractText);
      return { bid_request_id: toolInput.bid_request_id || null, comparison };
    }

    // ── V2 Tools ──
    case 'generate_proposal': {
      const { generateProposal } = await import('./constructionCopilotV2.js');
      const result = await generateProposal({
        projectName: toolInput.project_name,
        gcName: toolInput.gc_name,
        owner: toolInput.owner || '',
        architect: toolInput.architect || '',
        planDate: toolInput.plan_date || '',
        addenda: toolInput.addenda || '',
        location: toolInput.location || '',
        bidDueDate: toolInput.bid_due_date || '',
        concreteScope: toolInput.concrete_scope || [],
        masonryScope: toolInput.masonry_scope || [],
        siteWorkScope: toolInput.site_work_scope || [],
        materialSpecs: toolInput.material_specs || [],
        equipment: toolInput.equipment || [],
        exclusions: toolInput.exclusions || [],
        clarifications: toolInput.clarifications || [],
        totalBid: toolInput.total_bid,
        estimatedDuration: toolInput.estimated_duration || '',
      });
      return result;
    }

    case 'run_bid_checks': {
      const { runBidSanityChecks } = await import('./constructionCopilotV2.js');
      const estimate = getDacpEstimate(tid, toolInput.estimate_id);
      if (!estimate) throw new Error(`Estimate ${toolInput.estimate_id} not found`);
      if (estimate.line_items_json) estimate.line_items = JSON.parse(estimate.line_items_json);
      return runBidSanityChecks(estimate);
    }

    case 'generate_takeoff_template': {
      const { generateTakeoffTemplate } = await import('./constructionCopilotV2.js');
      return await generateTakeoffTemplate(toolInput.project_name, toolInput.gc_name || '', toolInput.assemblies || []);
    }

    case 'generate_compliance_forms': {
      const { generateComplianceForms } = await import('./constructionCopilotV2.js');
      return await generateComplianceForms(toolInput.project_name, toolInput.gc_name || '', toolInput.bid_date || '');
    }

    case 'generate_contract_redline': {
      const { generateContractRedline } = await import('./constructionCopilotV2.js');
      return await generateContractRedline(toolInput.comparison, toolInput.project_name);
    }

    case 'parse_supplier_quote': {
      const { parseSupplierQuote } = await import('./constructionCopilotV2.js');
      return parseSupplierQuote(toolInput.email_body, toolInput.from_name || '', toolInput.from_email || '');
    }

    case 'get_approval_draft': {
      const { getApprovalItem } = await import('../cache/database.js');
      const item = getApprovalItem(tid, toolInput.approval_id);
      if (!item) throw new Error(`Approval item ${toolInput.approval_id} not found`);
      const payload = item.payload_json ? JSON.parse(item.payload_json) : {};
      return {
        approval_id: toolInput.approval_id,
        status: item.status,
        to: payload.to || null,
        subject: payload.subject || null,
        total_bid: payload.totalBid || null,
        body: payload.body || '',
        attachment: payload.attachment || null,
      };
    }

    case 'update_approval_draft': {
      const { getApprovalItem, updateApprovalPayload } = await import('../cache/database.js');
      const { markdownToEmailHtml } = await import('./emailService.js');
      const item = getApprovalItem(tid, toolInput.approval_id);
      if (!item) throw new Error(`Approval item ${toolInput.approval_id} not found`);
      if (item.status !== 'pending') throw new Error(`Cannot edit — approval is already ${item.status}`);

      const existing = item.payload_json ? JSON.parse(item.payload_json) : {};
      const updatedPayload = {
        ...existing,
        body: toolInput.body,
        html: markdownToEmailHtml(toolInput.body),
      };
      if (toolInput.subject) updatedPayload.subject = toolInput.subject;
      if (toolInput.to) updatedPayload.to = toolInput.to;

      const newTitle = toolInput.subject
        ? `Send estimate reply: ${toolInput.subject}`
        : null;

      updateApprovalPayload(tid, toolInput.approval_id, JSON.stringify(updatedPayload), newTitle);
      return { success: true, approval_id: toolInput.approval_id, message: 'Draft updated. Go to Command Dashboard to review and approve.' };
    }

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

CONSTRUCTION COPILOT TOOLS (8-Step Estimating Workflow):
- analyze_itb: Deep-analyze an ITB — extracts scope by CSI division, spec requirements, compliance needs, flags missing info, recommends bid/no-bid. Use on any new bid request. (Step 1)
- generate_takeoff_template: Generate pre-populated Excel takeoff template with Takeoff, Pricing, Masonry, and Equipment sheets. (Steps 3-4)
- draft_supplier_quotes: Draft emails to material suppliers requesting pricing. Requires approval before sending. (Step 5)
- run_bid_checks: Run sanity checks on an estimate — $/CY range, SOG $/SF, labor stress test, margin check. (Step 6)
- parse_supplier_quote: Parse incoming supplier quote emails to extract pricing and delivery info. (Step 5 follow-up)
- create_estimate: Build the formal estimate with line items, overhead, profit, mobilization. (Step 6)
- generate_proposal: Generate professional Word proposal with DACP letterhead, scope, exclusions, total bid. Requires approval. (Step 7)
- generate_compliance_forms: Generate pre-filled DBE, Buy America, Non-Collusion, and Debarment forms. Requires approval. (Step 7)
- compare_contract: Compare GC subcontract against DACP's proposal — flags scope additions, missing exclusions, unfavorable terms. (Step 8)
- generate_contract_redline: Generate color-coded Word redline document from contract comparison. Requires approval. (Step 8)

COPILOT WORKFLOW:
When walking the estimator through the 8-step process:
1. RECEIVE ITB → Use analyze_itb to parse the bid request and present findings
2. ORGANIZE DOCUMENTS → List what documents are available and what's missing
3. CONFIGURE TAKEOFF → Use generate_takeoff_template to create a pre-populated Excel sheet for PlanSwift
4. QUANTITY TAKEOFF → This is the estimator's manual step (PlanSwift). Assist with questions but don't try to do the takeoff.
5. SUPPLIER PRICING → Use draft_supplier_quotes to email suppliers. When quotes come back, use parse_supplier_quote to extract pricing.
6. BID SUMMARY → Use create_estimate to build the bid, then run_bid_checks to validate ($/CY $700-$1,300, SOG $/SF $6.80-$10.14, 20%+ margin).
7. PROPOSAL → Use generate_proposal to create the Word doc, then generate_compliance_forms for DBE/Buy America docs. Present for approval.
8. CONTRACT REVIEW → Use compare_contract to analyze, then generate_contract_redline to create a shareable marked-up document.

For the demo ITB (BR-DEMO-001 — Riverside Commerce Center), you can walk through all 8 steps.

When asked to estimate concrete work, ALWAYS use lookup_pricing first to get current rates, then create_estimate with proper line items. Be precise with quantities and units.

DRAFT EDITING:
- get_approval_draft: Read the current email draft from an approval item. ALWAYS call this first when the user wants to edit a draft, so you can see the current content before making changes.
- update_approval_draft: Update a pending email draft in the approval queue. Use this with the approval_id and the full new email body text. The text will be auto-converted to HTML. The user can review the updated draft in the context panel and approve it on the Command Dashboard.`;

const CONTEXT_PROMPT_ADDON = `

You have context panel tools for maintaining entity profiles and pinning items:
- update_entity_profile: Create or update a profile for a person, company, or project. Profiles persist across sessions and appear in the context panel sidebar.
- pin_to_context: Pin an entity, file, or note to the current conversation's context panel for quick reference.

IMPORTANT — Proactive profile enrichment:
- Whenever you look up or discuss a company, GC, person, or project, ALWAYS call update_entity_profile with any useful metadata you found (contact info, bid history, project details, relationship notes, etc.)
- Do this automatically after any tool call that returns data about an entity (e.g. after searching bids, jobs, emails, knowledge base)
- Also pin relevant files or notes to the context panel using pin_to_context when they are directly relevant to the conversation
- The user's context panel updates in real-time — enriching profiles makes the sidebar immediately more useful`;

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

// ─── Google Workspace CLI Tools (gws) ─────────────────────────────────────────

const GWS_TOOLS = [
  {
    name: 'gws_gmail_search',
    description: 'Search the Gmail inbox using any Gmail search query. Returns matching emails with sender, subject, date, and snippet. Use for finding specific emails, threads, or correspondence.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query (e.g., "from:spencer subject:acciona", "is:unread newer_than:7d", "has:attachment filename:pdf")' },
        max_results: { type: 'number', description: 'Max results to return (default 10, max 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gws_gmail_read',
    description: 'Read the full content of a specific email by its message ID. Returns headers, body text, labels, and metadata. Use after gws_gmail_search to read a specific result.',
    input_schema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Gmail message ID (from gws_gmail_search results)' },
      },
      required: ['message_id'],
    },
  },
  {
    name: 'gws_calendar_events',
    description: 'List upcoming calendar events. Returns event titles, times, attendees, and Meet links.',
    input_schema: {
      type: 'object',
      properties: {
        max_results: { type: 'number', description: 'Max events to return (default 10)' },
        time_min: { type: 'string', description: 'Start of time range (ISO 8601). Defaults to now.' },
      },
      required: [],
    },
  },
  {
    name: 'gws_drive_search',
    description: 'Search Google Drive for files and folders. Use Drive search query syntax. Returns file names, types, links, and modification dates.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Drive search query (e.g., "name contains \'report\'", "mimeType=\'application/pdf\'", "modifiedTime > \'2026-03-01\'")' },
        max_results: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gws_sheets_read',
    description: 'Read data from a Google Sheets spreadsheet. Returns cell values for the specified range.',
    input_schema: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string', description: 'Google Sheets spreadsheet ID (from the URL)' },
        range: { type: 'string', description: 'Cell range in A1 notation (e.g., "Sheet1!A1:D10", "Sheet1")' },
      },
      required: ['spreadsheet_id', 'range'],
    },
  },
  {
    name: 'gws_sheets_append',
    description: 'Append rows to a Google Sheets spreadsheet. Adds data after the last row in the specified range.',
    input_schema: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string', description: 'Google Sheets spreadsheet ID' },
        range: { type: 'string', description: 'Target range in A1 notation (e.g., "Sheet1!A:D")' },
        values: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Rows to append. Each row is an array of cell values (e.g., [["Name","Email"],["Teo","teo@zhan.capital"]])',
        },
      },
      required: ['spreadsheet_id', 'range', 'values'],
    },
  },
  {
    name: 'gws_workspace_command',
    description: 'Run any Google Workspace CLI command. Use this for operations not covered by other gws tools (e.g., Docs, Slides, Tasks, People). Only use services: drive, gmail, calendar, sheets, docs, slides, tasks, people.',
    input_schema: {
      type: 'object',
      properties: {
        service: { type: 'string', description: 'Workspace service (drive, gmail, calendar, sheets, docs, slides, tasks, people)' },
        resource: { type: 'string', description: 'API resource (e.g., "files", "users", "events", "spreadsheets.values")' },
        method: { type: 'string', description: 'API method (e.g., "list", "get", "create", "update")' },
        params: { type: 'object', description: 'URL/query parameters as JSON object' },
        body: { type: 'object', description: 'Request body for POST/PATCH/PUT operations' },
      },
      required: ['service', 'resource', 'method'],
    },
  },
  {
    name: 'gws_sheets_update',
    description: 'Update specific cells in a Google Sheets spreadsheet. Overwrites the values in the given range.',
    input_schema: {
      type: 'object',
      properties: {
        spreadsheet_id: { type: 'string', description: 'Google Sheets spreadsheet ID (from the URL)' },
        range: { type: 'string', description: 'Target range in A1 notation (e.g., "Sheet1!A1:C3", "Sheet1!B2")' },
        values: {
          type: 'array',
          items: { type: 'array' },
          description: 'Grid of values to write. Each inner array is a row (e.g., [["Name","Score"],["Alice",95],["Bob",87]])',
        },
      },
      required: ['spreadsheet_id', 'range', 'values'],
    },
  },
  {
    name: 'gws_docs_update',
    description: 'Update the content of a Google Doc. Can replace all content or append to the end. Content is plain text or simple text with newlines.',
    input_schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'Google Docs document ID (from the URL)' },
        content: { type: 'string', description: 'Text content to write (plain text with newlines)' },
        mode: { type: 'string', enum: ['replace', 'append'], description: 'Write mode: "replace" clears the doc and writes new content, "append" adds to the end. Default: "append"' },
      },
      required: ['document_id', 'content'],
    },
  },
  {
    name: 'gws_drive_create',
    description: 'Create a new Google Doc or Google Sheet in Drive. Optionally place it in a specific folder and set initial content.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Name of the new file' },
        type: { type: 'string', enum: ['doc', 'sheet'], description: 'File type: "doc" for Google Doc, "sheet" for Google Sheet' },
        folder_id: { type: 'string', description: 'Optional Google Drive folder ID to place the file in' },
        content: { type: 'string', description: 'Optional initial text content (for docs). For sheets, use gws_sheets_update after creation.' },
      },
      required: ['title', 'type'],
    },
  },
];

const GWS_TOOLS_PROMPT_ADDON = `

GOOGLE WORKSPACE CLI (gws):
You have access to the Google Workspace CLI for direct access to Gmail, Drive, Calendar, Sheets, Docs, and other Workspace APIs.

Available tools:
- gws_gmail_search: Search emails with any Gmail query syntax
- gws_gmail_read: Read full email content by message ID
- gws_calendar_events: List upcoming calendar events
- gws_drive_search: Search Google Drive files
- gws_sheets_read: Read spreadsheet data
- gws_sheets_append: Append rows to a spreadsheet
- gws_sheets_update: Overwrite specific cells in a spreadsheet (A1 notation range + 2D values array)
- gws_docs_update: Replace or append text content to a Google Doc
- gws_drive_create: Create a new Google Doc or Sheet (optionally in a folder with initial content)
- gws_workspace_command: Run any Workspace API command (for Docs, Slides, Tasks, etc.)

Notes:
- Gmail search supports full Gmail syntax: from:, to:, subject:, has:attachment, newer_than:, etc.
- Drive search uses Drive query syntax: name contains 'x', mimeType='...', etc.
- For gws_sheets_update, provide a 2D array matching the target range dimensions.
- For gws_docs_update, mode "replace" clears the document first; "append" adds to the end.
- For gws_drive_create, use type "doc" or "sheet". After creating a sheet, use gws_sheets_update to populate cells.
- For gws_workspace_command, use the service/resource/method pattern (e.g., service:"docs", resource:"documents", method:"get", params:{documentId:"..."})
- Drive operations may fail if the agent's token lacks Drive scopes — use the existing generate_document tool for file creation instead.
- IMPORTANT: When the user references a file, spreadsheet, or document, ALWAYS search Drive first using gws_drive_search before asking for a link. Try multiple search queries if needed. If you find candidates, present them to the user for confirmation.`;

/**
 * Create an OAuth2 client for a tenant's Google API calls (Sheets, Docs, Drive).
 * Mirrors the pattern from driveSync.js — resolves refresh token from key vault or email config.
 */
async function makeGoogleAuth(tenantId) {
  const { getKeyVaultValue, getTenantEmailConfig } = await import('../cache/database.js');
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;

  let refreshToken = getKeyVaultValue(tenantId, 'google-docs', 'refresh_token');
  if (!refreshToken) {
    const emailConfig = getTenantEmailConfig(tenantId);
    refreshToken = emailConfig?.gmailRefreshToken || emailConfig?.gmail_refresh_token;
  }

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(`No Google OAuth credentials available for tenant "${tenantId}"`);
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:8099');
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

async function callGwsTool(toolName, toolInput, tenantId) {
  const gws = await import('./gwsService.js');
  const ALLOWED_SERVICES = new Set(['drive', 'gmail', 'calendar', 'sheets', 'docs', 'slides', 'tasks', 'people']);

  switch (toolName) {
    case 'gws_gmail_search':
      return await gws.gmailSearch(toolInput.query, Math.min(toolInput.max_results || 10, 20), tenantId);

    case 'gws_gmail_read':
      return await gws.gmailRead(toolInput.message_id, tenantId);

    case 'gws_calendar_events':
      return await gws.calendarListEvents('primary', toolInput.max_results || 10, toolInput.time_min || null, tenantId);

    case 'gws_drive_search':
      return await gws.driveSearch(toolInput.query, toolInput.max_results || 10, tenantId);

    case 'gws_sheets_read':
      return await gws.sheetsRead(toolInput.spreadsheet_id, toolInput.range, tenantId);

    case 'gws_sheets_append':
      return await gws.sheetsAppend(toolInput.spreadsheet_id, toolInput.range, toolInput.values, tenantId);

    case 'gws_workspace_command': {
      if (!ALLOWED_SERVICES.has(toolInput.service)) {
        throw new Error(`Service "${toolInput.service}" not allowed. Use: ${[...ALLOWED_SERVICES].join(', ')}`);
      }
      const args = [toolInput.service, toolInput.resource, toolInput.method];
      if (toolInput.params) args.push('--params', JSON.stringify(toolInput.params));
      if (toolInput.body) args.push('--json', JSON.stringify(toolInput.body));
      return await gws.execGws(args, tenantId);
    }

    case 'gws_sheets_update': {
      const auth = await makeGoogleAuth(tenantId);
      const sheets = google.sheets({ version: 'v4', auth });
      const res = await sheets.spreadsheets.values.update({
        spreadsheetId: toolInput.spreadsheet_id,
        range: toolInput.range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: toolInput.values },
      });
      return {
        updatedRange: res.data.updatedRange,
        updatedRows: res.data.updatedRows,
        updatedColumns: res.data.updatedColumns,
        updatedCells: res.data.updatedCells,
      };
    }

    case 'gws_docs_update': {
      const auth = await makeGoogleAuth(tenantId);
      const docs = google.docs({ version: 'v1', auth });
      const mode = toolInput.mode || 'append';

      if (mode === 'replace') {
        // Get current document to find content length
        const doc = await docs.documents.get({ documentId: toolInput.document_id });
        const body = doc.data.body;
        const endIndex = body.content[body.content.length - 1].endIndex;

        const requests = [];
        // Delete all existing content (keep the trailing newline at index 1)
        if (endIndex > 2) {
          requests.push({
            deleteContentRange: {
              range: { startIndex: 1, endIndex: endIndex - 1 },
            },
          });
        }
        // Insert new content at position 1
        requests.push({
          insertText: {
            location: { index: 1 },
            text: toolInput.content,
          },
        });

        await docs.documents.batchUpdate({
          documentId: toolInput.document_id,
          requestBody: { requests },
        });
        return { success: true, mode: 'replace', document_id: toolInput.document_id, characters_written: toolInput.content.length };
      } else {
        // Append mode — insert at end of document
        const doc = await docs.documents.get({ documentId: toolInput.document_id });
        const body = doc.data.body;
        const endIndex = body.content[body.content.length - 1].endIndex;

        await docs.documents.batchUpdate({
          documentId: toolInput.document_id,
          requestBody: {
            requests: [{
              insertText: {
                location: { index: endIndex - 1 },
                text: toolInput.content,
              },
            }],
          },
        });
        return { success: true, mode: 'append', document_id: toolInput.document_id, characters_written: toolInput.content.length };
      }
    }

    case 'gws_drive_create': {
      const auth = await makeGoogleAuth(tenantId);
      const drive = google.drive({ version: 'v3', auth });

      const mimeTypes = {
        doc: 'application/vnd.google-apps.document',
        sheet: 'application/vnd.google-apps.spreadsheet',
      };
      const mimeType = mimeTypes[toolInput.type];
      if (!mimeType) throw new Error(`Invalid type "${toolInput.type}". Use "doc" or "sheet".`);

      const fileMetadata = { name: toolInput.title, mimeType };
      if (toolInput.folder_id) fileMetadata.parents = [toolInput.folder_id];

      const created = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, mimeType, webViewLink',
      });

      const result = {
        id: created.data.id,
        name: created.data.name,
        type: toolInput.type,
        url: created.data.webViewLink,
      };

      // If initial content provided for a doc, write it
      if (toolInput.content && toolInput.type === 'doc') {
        const docs = google.docs({ version: 'v1', auth });
        await docs.documents.batchUpdate({
          documentId: created.data.id,
          requestBody: {
            requests: [{
              insertText: {
                location: { index: 1 },
                text: toolInput.content,
              },
            }],
          },
        });
        result.content_written = true;
      }

      return result;
    }

    default:
      throw new Error(`Unknown gws tool: ${toolName}`);
  }
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

// ─── Code Execution ──────────────────────────────────────────────────────
const CODE_EXECUTION_TOOLS = [
  {
    name: 'execute_code',
    description: 'Execute code in a sandboxed environment. Use this for calculations, data analysis, file processing, generating charts, or any computational task. The sandbox has Python 3 (with pandas, numpy, matplotlib), Node.js, and bash. Files written to /workspace persist across calls within the conversation.',
    input_schema: {
      type: 'object',
      properties: {
        language: { type: 'string', enum: ['python', 'javascript', 'bash'], description: 'Programming language to use' },
        code: { type: 'string', description: 'Code to execute' },
      },
      required: ['language', 'code'],
    },
  },
];

const CODE_EXECUTION_PROMPT_ADDON = `

═══ CODE EXECUTION ═══
You have access to a sandboxed code execution environment. Use the execute_code tool when you need to:
- Perform calculations or data analysis
- Process or transform data
- Generate charts or visualizations (save to /workspace, use matplotlib for Python)
- Run scripts or automate tasks
- Parse files or work with structured data

The sandbox has Python 3 (pandas, numpy, matplotlib, requests), Node.js, and bash.
Files in /workspace persist across calls. Output is captured from stdout/stderr.
The sandbox has NO internet access and a 30-second timeout.`;

const codeAgents = ['hivemind', 'sangha', 'zhan', 'workflow'];

async function callCodeTool(input, tenantId) {
  const { language, code } = input;
  if (!['python', 'javascript', 'bash'].includes(language)) {
    return { error: 'Invalid language. Use python, javascript, or bash.' };
  }
  const { executeCode } = await import('./sandboxService.js');
  const result = await executeCode(tenantId, language, code);

  let output = '';
  if (result.stdout) output += result.stdout;
  if (result.stderr) output += (output ? '\n\nSTDERR:\n' : '') + result.stderr;
  if (!output) output = `(no output, exit code: ${result.exitCode})`;
  output += `\n\n[Executed in ${result.durationMs}ms, exit code: ${result.exitCode}]`;

  return output;
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

// ─── Context Tool Handler ────────────────────────────────────────────────────

async function callContextTool(toolName, toolInput, tenantId, threadId, onContextUpdate) {
  const { upsertKnowledgeEntity, addContextPin } = await import('../cache/database.js');

  if (toolName === 'update_entity_profile') {
    const { name, entity_type, metadata = {} } = toolInput;
    const entity = upsertKnowledgeEntity(tenantId, name, entity_type, metadata);
    if (onContextUpdate) {
      onContextUpdate({ type: 'entity_updated', entity });
    }
    return { success: true, action: entity._action, entity: { id: entity.id, name: entity.name, type: entity.entity_type } };
  }

  if (toolName === 'pin_to_context') {
    const { pin_type, ref_id, label, note } = toolInput;
    const metadata = note ? { note } : null;
    const pin = addContextPin(tenantId, threadId, pin_type, ref_id || '', label, metadata, 'agent');
    if (onContextUpdate) {
      onContextUpdate({ type: 'pin_added', pin });
    }
    return { success: true, pinId: pin.id, label };
  }

  throw new Error(`Unknown context tool: ${toolName}`);
}

// ─── Task Proposal Tool Handler ──────────────────────────────────────────────

async function callTaskProposalTool(toolName, toolInput, tenantId) {
  const { insertAgentAssignment } = await import('../cache/database.js');
  const { randomUUID } = await import('crypto');
  const { title, description, category = 'research', priority = 'medium', action_prompt, sources } = toolInput;

  const id = `TASK-${randomUUID().slice(0, 8).toUpperCase()}`;
  insertAgentAssignment({
    id,
    tenant_id: tenantId,
    title,
    description,
    category,
    priority,
    action_prompt,
    agent_id: _toolContext.agentId || 'coppice',
    context_json: sources ? JSON.stringify({ sources }) : null,
  });

  return {
    success: true,
    assignment_id: id,
    title,
    description,
    category,
    priority,
    sources: sources || [],
    message: `Task "${title}" has been proposed. The user can review and run it from the chat or dashboard.`,
    _task_proposal: true,
  };
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

    // Search synced Drive files for relevant content (RAG)
    try {
      const driveResults = searchDriveContents(tenantId, userMessage, 3);
      if (driveResults.length > 0) {
        let dc = 'RELEVANT DRIVE FILE EXCERPTS:\n\n';
        for (const r of driveResults) {
          dc += `[FILE: ${r.name}] ${r.category || ''}\n`;
          dc += `${r.snippet}\n\n`;
        }
        contextBlocks.push(dc);
      }
    } catch (e) { /* Drive search not available yet */ }
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
      'X-Internal-Secret': process.env.WORKSPACE_INTERNAL_SECRET || 'dev-secret',
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
    case 'run_full_cycle':
      return await le.runFullCycle(tenantId);
    case 'update_lead': {
      const { updateLead: dbUpdateLead, getLead: dbGetLead } = await import('../cache/database.js');
      const updates = {};
      if (toolInput.status) updates.status = toolInput.status;
      if (toolInput.notes) updates.notes = toolInput.notes;
      if (toolInput.priority_score != null) updates.priority_score = toolInput.priority_score;
      dbUpdateLead(tenantId, toolInput.lead_id, updates);
      const updated = dbGetLead(tenantId, toolInput.lead_id);
      return { success: true, lead: updated };
    }
    case 'update_discovery_config': {
      const { getLeadDiscoveryConfig: dbGetCfg, upsertLeadDiscoveryConfig: dbUpsertCfg } = await import('../cache/database.js');
      const existing = dbGetCfg(tenantId) || {};
      const merged = {
        id: existing.id || 1,
        tenantId,
        queries: toolInput.queries || existing.queries || [],
        regions: toolInput.regions || existing.regions || [],
        currentPosition: existing.current_position || 0,
        queriesPerCycle: toolInput.queries_per_cycle ?? existing.queries_per_cycle ?? 2,
        maxEmailsPerCycle: toolInput.max_emails_per_cycle ?? existing.max_emails_per_cycle ?? 10,
        followupDelayDays: toolInput.followup_delay_days ?? existing.followup_delay_days ?? 5,
        maxFollowups: toolInput.max_followups ?? existing.max_followups ?? 2,
        minSendIntervalSeconds: existing.min_send_interval_seconds || 300,
        enabled: toolInput.enabled != null ? (toolInput.enabled ? 1 : 0) : (existing.enabled ?? 0),
        mode: toolInput.mode || existing.mode || 'copilot',
        senderName: toolInput.sender_name || existing.sender_name || '',
        senderEmail: toolInput.sender_email || existing.sender_email || '',
        emailSignature: existing.email_signature || '',
      };
      dbUpsertCfg(merged);
      return { success: true, config: merged };
    }
    case 'get_discovery_config': {
      const { getLeadDiscoveryConfig: dbGetConfig2 } = await import('../cache/database.js');
      const cfg = dbGetConfig2(tenantId);
      return cfg || { configured: false, message: 'No discovery config set up yet. Use update_discovery_config to configure.' };
    }
    case 'setup_crm_sheet': {
      const { getKeyVaultValue: kvGet, upsertKeyVaultEntry: kvSet, getTenantEmailConfig: getEmailCfg } = await import('../cache/database.js');

      // Check if one already exists
      const existingId = kvGet(tenantId, 'crm', 'sheet_id');
      if (existingId) {
        return { already_exists: true, sheet_id: existingId, sheet_url: `https://docs.google.com/spreadsheets/d/${existingId}/edit`, message: 'A CRM pipeline sheet is already connected to the dashboard.' };
      }

      // Get OAuth token
      const { google: googleapis } = await import('googleapis');
      const cid = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
      const csecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;
      let rToken = kvGet(tenantId, 'google-docs', 'refresh_token');
      if (!rToken) {
        const eCfg = getEmailCfg(tenantId);
        rToken = eCfg?.gmailRefreshToken;
      }
      if (!cid || !csecret || !rToken) {
        return { error: 'No Google account connected. Connect Google Docs & Drive in Settings first.' };
      }

      const oauth = new googleapis.auth.OAuth2(cid, csecret, 'http://localhost:8099');
      oauth.setCredentials({ refresh_token: rToken });
      const sheets = googleapis.sheets({ version: 'v4', auth: oauth });

      const STAGES = ['Discovery', 'Qualification', 'Proposal', 'Negotiation', 'Contract Sent', 'Closed Won'];
      // Get tenant name for sheet title
      const tenantRow = db.prepare('SELECT name FROM tenants WHERE id = ?').get(tenantId);
      const companyName = tenantRow?.name || 'Company';

      const createRes = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: `${companyName} — Deal Pipeline` },
          sheets: [{
            properties: { title: 'Pipeline', gridProperties: { frozenRowCount: 1 } },
            data: [{
              startRow: 0, startColumn: 0,
              rowData: [{
                values: ['Deal Name', 'Company', 'Stage', 'Value ($)', 'Contact', 'Email', 'Notes', 'Updated'].map(h => ({
                  userEnteredValue: { stringValue: h },
                  userEnteredFormat: { textFormat: { bold: true, fontSize: 10 }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.93 } },
                })),
              }],
            }],
          }],
        },
      });

      const newSheetId = createRes.data.spreadsheetId;
      const sheetUrl = createRes.data.spreadsheetUrl;

      // Stage dropdown validation
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: newSheetId,
        requestBody: {
          requests: [{
            setDataValidation: {
              range: { sheetId: 0, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 3 },
              rule: { condition: { type: 'ONE_OF_LIST', values: STAGES.map(s => ({ userEnteredValue: s })) }, showCustomUi: true, strict: false },
            },
          }],
        },
      });

      // Store in key vault
      kvSet({ tenantId, service: 'crm', keyName: 'sheet_id', keyValue: newSheetId, addedBy: 'agent' });

      return { success: true, sheet_id: newSheetId, sheet_url: sheetUrl, message: `Created "${companyName} — Deal Pipeline" and connected it to your dashboard.` };
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
- Run a complete pipeline cycle: discover → enrich → outreach → follow-ups (run_full_cycle)
- Update a lead's status, notes, or priority (update_lead)
- View or modify discovery configuration (get_discovery_config, update_discovery_config)

ABOUT YOUR COMPANY — COPPICE AI:
Coppice AI is a Zhan Capital subsidiary that builds AI employees for businesses. The platform provides autonomous AI agents for estimating, lead generation, outreach, document creation, meeting analysis, and email management. Multi-tenant: each client gets their own AI agent trained on their business.
- Current verticals: Construction (DACP Construction — concrete subcontractor), Energy (Sangha Renewables — Bitcoin mining)
- Pricing: $3,000-5,000/month per AI employee
- Website: coppice.ai
- Parent company: Zhan Capital LLC (founder: Teo Blind)
- Built on Claude (Anthropic) with proprietary orchestration layer

TARGET VERTICALS FOR LEAD DISCOVERY:
When asked to find leads for Coppice, focus on industries where AI agents can replace back-office functions:
- Construction: General contractors, subcontractors, estimating firms (need AI for estimating, bid management, field reporting)
- Energy: Renewable energy companies, power producers, mining operations (need AI for operations monitoring, compliance, reporting)
- Real Estate: Property management firms, brokerages, REITs (need AI for tenant communications, lease management, document processing)
- Legal: Law firms, legal ops (need AI for document drafting, case management, client intake)
- Finance: Wealth management, family offices, PE/VC firms (need AI for portfolio monitoring, investor relations, reporting)
- Insurance: Brokerages, MGAs, carriers (need AI for underwriting, claims processing, policy management)
- Professional Services: Accounting firms, consulting firms (need AI for client management, report generation)
- Healthcare Admin: Medical practices, clinics (need AI for scheduling, billing, patient communications)

When discovering leads, prioritize mid-market companies ($5M-$500M revenue) that have clear operational pain points an AI agent could solve. Focus on companies that are tech-forward but not big enough to build their own AI team.

When the user asks you to set up the pipeline, configure discovery queries, or run cycles, use the update_discovery_config and run_full_cycle tools. You can manage everything through chat — no need to tell users to go to Settings.

Keep responses concise and data-driven.`,

  pools: `You are the Pool Routing Agent for Sangha Holdings. You optimize hashrate distribution across mining pools (Foundry, Braiins, Ocean, etc.) for maximum yield.

Your knowledge includes:
- Pool fee structures and payout methods (FPPS, PPLNS, PPS+)
- Hashrate allocation strategies
- Luck variance and expected vs actual block rewards
- Pool reliability and uptime metrics

Keep responses data-driven with specific hashrate numbers, fee percentages, and yield comparisons.`,

  'sales': `You are the Coppice Sales Agent — an AI sales closer trained on the Triple Aikido technique. You roleplay as a salesperson for the client's company, practicing and executing sales calls using question-based selling.

═══ TRIPLE AIKIDO TECHNIQUE ═══

Core principle: Don't pitch — ask questions and make the prospect sell themselves on why they need the product. Whoever is asking questions controls the conversation.

RULES:
1. FIRST 20 MINUTES = QUESTIONS ONLY. Never pitch until the prospect has told you their problems.
2. NEVER answer a question without bouncing one back. Redirect their energy.
3. BUILD PAIN, BUILD DREAM STATE. Make them feel the gap between where they are and where they want to be.
4. Skip fake rapport. Acknowledge why you're both there. Get straight into problem-solving mode.
5. Let them close themselves: "Based on what you've shared, what would need to happen on your end to move forward?"

DISCOVERY QUESTIONS (adapt to the product/industry):
- "What made you want to [take this call / respond / reach out]?"
- "What's top of mind for you when it comes to [their domain]?"
- "What are [your customers/team] complaining about that you wish you had a solution for?"
- "If you could wave a magic wand and solve one thing, what would it be?"
- "What would it mean for your team if you could [dream state]?"

AIKIDO RESPONSES:
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
4. Use the Triple Aikido technique throughout
5. After the roleplay, debrief: what went well, what to improve, key moments

When the user asks for help preparing for a real call:
1. Research the prospect (use workspace tools if available)
2. Generate a question playbook tailored to that specific prospect
3. Anticipate objections and prepare aikido responses
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

When responding to emails about Zhan Capital, be knowledgeable but concise. Don't volunteer all information at once — answer what's asked and offer to elaborate. Use the Triple Aikido technique for sales-oriented inquiries (answer briefly, ask a question back). Sign emails as "Coppice" — you are the Coppice Agent, not Teo.

IMPORTANT: When someone asks about an investor portal, signing up, accessing dashboards, or getting more information, always include the investor portal link: https://www.zhan.capital/portal

MEETINGS: When someone requests a meeting or call, ask for their preferred day/time and timezone. Then tell them you'll have Teo reach out to confirm. Always CC teo@zhan.capital on any meeting-related email replies so Teo sees it immediately.`,

  // Consolidated DACP agents
  workflow: `You are the Workflow Agent for DACP Construction — a concrete subcontractor specializing in heavy civil, commercial, and infrastructure construction.

You handle estimating, pricing, and job management in a single unified workflow.

ESTIMATING KNOWLEDGE:
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

PRICING TABLE:
You have access to the company's pricing table and can look up or update unit prices for materials, labor, and equipment.

JOB MANAGEMENT:
You can view active jobs, track progress, review field reports, and answer questions about ongoing projects.

You can create Google Docs, Sheets, and Slides to produce estimates, bid packages, comparison tables, and job reports.
You can draft and send bid response emails to GCs.

Keep responses focused on the construction workflow — estimating, pricing, and jobs. Use construction industry terminology naturally. Be precise with numbers.

═══ EMAIL STYLE RULES (MANDATORY — when drafting any email) ═══
GREETING: Always "Hey [First Name]," — never "Hi", "Hello", "Dear".
TONE: Direct, confident, conversational. Short paragraphs (2-4 sentences). Specific numbers over vague claims.
NEVER SAY: "I'd be happy to discuss", "Thanks for your time", "Looking forward to hearing from you", "explore opportunities".
CLOSING: Last paragraph = specific question. Then "Best," on its own line. Do NOT add name/signature/email after "Best," — auto-appended.
BEFORE SENDING: Always confirm From and To addresses, then ask "Should I send this?"
CONFIDENTIALITY: Never mention other clients by name. Never fabricate case studies.`,

  comms: `You are the Comms Agent for DACP Construction — handling all communication including email correspondence, meeting summaries, and action items.

EMAIL CAPABILITIES:
- Draft bid response emails to GCs
- Follow up on outstanding RFQs
- Write professional construction correspondence
- Search email history

MEETING CAPABILITIES:
- Summarize past meetings
- Track action items and decisions
- Search across meeting transcripts
- Prepare agendas for upcoming meetings

You can create Google Docs and Sheets for email templates, contact lists, meeting notes, and outreach tracking.
When referencing meetings, cite specific dates, attendees, and action items.

═══ FILE & DATA LOOKUP RULES ═══
NEVER say "I don't have access" or ask the user for a file link/ID without trying first.
When you need data from a spreadsheet, document, or file:
1. ALWAYS use gws_drive_search to find the file first (try multiple search terms if the first fails)
2. If you find matching files, list them and ask "Is one of these the right file?"
3. Only after exhausting search should you ask the user for help
This applies to leads sheets, trackers, pricing docs, contact lists — anything the user references.
NEVER give up without searching. The user expects you to find files proactively.

═══ EMAIL STYLE RULES (MANDATORY) ═══
ALL outbound emails MUST follow these rules exactly:

GREETING: Always "Hey [First Name]," — never "Hi", "Hello", "Dear", or "Good morning".

TONE: Direct, confident, conversational. NOT corporate or stiff. Short paragraphs (2-4 sentences max). Use specific numbers over vague claims. Use dashes freely for asides.

NEVER SAY: "I'd be happy to discuss", "Thanks for your time", "Looking forward to hearing from you", "Please don't hesitate to reach out", "explore opportunities for collaboration", "Thank you for your inquiry", "I hope this finds you well", "I'd be happy to share more".

CLOSING STRUCTURE (strict order):
1. Body paragraphs
2. LAST PARAGRAPH = a specific question (Triple Aikido — bounce the ball back, make them engage)
3. "Best," on its own line
4. Do NOT add any name/signature/email after "Best," — the system auto-appends the signature

CRITICAL: "Best," must come AFTER the question, never before it. Do NOT write your own sign-off name or email address — the email system adds the signature automatically.

BEFORE SENDING: Always confirm with the user:
- From: [sender address]
- To: [recipient address]
Then ask "Should I send this?"

CONFIDENTIALITY: NEVER mention other clients by name. NEVER fabricate case studies. Use "we've worked with similar projects" if needed.`,
};

// Lead engine prompt additions (appended to sangha/hivemind when lead engine tools are available)
const LEAD_ENGINE_PROMPT_ADDON = `

You also have access to the Lead Engine — an automated lead discovery and outreach system. You can:
- Discover new leads using Perplexity search (discover_leads)
- View the current pipeline and filter by status (get_leads)
- Get pipeline statistics (get_lead_stats)
- Generate personalized outreach emails for enriched leads (generate_outreach)
- View outreach history and replies (get_outreach_log, get_reply_inbox)
- Check overdue follow-ups (get_followup_queue)
- Run a complete pipeline cycle: discover → enrich → outreach → follow-ups (run_full_cycle)
- Update lead status, notes, or priority (update_lead)
- View or modify discovery configuration — queries, schedule, sender, mode (get_discovery_config, update_discovery_config)
- Create a CRM pipeline Google Sheet and connect it to the dashboard (setup_crm_sheet) — only one sheet active at a time

When the user asks about leads, pipeline, outreach, or prospecting, use these tools. You can configure the entire discovery pipeline through chat — set search queries, enable nightly automation, change sender identity, etc. If the user asks to set up a pipeline sheet or CRM, use setup_crm_sheet.`;

const HUBSPOT_PROMPT_ADDON = `

You also have access to HubSpot CRM integration:
- search_hubspot_contacts: Search contacts by name, email, or company
- search_hubspot_companies: Search companies by name or domain
- search_hubspot_deals: Search the deal pipeline
- get_hubspot_pipeline: Get full pipeline summary (total deals, value by stage)
- create_hubspot_contact: Add a new contact to HubSpot

When the user asks about CRM data, contacts, companies, deals, pipeline status, or wants to add someone to the CRM, use these tools. Always search HubSpot before saying you don't have information about a contact or company.`;

const WEB_TOOLS_PROMPT_ADDON = `

You have web research and browsing capabilities:
- web_research: Perform deep AI-powered web research on any topic. Returns synthesized answers with citations. Use this for market research, competitive analysis, industry data, technical questions, company research, or anything requiring current information. You can call this MULTIPLE TIMES with different queries to build comprehensive understanding — for example, research a company's financials, then their competitors, then market trends.
- browse_url: Fetch a specific webpage and extract its text, title, and links. Use when you have a specific URL to read.

IMPORTANT: When given a research-heavy task, use web_research proactively and iteratively. Don't wait to be told — if answering well requires current data, search for it. Chain multiple research queries to build depth. Think like an analyst: what data do I need, what are the angles, what would make this answer comprehensive?`;

const LEGAL_TOOLS_PROMPT_ADDON = `

You can generate legal documents from templates:
- generate_legal_doc: Create NDAs (mutual or one-way) and Master Service Agreements
The document is automatically saved to Google Drive in a "Legal Documents" folder. Customize parties, dates, duration, governing state, and additional terms.`;

// ─── Database Operations ─────────────────────────────────────────────────────
// NOTE: All queries use db.prepare() at call time (not cached at module load)
// because `db` is a Proxy that resolves to the current tenant's DB via
// AsyncLocalStorage. Caching statements at load time would bind them to
// whichever tenant DB was active during import — causing FK violations
// when a different tenant's thread_id doesn't exist in that DB.

const SQL = {
  insertMessage: `INSERT INTO chat_messages (tenant_id, agent_id, user_id, role, content, metadata_json, thread_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  getHistory: `SELECT id, role, content, metadata_json, created_at FROM chat_messages WHERE tenant_id = ? AND agent_id = ? AND user_id = ? AND (thread_id = ? OR (thread_id IS NULL AND ? IS NULL)) ORDER BY created_at ASC LIMIT ?`,
  getRecentHistory: `SELECT id, role, content, metadata_json, created_at FROM chat_messages WHERE tenant_id = ? AND agent_id = ? AND user_id = ? AND (thread_id = ? OR (thread_id IS NULL AND ? IS NULL)) ORDER BY created_at DESC LIMIT ?`,
  getThreadHistory: `SELECT id, role, content, metadata_json, created_at, user_id FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?`,
  touchThread: `UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?`,
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Get conversation history for an agent + user, optionally scoped to a thread.
 */
export function getMessages(tenantId, agentId, userId, limit = 50, threadId = null) {
  return db.prepare(SQL.getHistory).all(tenantId, agentId, userId, threadId, threadId, limit);
}

/**
 * Get messages for a thread (any user — for team/pinned threads).
 */
export function getThreadMessages(threadId, limit = 200) {
  return db.prepare(SQL.getThreadHistory).all(threadId, limit);
}

/**
 * Save a message to the database.
 */
export function saveMessage(tenantId, agentId, userId, role, content, metadata = null, threadId = null) {
  const result = db.prepare(SQL.insertMessage).run(
    tenantId, agentId, userId, role, content,
    metadata ? JSON.stringify(metadata) : null,
    threadId
  );
  if (threadId) {
    try { db.prepare(SQL.touchThread).run(threadId); } catch (e) { /* ignore */ }
  }
  return result.lastInsertRowid;
}

/**
 * Get meeting-specific system prompt for a tenant's voice agent.
 * Returns the hivemind/primary agent's prompt adapted for real-time meetings.
 */
export function getMeetingPrompt(tenantId) {
  // Map tenant to their primary agent prompt
  const tenantAgentMap = {
    'default': 'sangha',
    'sangha': 'sangha',
    'dacp-construction-001': 'hivemind',
    'zhan-capital': 'zhan',
  };
  const agentId = tenantAgentMap[tenantId] || 'sangha';
  const basePrompt = SYSTEM_PROMPTS[agentId] || SYSTEM_PROMPTS.sangha;

  return `${basePrompt}

MEETING BEHAVIOR:
- You are participating in a live meeting as a voice assistant called Coppice
- You are ONLY activated when someone says "Coppice" or "hey Coppice" — you will only hear speech directed at you
- When first addressed, introduce yourself briefly: "Hey, I'm Coppice — the [company name] AI agent. What can I help with?"
- Keep responses to 1-2 sentences max — this is real-time conversation, not a lecture
- If someone gives you a task or action item, acknowledge it and confirm you'll handle it after the meeting
- Never say you were "cut off" or had technical issues
- No filler phrases, be direct and professional
- You cannot send emails or use tools during meetings — if asked, say you'll handle it after the meeting

CONVERSATION STYLE — TRIPLE AIKIDO:
- Don't monologue. Don't over-explain. Answer in ONE sentence, then ask a question back.
- Whoever asks questions controls the conversation. You should be asking more questions than answering.
- When someone asks you something, give a short direct answer then redirect: "What about that is most relevant to your situation?"
- Build understanding before offering solutions — ask about their pain points, what they've tried, what matters most.
- If they say "that sounds interesting" → ask "What about it stands out to you?"
- If they ask about cost/pricing → "Before I get into numbers, what does a good outcome look like from your side?"
- If they say "send me something" → "Happy to. What would be most helpful for your team?"
- Never defend or over-explain — reframe and bounce back with a question.
- Let them articulate what they want. Make them sell themselves on the solution.`;
}

/**
 * Send a message to Claude and get a response.
 * Saves both user message and assistant response to DB.
 */
// ─── Tool Router Helper ─────────────────────────────────────────────────────
// Centralised dispatch — used by both first-call and loop iterations.
const TOOL_CATEGORIES = {
  gws: ['gws_gmail_search', 'gws_gmail_read', 'gws_calendar_events', 'gws_drive_search', 'gws_sheets_read', 'gws_sheets_append', 'gws_workspace_command', 'gws_sheets_update', 'gws_docs_update', 'gws_drive_create'],
  emailSecurity: ['add_trusted_sender', 'remove_trusted_sender', 'list_trusted_senders'],
  email: ['send_email', 'list_emails', 'read_email'],
  calendar: ['create_meeting'],
  leadEngine: ['discover_leads', 'get_leads', 'get_lead_stats', 'generate_outreach', 'get_outreach_log', 'get_reply_inbox', 'get_followup_queue', 'run_full_cycle', 'update_lead', 'update_discovery_config', 'get_discovery_config', 'setup_crm_sheet'],
  knowledge: ['search_knowledge'],
  hubspot: ['search_hubspot_contacts', 'search_hubspot_companies', 'search_hubspot_deals', 'get_hubspot_pipeline', 'create_hubspot_contact'],
  mining: ['generate_mine_specs'],
  web: ['browse_url', 'web_research'],
  legal: ['generate_legal_doc'],
  document: ['generate_document'],
  dacp: ['lookup_pricing', 'get_bid_requests', 'get_estimates', 'create_estimate', 'get_jobs', 'get_dacp_stats', 'analyze_itb', 'draft_supplier_quotes', 'compare_contract', 'generate_proposal', 'run_bid_checks', 'generate_takeoff_template', 'generate_compliance_forms', 'generate_contract_redline', 'parse_supplier_quote', 'get_approval_draft', 'update_approval_draft'],
  scheduler: ['create_scheduled_task', 'list_scheduled_tasks', 'delete_scheduled_task'],
  context: ['update_entity_profile', 'pin_to_context'],
  taskProposal: ['propose_task'],
};

// ─── Safe Tools (read-only, safe to retry on failure) ────────────────────────
const SAFE_TOOLS = new Set([
  'search_knowledge', 'update_entity_profile', 'pin_to_context',
  'get_approval_draft',
  'get_leads', 'get_lead_stats', 'list_emails', 'read_email',
  'browse_url', 'web_research', 'get_outreach_log', 'get_reply_inbox', 'get_followup_queue', 'get_discovery_config',
  'list_trusted_senders', 'search_hubspot_contacts', 'search_hubspot_companies',
  'search_hubspot_deals', 'get_hubspot_pipeline', 'lookup_pricing', 'get_bid_requests',
  'get_estimates', 'get_jobs', 'get_dacp_stats', 'analyze_itb', 'compare_contract',
  'run_bid_checks', 'parse_supplier_quote',
  'gws_gmail_search', 'gws_gmail_read', 'gws_calendar_events', 'gws_drive_search', 'gws_sheets_read',
  'list_scheduled_tasks',
  'workspace_search_drive', 'workspace_read_file', 'workspace_export_pdf',
  'plan_content',
  'propose_task',
]);

// ─── Agentic Loop Constants ──────────────────────────────────────────────────
const TOOL_LOOP_TIMEOUT_MS = 300_000; // 5 minutes global timeout
const TOKEN_BUDGET_LIMIT = 200_000; // cumulative input + output token ceiling
const EXPANDED_MAX_TOKENS = 8192; // increased max_tokens after first tool round

/**
 * Execute a tool call with smart retry for safe (read-only) tools.
 * Action tools are never retried to avoid duplicate side effects.
 */
async function executeToolWithRetry(toolName, toolInput, tenantId) {
  let toolResult;
  let toolIsError = false;
  try {
    toolResult = await routeToolCall(toolName, toolInput, tenantId);
  } catch (toolError) {
    // Only retry SAFE tools (read-only), never retry action tools
    if (SAFE_TOOLS.has(toolName)) {
      try {
        await new Promise(r => setTimeout(r, 1000));
        toolResult = await routeToolCall(toolName, toolInput, tenantId);
      } catch (retryError) {
        console.warn(`[ToolRetry] ${toolName} failed on retry: ${retryError.message}`);
        toolResult = { error: retryError.message };
        toolIsError = true;
      }
    } else {
      toolResult = { error: toolError.message };
      toolIsError = true;
    }
  }
  return { toolResult, toolIsError };
}

// _toolContext is set per-request to provide threadId and onContextUpdate for context tools
let _toolContext = { threadId: null, onContextUpdate: null, agentId: null };

function setToolContext(threadId, onContextUpdate, agentId) {
  _toolContext = { threadId, onContextUpdate, agentId };
}

async function routeToolCall(toolName, toolInput, tenantId) {
  // MCP tool dispatch — dynamically loaded external tools
  if (toolName.startsWith('mcp__')) {
    const { mcpManager } = await import('./mcpClientService.js');
    return await mcpManager.callTool(tenantId, toolName, toolInput);
  }
  if (TOOL_CATEGORIES.context.includes(toolName)) return await callContextTool(toolName, toolInput, tenantId, _toolContext.threadId, _toolContext.onContextUpdate);
  if (toolName === 'execute_code') return await callCodeTool(toolInput, tenantId);
  if (TOOL_CATEGORIES.gws.includes(toolName)) return await callGwsTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.emailSecurity.includes(toolName)) return await callEmailSecurityTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.email.includes(toolName)) return await callEmailTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.calendar.includes(toolName)) return await callCalendarTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.leadEngine.includes(toolName)) return await callLeadEngineTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.knowledge.includes(toolName)) return await callKnowledgeTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.hubspot.includes(toolName)) return await callHubSpotTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.mining.includes(toolName)) return await callMiningTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.web.includes(toolName)) return await callWebTool(toolName, toolInput);
  if (TOOL_CATEGORIES.legal.includes(toolName)) return await callLegalTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.document.includes(toolName)) return await callDocumentTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.dacp.includes(toolName)) return await callDacpTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.scheduler.includes(toolName)) return await callSchedulerTool(toolName, toolInput, tenantId);
  if (TOOL_CATEGORIES.taskProposal.includes(toolName)) return await callTaskProposalTool(toolName, toolInput, tenantId);
  return await callWorkspaceTool(toolName, toolInput, tenantId);
}

function getAgentConfig(agentId) {
  try {
    const row = db.prepare('SELECT config_json FROM agents WHERE id = ?').get(agentId);
    if (row?.config_json) return JSON.parse(row.config_json);
  } catch {}
  return {};
}

function getMaxTurns(agentId) {
  const config = getAgentConfig(agentId);
  if (config.max_turns && Number.isInteger(config.max_turns) && config.max_turns > 0) {
    return Math.min(config.max_turns, 50); // hard cap at 50
  }
  return 25; // default: 25 turns
}

// ─── Extended Thinking ──────────────────────────────────────────────────────
// Detects complex tasks that benefit from extended thinking (planning, analysis,
// multi-step research). Returns budget_tokens for the thinking block.
const COMPLEX_PATTERNS = [
  /\b(research|analyze|compare|evaluate|investigate|deep.?dive|comprehensive|thorough|detailed|in.?depth)\b/i,
  /\b(write a report|build a|create a plan|design|architect|strategy|proposal|analysis)\b/i,
  /\b(why does|how does|what are the implications|trade.?offs|pros and cons)\b/i,
  /\b(review this|look into|figure out|break down|assess|audit)\b/i,
];

function shouldUseExtendedThinking(agentId, userContent, config) {
  // Disabled if explicitly turned off
  if (config.extended_thinking === false) return false;
  // Always on if explicitly enabled
  if (config.extended_thinking === true) return true;
  // Auto-detect: complex patterns or long messages
  if (userContent.length > 300) return true;
  return COMPLEX_PATTERNS.some(p => p.test(userContent));
}

function buildThinkingParam(agentId, userContent) {
  const config = getAgentConfig(agentId);
  if (!shouldUseExtendedThinking(agentId, userContent, config)) return {};
  const budget = config.thinking_budget || 10000; // default 10K tokens
  return {
    thinking: {
      type: 'enabled',
      budget_tokens: Math.min(budget, 32000), // hard cap 32K
    },
  };
}

export async function chat(tenantId, agentId, userId, userContent, threadId = null, options = {}) {
  const _runId = randomUUID().slice(0, 12);
  const _runStart = Date.now();
  const _toolsUsed = [];

  // Helper: record a completed run (fire-and-forget, never throws)
  function _recordRun({ output, model, route, inputTokens, outputTokens, status, errorMessage }) {
    try {
      insertAgentRun({
        runId: _runId, tenantId, agentId, userId, threadId,
        input: typeof userContent === 'string' ? userContent : JSON.stringify(userContent),
        output: output?.slice(0, 10000), // cap stored output at 10k chars
        model, route: route || 'api',
        inputTokens: inputTokens || 0, outputTokens: outputTokens || 0,
        toolsUsed: _toolsUsed.length > 0 ? _toolsUsed : null,
        durationMs: Date.now() - _runStart,
        status: status || 'completed', errorMessage,
      });
    } catch (e) {
      console.warn('[AgentRun] Failed to record run:', e.message);
    }
  }

  // Support multimodal content: userContent can be a string or an array of content blocks
  const isMultimodal = Array.isArray(userContent);
  const displayContent = isMultimodal
    ? userContent.filter(b => b.type === 'text').map(b => b.text).join('\n')
    : userContent;

  // 1. Save user message (text only — base64 images are too large for SQLite)
  const messageMetadata = isMultimodal ? {
    multimodal: true,
    files: userContent
      .filter(b => b.type === 'image')
      .map(b => ({ name: b._fileName || 'image', type: b.source?.media_type || 'image/unknown' })),
  } : null;
  saveMessage(tenantId, agentId, userId, 'user', displayContent, messageMetadata, threadId);

  // 2. Load conversation history (most recent N messages, in chronological order)
  const rows = db.prepare(SQL.getRecentHistory).all(tenantId, agentId, userId, threadId, threadId, MAX_HISTORY);
  const history = rows.reverse(); // reverse to chronological order

  // 3. Build messages array for Claude
  const messages = history.map(row => ({
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
  }));

  // For multimodal messages, replace the last message with full content blocks
  if (isMultimodal && messages.length > 0) {
    const apiContent = userContent.map(block => {
      if (block.type === 'image') {
        const { _fileName, ...rest } = block;
        return rest;
      }
      return block;
    });
    messages[messages.length - 1].content = apiContent;
  }

  // ─── Claude Code CLI route ─────────────────────────────────────────────
  // Routes complex queries through `claude -p` (Max subscription, flat rate)
  // instead of per-token API calls. Feature-flagged via CLAUDE_CLI_ENABLED=true.
  // Simple queries stay on the API (Haiku/Sonnet, sub-second, cheap).
  const cliAgents = ['sangha', 'hivemind', 'zhan', 'estimating', 'documents', 'email', 'workflow', 'comms'];
  const cliEnabled = process.env.CLAUDE_CLI_ENABLED === 'true';
  const agentConfig = getAgentConfig(agentId);
  const forceApi = agentConfig.force_api === true;
  const forceCli = agentConfig.force_cli === true;

  if (cliEnabled && cliAgents.includes(agentId) && !forceApi && (forceCli || isComplexQuery(userContent))) {
    try {
      const historyForContext = messages.slice(0, -1);
      const cliResult = await queryClaudeAgent({
        tenantId,
        agentId,
        message: userContent,
        history: historyForContext,
        maxTurns: agentConfig.max_turns,
      });

      saveMessage(tenantId, agentId, userId, 'assistant', cliResult.response, {
        model: 'claude-code-cli',
        duration_ms: cliResult.durationMs,
        timed_out: cliResult.timedOut || false,
        route: 'cli',
      }, threadId);

      const audioUrl = await generateAudioIfEnabled(cliResult.response);
      _recordRun({ output: cliResult.response, model: 'claude-code-cli', route: 'cli', status: cliResult.timedOut ? 'timeout' : 'completed' });
      return { response: cliResult.response, audio_url: audioUrl };
    } catch (error) {
      console.error(`[ClaudeAgent] CLI error (agent=${agentId}, tenant=${tenantId}):`, error.message);
      _recordRun({ output: null, model: 'claude-code-cli', route: 'cli', status: 'failed', errorMessage: error.message });
      // Fall through to API route on CLI failure
      console.log(`[ClaudeAgent] Falling back to API route`);
    }
  }
  // Legacy hivemind CLI route (kept for backward compat)
  else if (agentId === 'hivemind' && process.env.HIVEMIND_USE_CLI === 'true' && !cliEnabled) {
    try {
      const { queryHivemindCli } = await import('./hivemindCli.js');
      const historyForContext = messages.slice(0, -1);
      const cliResult = await queryHivemindCli(displayContent, historyForContext, tenantId);

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
  const knowledgeContext = buildKnowledgeContext(tenantId, displayContent);
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
  const emailAgents = ['sangha', 'hivemind', 'email', 'zhan', 'workflow', 'comms', 'estimating'];
  const emailAddon = emailAgents.includes(agentId) ? getEmailPromptAddon(tenantId) : '';
  // Email security tools — hivemind only
  const esAgents = ['sangha', 'hivemind', 'zhan'];
  const emailSecurityAddon = esAgents.includes(agentId) ? EMAIL_SECURITY_PROMPT_ADDON : '';
  // Document generation tools — all agents
  const docAgents = ['sangha', 'hivemind', 'zhan', 'documents', 'email', 'workflow', 'comms', 'estimating'];
  const documentAddon = docAgents.includes(agentId) ? DOCUMENT_TOOLS_PROMPT_ADDON : '';
  // DACP estimation tools
  const dacpPromptAgents = ['hivemind', 'estimating', 'workflow'];
  const dacpAddon = dacpPromptAgents.includes(agentId) ? DACP_TOOLS_PROMPT_ADDON : '';
  // Google Workspace CLI tools
  const gwsAgents = ['hivemind', 'sangha', 'zhan', 'workflow', 'comms', 'estimating'];
  const gwsAddon = gwsAgents.includes(agentId) ? GWS_TOOLS_PROMPT_ADDON : '';
  // Scheduler tools — hivemind, workflow, comms, zhan, sangha
  const schedulerAgents = ['hivemind', 'workflow', 'comms', 'zhan', 'sangha'];
  const schedulerAddon = schedulerAgents.includes(agentId) ? SCHEDULER_TOOLS_PROMPT_ADDON : '';
  const codeAddon = codeAgents.includes(agentId) ? CODE_EXECUTION_PROMPT_ADDON : '';
  const knAgents = ['sangha', 'hivemind', 'curtailment', 'pools', 'zhan', 'estimating', 'workflow'];
  const contextAddon = knAgents.includes(agentId) ? CONTEXT_PROMPT_ADDON : '';
  const FORMATTING_RULES = `

═══ FORMATTING RULES ═══
- NEVER use emojis in your responses. No checkmarks, no icons, no unicode symbols. Keep it clean text only.
- Use clean, minimal formatting. Short paragraphs, simple lists with dashes, no excessive headers.
- Be concise and direct. No filler phrases like "Great question!" or "Absolutely!".
- When presenting data, use clean tables or simple lists — no decorative formatting.`;

  // Help mode: add strict tenant isolation guard for the help chat widget
  const HELP_MODE_GUARD = options.helpMode ? `

CRITICAL — HELP ASSISTANT MODE:
You are the Coppice Assistant, a product support chatbot embedded in the dashboard.
- You MUST ONLY discuss this tenant's business, data, and tools. NEVER mention other companies, tenants, or people outside this organization.
- NEVER mention Sangha, Spencer, Mihir, Colin, Bitcoin mining, renewable energy, or any non-construction topics.
- NEVER mention Zhan Capital, Volt Charging, or any other Coppice tenant.
- NEVER mention the name "Teo" or any Coppice internal team member.
- If asked about contacting support, tell them to click "Send a message to admin" at the bottom of this chat.
- Keep answers helpful, concise, and focused on the product features available in their dashboard.
- You can help with: estimating, bid requests, pricing table, job tracking, field reports, document generation, and agent tools.` : '';

  // Inject sibling thread context for cross-thread awareness
  let siblingContext = '';
  if (threadId) {
    try {
      const siblings = getSiblingThreadSummaries(tenantId, agentId, threadId, userId, 5);
      if (siblings.length > 0) {
        siblingContext = '\n\n═══ CONTEXT FROM OTHER ACTIVE SESSIONS ═══\nYou are also active in other conversation threads with this user. Here is what is happening in those threads — use this context to stay informed but do not repeat or reference it unless relevant:\n';
        for (const s of siblings) {
          const age = Math.round((Date.now() - new Date(s.updated_at + 'Z').getTime()) / 60000);
          const ageLabel = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.round(age / 1440)}d ago`;
          siblingContext += `\n- [${s.title || 'Untitled'}] (${ageLabel}): ${s.summary}`;
        }
      }
    } catch (e) { /* thread_summaries table may not exist yet */ }
  }

  // Task proposal addon — tells agents when/how to use propose_task
  const taskProposalAddon = taskProposalAgents.includes(agentId) ? TASK_PROPOSAL_PROMPT_ADDON : '';

  let systemPrompt = basePrompt + FORMATTING_RULES + PROPRIETARY_GUARD + HELP_MODE_GUARD + leadEngineAddon + hubspotAddon + webAddon + legalAddon + emailAddon + emailSecurityAddon + documentAddon + dacpAddon + gwsAddon + schedulerAddon + codeAddon + contextAddon + taskProposalAddon + knowledgeContext + siblingContext;

  // Build tools list — include lead engine tools and knowledge tools for relevant agents
  const tools = [...WORKSPACE_TOOLS];
  if (leAgents.includes(agentId)) {
    tools.push(...LEAD_ENGINE_TOOLS);
  }
  // Knowledge tools — all primary agents (knAgents defined above)
  if (knAgents.includes(agentId)) {
    tools.push(...KNOWLEDGE_TOOLS);
  }
  // Context panel tools — all agents with knowledge tools
  if (knAgents.includes(agentId)) {
    tools.push(...CONTEXT_TOOLS);
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
  const dacpAgents = ['hivemind', 'estimating', 'workflow'];
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
  // Task proposal — allows agent to propose background tasks during chat
  const taskProposalAgents = ['hivemind', 'estimating', 'workflow', 'sangha', 'zhan'];
  if (taskProposalAgents.includes(agentId)) {
    tools.push(...TASK_PROPOSAL_TOOLS);
  }
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
  // Google Workspace CLI tools
  if (gwsAgents.includes(agentId)) {
    tools.push(...GWS_TOOLS);
  }
  // Scheduler tools — recurring task automation
  if (schedulerAgents.includes(agentId)) {
    tools.push(...SCHEDULER_TOOLS);
  }
  // Code execution — sandboxed Docker container
  if (codeAgents.includes(agentId)) {
    tools.push(...CODE_EXECUTION_TOOLS);
  }

  // MCP tools — dynamically loaded from tenant-configured external servers
  try {
    const { mcpManager } = await import('./mcpClientService.js');
    const mcpTools = await mcpManager.getToolsForTenant(tenantId);
    if (mcpTools.length > 0) {
      tools.push(...mcpTools);
      const mcpToolNames = mcpTools.map(t => t.name).join(', ');
      systemPrompt += `\n\n═══ MCP TOOLS ═══\nYou have access to external MCP tools: ${mcpToolNames}. Use them when the user's request matches their capabilities.`;
    }
  } catch (e) {
    // MCP not configured or connection failed — continue without MCP tools
  }

  // Set tool context for context panel tools (threadId needed for pin_to_context)
  setToolContext(threadId, null, agentId);

  // 5. Call Claude API
  if (!process.env.ANTHROPIC_API_KEY) {
    // No API key — return a helpful fallback
    const fallback = `I'm currently running in demo mode (no API key configured). To enable real AI responses, set ANTHROPIC_API_KEY in your backend .env file.`;
    saveMessage(tenantId, agentId, userId, 'assistant', fallback, null, threadId);
    return { response: fallback };
  }

  try {
    // Route to optimal model based on complexity
    const selectedModel = selectModel(agentId, displayContent, messages.length, true);

    // All agents get 4096 tokens to support agentic multi-step reasoning
    // Extended thinking gets 16384 to accommodate thinking + response
    const thinkingParams = buildThinkingParam(agentId, userContent);
    const useThinking = !!thinkingParams.thinking;
    const maxTokens = useThinking ? 16384 : 4096;

    const completion = await getAnthropic().messages.create({
      model: selectedModel,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
      tools,
      ...thinkingParams,
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
      // SAFE_TOOLS is defined at module scope above TOOL_CATEGORIES.

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
          draft_supplier_quotes: () => `Send quote requests to material suppliers for ${toolInput.project_name || 'project'}`,
          generate_proposal: () => `Generate proposal document for ${toolInput.project_name || 'project'}`,
          generate_takeoff_template: () => `Generate takeoff Excel template for ${toolInput.project_name || 'project'}`,
          generate_compliance_forms: () => `Generate compliance forms for ${toolInput.project_name || 'project'}`,
          generate_contract_redline: () => `Generate contract redline document for ${toolInput.project_name || 'project'}`,
          create_hubspot_contact: () => `Create HubSpot contact: ${toolInput.email || toolInput.name || 'contact'}`,
          add_trusted_sender: () => `Add trusted sender: ${toolInput.email}`,
          remove_trusted_sender: () => `Remove trusted sender: ${toolInput.email}`,
          workspace_create_doc: () => `Create document: "${toolInput.title || 'untitled'}"`,
          workspace_create_sheet: () => `Create spreadsheet: "${toolInput.title || 'untitled'}"`,
          setup_crm_sheet: () => 'Create CRM pipeline sheet and connect to dashboard',
          workspace_create_slides: () => `Create presentation: "${toolInput.title || 'untitled'}"`,
          gws_sheets_update: () => `Update spreadsheet cells: ${toolInput.range} in ${toolInput.spreadsheet_id}`,
          gws_docs_update: () => `${toolInput.mode === 'replace' ? 'Replace' : 'Append to'} document: ${toolInput.document_id}`,
          gws_drive_create: () => `Create new ${toolInput.type === 'sheet' ? 'spreadsheet' : 'document'}: "${toolInput.title || 'untitled'}"`,
          gws_sheets_append: () => `Append rows to spreadsheet: ${toolInput.range} in ${toolInput.spreadsheet_id}`,
          create_scheduled_task: () => `Create scheduled task: "${toolInput.title || 'untitled'}" (${toolInput.schedule})`,
          delete_scheduled_task: () => `Delete scheduled task: ${toolInput.task_id}`,
          execute_code: () => `Run ${toolInput.language} code:\n\`\`\`${toolInput.language}\n${toolInput.code?.slice(0, 200)}${toolInput.code?.length > 200 ? '...' : ''}\n\`\`\``,
        };
        const descFn = actionDescriptions[toolName];
        let actionDesc;
        if (descFn) {
          actionDesc = descFn();
        } else if (toolName.startsWith('mcp__')) {
          // MCP tool — extract server and tool name for a clearer description
          const mcpParts = toolName.split('__');
          actionDesc = `Execute MCP tool "${mcpParts.slice(2).join('__')}" on ${mcpParts[1]}`;
        } else {
          actionDesc = `Execute tool: ${toolName}`;
        }

        // Insert approval item
        const approvalResult = db.prepare(`
          INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status)
          VALUES (?, ?, ?, ?, 'tool_action', ?, 'pending')
        `).run(
          tenantId, agentId,
          actionDesc,
          `Agent wants to use "${toolName}" — awaiting your approval.`,
          JSON.stringify({ toolName, toolInput, toolUseId, agentId, tenantId, userId }),
        );
        const approvalId = approvalResult.lastInsertRowid;

        // Save assistant response explaining the pending action
        const copilotResponse = `I'd like to **${actionDesc.toLowerCase()}**, but I need your approval first.`;
        saveMessage(tenantId, agentId, userId, 'assistant', copilotResponse, {
          model: completion.model,
          input_tokens: completion.usage?.input_tokens,
          output_tokens: completion.usage?.output_tokens,
          stop_reason: 'copilot_approval',
          tool_proposed: toolName,
          tool_input: toolInput,
        }, threadId);

        return { response: copilotResponse, approval_pending: true, approval_id: Number(approvalId), tool_proposed: toolName, tool_input: toolInput, action_description: actionDesc };
      }

      if (agentMode === 'off') {
        const offResponse = `This agent is currently set to **Off** mode. Enable Copilot or Autonomous mode to allow tool execution.`;
        saveMessage(tenantId, agentId, userId, 'assistant', offResponse, null, threadId);
        return { response: offResponse };
      }
      // ─── End Copilot Interceptor ───────────────────────────────────────

      // Call the tool — route to appropriate handler (autonomous mode or safe tool)
      // Inject caller context for scheduler tools (needed to set task owner)
      if (TOOL_CATEGORIES.scheduler.includes(toolName)) {
        toolInput._userId = userId;
        toolInput._agentId = agentId;
      }
      const { toolResult, toolIsError } = await executeToolWithRetry(toolName, toolInput, tenantId);
      _toolsUsed.push(toolName);

      // ─── Agentic loop: keep calling tools until Claude produces text ───
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

      const maxTurns = getMaxTurns(agentId);
      const loopStartTime = Date.now();
      let currentResponse = await getAnthropic().messages.create({
        model: selectedModel,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: loopMessages,
        tools,
        ...thinkingParams,
      });
      totalInputTokens += currentResponse.usage?.input_tokens || 0;
      totalOutputTokens += currentResponse.usage?.output_tokens || 0;

      let iteration = 0;
      let timedOut = false;
      let tokenBudgetExceeded = false;

      while (currentResponse.stop_reason === 'tool_use' && iteration < maxTurns) {
        iteration++;

        // ─── Global timeout check ────────────────────────────────────────
        if (Date.now() - loopStartTime > TOOL_LOOP_TIMEOUT_MS) {
          console.warn(`[Chat] Agent ${agentId} hit global timeout (${TOOL_LOOP_TIMEOUT_MS}ms) at iteration ${iteration}`);
          timedOut = true;
          break;
        }

        // ─── Token budget check ──────────────────────────────────────────
        const cumulativeTokens = totalInputTokens + totalOutputTokens;
        if (cumulativeTokens > TOKEN_BUDGET_LIMIT) {
          console.warn(`[Chat] Agent ${agentId} exceeded token budget (${cumulativeTokens} > ${TOKEN_BUDGET_LIMIT}) at iteration ${iteration}`);
          tokenBudgetExceeded = true;
          break;
        }

        const nextToolBlock = currentResponse.content.find(block => block.type === 'tool_use');
        if (!nextToolBlock) break;

        const { id: nextToolUseId, name: nextToolName, input: nextToolInput } = nextToolBlock;

        // Copilot mode check for loop iterations too
        if (agentMode === 'copilot' && !SAFE_TOOLS.has(nextToolName)) {
          const actionDesc = `Execute tool: ${nextToolName}`;
          const loopApprovalResult = db.prepare(`
            INSERT INTO approval_items (tenant_id, agent_id, title, description, type, payload_json, status)
            VALUES (?, ?, ?, ?, 'tool_action', ?, 'pending')
          `).run(tenantId, agentId, actionDesc, `Agent wants to use "${nextToolName}" — awaiting your approval.`,
            JSON.stringify({ toolName: nextToolName, toolInput: nextToolInput, toolUseId: nextToolUseId, agentId, tenantId, userId }));
          const loopApprovalId = loopApprovalResult.lastInsertRowid;
          // Stop the loop — can't proceed without approval
          const pauseText = currentResponse.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
          const copilotPause = (pauseText ? pauseText + '\n\n' : '') + `I need your approval to **${actionDesc.toLowerCase()}** before I can continue.`;
          saveMessage(tenantId, agentId, userId, 'assistant', copilotPause, {
            model: currentResponse.model, input_tokens: totalInputTokens, output_tokens: totalOutputTokens,
            stop_reason: 'copilot_approval', tool_proposed: nextToolName,
          }, threadId);
          return { response: copilotPause, approval_pending: true, approval_id: Number(loopApprovalId), tool_proposed: nextToolName, tool_input: nextToolInput, action_description: actionDesc, all_tool_results: allToolResults };
        }

        // Inject caller context for scheduler tools (needed to set task owner)
        if (TOOL_CATEGORIES.scheduler.includes(nextToolName)) {
          nextToolInput._userId = userId;
          nextToolInput._agentId = agentId;
        }
        const { toolResult: nextToolResult, toolIsError: nextToolIsError } = await executeToolWithRetry(nextToolName, nextToolInput, tenantId);
        _toolsUsed.push(nextToolName);

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

        // Dynamic max_tokens: increase after first tool round for longer reasoning
        const loopMaxTokens = useThinking ? 16384 : EXPANDED_MAX_TOKENS;

        currentResponse = await getAnthropic().messages.create({
          model: selectedModel,
          max_tokens: loopMaxTokens,
          system: systemPrompt,
          messages: loopMessages,
          tools,
          ...thinkingParams,
        });
        totalInputTokens += currentResponse.usage?.input_tokens || 0;
        totalOutputTokens += currentResponse.usage?.output_tokens || 0;
      }

      if (iteration >= maxTurns) {
        console.warn(`[Chat] Agent ${agentId} hit max_turns limit (${maxTurns})`);
      }

      // If we hit timeout or token budget, ask Claude to wrap up
      if (timedOut || tokenBudgetExceeded) {
        const reason = timedOut ? 'time limit (5 minutes)' : 'token budget limit';
        const wrapUpMessages = [
          ...loopMessages,
          { role: 'assistant', content: currentResponse.content },
          {
            role: 'user',
            content: `[System: You have reached the ${reason} for this request. Please provide your best response with the information gathered so far. Do not make any more tool calls.]`,
          },
        ];
        currentResponse = await getAnthropic().messages.create({
          model: selectedModel,
          max_tokens: EXPANDED_MAX_TOKENS,
          system: systemPrompt,
          messages: wrapUpMessages,
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

      // Save thread summary for cross-thread awareness
      if (threadId) {
        try { saveThreadSummary(threadId, tenantId, agentId, userId, `User: "${userContent.slice(0, 100)}" → Agent: "${responseText.slice(0, 200)}"`); } catch (e) { /* ignore */ }
      }

      // Generate TTS audio for tool-use responses
      const audioUrl = await generateAudioIfEnabled(responseText);

      _recordRun({ output: responseText, model: currentResponse.model, route: 'api', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, status: timedOut ? 'timeout' : 'completed' });

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

    // Save thread summary for cross-thread awareness
    if (threadId) {
      try { saveThreadSummary(threadId, tenantId, agentId, userId, `User: "${userContent.slice(0, 100)}" → Agent: "${responseText.slice(0, 200)}"`); } catch (e) { /* ignore */ }
    }

    // Generate TTS audio
    const audioUrl = await generateAudioIfEnabled(responseText);

    _recordRun({ output: responseText, model: completion.model, route: 'api', inputTokens: completion.usage?.input_tokens, outputTokens: completion.usage?.output_tokens });

    return { response: responseText, audio_url: audioUrl };
  } catch (error) {
    console.error(`Chat error (agent=${agentId}):`, error.message);
    _recordRun({ output: null, model: null, route: 'api', status: 'failed', errorMessage: error.message });

    // Save error as system message for debugging
    saveMessage(tenantId, agentId, userId, 'system', `Error: ${error.message}`, null, threadId);

    throw error;
  }
}

/**
 * Streaming version of chat() — streams text tokens via onChunk callback.
 * Supports multi-step tool use: when Claude requests a tool, we execute it
 * and continue the conversation (streaming each follow-up response).
 *
 * Tool invocations are communicated to the frontend via inline XML markers
 * in the text stream: `<tool_name>` (opens spinner) and `</tool_name>` (closes it).
 * The frontend's formatContent() already parses these tags.
 *
 * @param {Function} onChunk - Called with each text chunk: onChunk(text)
 * @returns {Promise<Object>} Final result (same shape as chat())
 */
export async function chatStream(tenantId, agentId, userId, userContent, threadId = null, options = {}, onChunk) {
  const _runId = randomUUID().slice(0, 12);
  const _runStart = Date.now();
  const _toolsUsed = [];
  function _recordRun({ output, model, route, inputTokens, outputTokens, status, errorMessage }) {
    try {
      insertAgentRun({ runId: _runId, tenantId, agentId, userId, threadId, input: typeof userContent === 'string' ? userContent : JSON.stringify(userContent), output: output?.slice(0, 10000), model, route: route || 'api', inputTokens: inputTokens || 0, outputTokens: outputTokens || 0, toolsUsed: _toolsUsed.length > 0 ? _toolsUsed : null, durationMs: Date.now() - _runStart, status: status || 'completed', errorMessage });
    } catch (e) { console.warn('[AgentRun] Failed to record stream run:', e.message); }
  }

  // Support multimodal content
  const isMultimodal = Array.isArray(userContent);
  const displayContent = isMultimodal
    ? userContent.filter(b => b.type === 'text').map(b => b.text).join('\n')
    : userContent;

  // Save user message (text only — base64 too large for SQLite)
  // Skip persistence for help chat — ephemeral widget, no thread history needed
  const skipPersist = !!options.helpMode;
  const messageMetadata = isMultimodal ? {
    multimodal: true,
    files: userContent
      .filter(b => b.type === 'image')
      .map(b => ({ name: b._fileName || 'image', type: b.source?.media_type || 'image/unknown' })),
  } : null;
  if (!skipPersist) saveMessage(tenantId, agentId, userId, 'user', displayContent, messageMetadata, threadId);

  const rows = db.prepare(SQL.getRecentHistory).all(tenantId, agentId, userId, threadId, threadId, MAX_HISTORY);
  const history = rows.reverse();
  const messages = history.map(row => ({
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
  }));

  // For multimodal messages, replace the last message with full content blocks
  if (isMultimodal && messages.length > 0) {
    const apiContent = userContent.map(block => {
      if (block.type === 'image') {
        const { _fileName, ...rest } = block;
        return rest;
      }
      return block;
    });
    messages[messages.length - 1].content = apiContent;
  }

  // Build system prompt — must match chat() so agents have full context when streaming
  const basePrompt = SYSTEM_PROMPTS[agentId] || SYSTEM_PROMPTS.sangha;
  const knowledgeContext = buildKnowledgeContext(tenantId, displayContent);

  const FORMATTING_RULES = `\n\n═══ FORMATTING RULES ═══\n- NEVER use emojis in your responses. No checkmarks, no icons, no unicode symbols. Keep it clean text only.\n- Use clean, minimal formatting. Short paragraphs, simple lists with dashes, no excessive headers.\n- Be concise and direct. No filler phrases like "Great question!" or "Absolutely!".\n- When presenting data, use clean tables or simple lists — no decorative formatting.`;

  const HELP_MODE_GUARD = options.helpMode ? `\n\nCRITICAL — HELP ASSISTANT MODE:\nYou are the Coppice Assistant, a small help chatbot embedded in the bottom-right corner of the dashboard.\n- Keep ALL responses to 2-3 sentences MAX. This is a tiny chat widget, not a full conversation.\n- Give high-level overviews only. Never list out every feature — just summarize in plain language.\n- If the user asks what this platform does, say something like: "Coppice is an AI assistant for your construction business — it handles estimating, bidding, job tracking, emails, and documents. Ask me anything specific."\n- NEVER use bullet point lists longer than 3 items. Prefer short paragraphs.\n- You MUST ONLY discuss this tenant's business, data, and tools. NEVER mention other companies, tenants, or people outside this organization.\n- NEVER mention Sangha, Spencer, Mihir, Colin, Bitcoin mining, renewable energy, Zhan Capital, Volt Charging, Teo, or any Coppice internal team member.\n- If asked about contacting support, tell them to click "Send a message to admin" below.\n- You can help with: estimating, bid requests, pricing, job tracking, field reports, documents, and email.` : '';

  // Include same addons as chat() so streaming agents have full capability context
  const leAgents = ['sangha', 'hivemind', 'email', 'lead-engine', 'zhan'];
  const leadEngineAddon = leAgents.includes(agentId) ? LEAD_ENGINE_PROMPT_ADDON : '';
  const hsAgents = ['sangha', 'hivemind'];
  const hubspotAddon = (hsAgents.includes(agentId) && process.env.HUBSPOT_API_KEY) ? HUBSPOT_PROMPT_ADDON : '';
  const webAddon = WEB_TOOLS_PROMPT_ADDON;
  const legalAgents = ['sangha', 'hivemind', 'documents', 'zhan'];
  const legalAddon = legalAgents.includes(agentId) ? LEGAL_TOOLS_PROMPT_ADDON : '';
  const emailAgents = ['sangha', 'hivemind', 'email', 'zhan', 'workflow', 'comms', 'estimating'];
  const emailAddon = emailAgents.includes(agentId) ? getEmailPromptAddon(tenantId) : '';
  const esAgents = ['sangha', 'hivemind', 'zhan'];
  const emailSecurityAddon = esAgents.includes(agentId) ? EMAIL_SECURITY_PROMPT_ADDON : '';
  const docAgents = ['sangha', 'hivemind', 'zhan', 'documents', 'email', 'workflow', 'comms', 'estimating'];
  const documentAddon = docAgents.includes(agentId) ? DOCUMENT_TOOLS_PROMPT_ADDON : '';
  const dacpPromptAgents = ['hivemind', 'estimating', 'workflow'];
  const dacpAddon = dacpPromptAgents.includes(agentId) ? DACP_TOOLS_PROMPT_ADDON : '';
  const gwsAgents = ['hivemind', 'sangha', 'zhan', 'workflow', 'comms', 'estimating'];
  const gwsAddon = gwsAgents.includes(agentId) ? GWS_TOOLS_PROMPT_ADDON : '';
  const schedulerAgents = ['hivemind', 'workflow', 'comms', 'zhan', 'sangha'];
  const schedulerAddon = schedulerAgents.includes(agentId) ? SCHEDULER_TOOLS_PROMPT_ADDON : '';
  const codeAddon = codeAgents.includes(agentId) ? CODE_EXECUTION_PROMPT_ADDON : '';
  const knAgents = ['sangha', 'hivemind', 'curtailment', 'pools', 'zhan', 'estimating', 'workflow'];
  const contextAddon = knAgents.includes(agentId) ? CONTEXT_PROMPT_ADDON : '';

  // Inject sibling thread context for cross-thread awareness
  let siblingContext = '';
  if (threadId) {
    try {
      const siblings = getSiblingThreadSummaries(tenantId, agentId, threadId, userId, 5);
      if (siblings.length > 0) {
        siblingContext = '\n\n═══ CONTEXT FROM OTHER ACTIVE SESSIONS ═══\nYou are also active in other conversation threads with this user. Here is what is happening in those threads — use this context to stay informed but do not repeat or reference it unless relevant:\n';
        for (const s of siblings) {
          const age = Math.round((Date.now() - new Date(s.updated_at + 'Z').getTime()) / 60000);
          const ageLabel = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.round(age / 1440)}d ago`;
          siblingContext += `\n- [${s.title || 'Untitled'}] (${ageLabel}): ${s.summary}`;
        }
      }
    } catch (e) { /* thread_summaries table may not exist yet */ }
  }

  // Task proposal addon — tells agents when/how to use propose_task
  const taskProposalAddonStream = taskProposalAgentsStream.includes(agentId) ? TASK_PROPOSAL_PROMPT_ADDON : '';

  let systemPrompt = basePrompt + FORMATTING_RULES + PROPRIETARY_GUARD + HELP_MODE_GUARD + leadEngineAddon + hubspotAddon + webAddon + legalAddon + emailAddon + emailSecurityAddon + documentAddon + dacpAddon + gwsAddon + schedulerAddon + codeAddon + contextAddon + taskProposalAddonStream + knowledgeContext + siblingContext;

  // ─── Build tools list (must match chat()) ───────────────────────────────
  const tools = [...WORKSPACE_TOOLS];
  if (leAgents.includes(agentId)) tools.push(...LEAD_ENGINE_TOOLS);
  // knAgents already defined above for contextAddon
  if (knAgents.includes(agentId)) tools.push(...KNOWLEDGE_TOOLS);
  if (knAgents.includes(agentId)) tools.push(...CONTEXT_TOOLS);
  if (hsAgents.includes(agentId) && process.env.HUBSPOT_API_KEY) tools.push(...HUBSPOT_TOOLS);
  const miningAgents = ['sangha', 'curtailment'];
  if (miningAgents.includes(agentId)) tools.push(...MINING_TOOLS);
  const dacpAgents = ['hivemind', 'estimating', 'workflow'];
  if (dacpAgents.includes(agentId)) tools.push(...DACP_TOOLS);
  if (emailAgents.includes(agentId)) tools.push(...EMAIL_TOOLS);
  if (esAgents.includes(agentId)) tools.push(...EMAIL_SECURITY_TOOLS);
  tools.push(...WEB_TOOLS);
  const taskProposalAgentsStream = ['hivemind', 'estimating', 'workflow', 'sangha', 'zhan'];
  if (taskProposalAgentsStream.includes(agentId)) tools.push(...TASK_PROPOSAL_TOOLS);
  if (legalAgents.includes(agentId)) tools.push(...LEGAL_TOOLS);
  if (docAgents.includes(agentId)) tools.push(...DOCUMENT_TOOLS);
  const calendarAgents = ['hivemind', 'sangha', 'zhan'];
  if (calendarAgents.includes(agentId)) tools.push(...CALENDAR_TOOLS);
  if (gwsAgents.includes(agentId)) tools.push(...GWS_TOOLS);
  // Scheduler tools — recurring task automation
  if (schedulerAgents.includes(agentId)) tools.push(...SCHEDULER_TOOLS);
  if (codeAgents.includes(agentId)) tools.push(...CODE_EXECUTION_TOOLS);

  // MCP tools — dynamically loaded from tenant-configured external servers
  try {
    const { mcpManager } = await import('./mcpClientService.js');
    const mcpTools = await mcpManager.getToolsForTenant(tenantId);
    if (mcpTools.length > 0) {
      tools.push(...mcpTools);
      const mcpToolNames = mcpTools.map(t => t.name).join(', ');
      systemPrompt += `\n\n═══ MCP TOOLS ═══\nYou have access to external MCP tools: ${mcpToolNames}. Use them when the user's request matches their capabilities.`;
    }
  } catch (e) {
    // MCP not configured or connection failed — continue without MCP tools
  }

  // Set tool context for context panel tools — emits SSE context_update events
  setToolContext(threadId, (update) => {
    onChunk(JSON.stringify({ _type: 'context_update', ...update }));
  }, agentId);

  if (!process.env.ANTHROPIC_API_KEY) {
    const fallback = 'I\'m currently running in demo mode (no API key configured).';
    saveMessage(tenantId, agentId, userId, 'assistant', fallback, null, threadId);
    onChunk(fallback);
    return { response: fallback };
  }

  try {
    // Pass hasTools=true for agents that have tool addons so model routing doesn't downgrade to Haiku
    const hasToolAddons = emailAgents.includes(agentId) || docAgents.includes(agentId) || dacpPromptAgents.includes(agentId);
    const selectedModel = options.helpMode
      ? 'claude-haiku-4-5-20251001'
      : selectModel(agentId, displayContent, messages.length, hasToolAddons);

    let maxTokens = options.helpMode ? 1024 : 4096;

    // ─── Helper: run one streaming API call, collecting text + tool_use blocks ─
    async function streamOneRound(roundMessages, roundMaxTokens) {
      const stream = getAnthropic().messages.stream({
        model: selectedModel,
        max_tokens: roundMaxTokens || maxTokens,
        system: systemPrompt,
        messages: roundMessages,
        tools,
      });

      let roundText = '';

      stream.on('text', (text) => {
        roundText += text;
        onChunk(text);
      });

      const finalMessage = await stream.finalMessage();
      return { finalMessage, roundText };
    }

    // ─── First streaming round ──────────────────────────────────────────────
    let { finalMessage, roundText } = await streamOneRound(messages);
    let fullText = roundText;
    let totalInputTokens = finalMessage.usage?.input_tokens || 0;
    let totalOutputTokens = finalMessage.usage?.output_tokens || 0;

    // ─── Agentic tool loop ──────────────────────────────────────────────────
    // If the model wants to call a tool, execute it and continue streaming.
    // Loop up to maxTurns times (same limit as non-streaming chat()).
    if (finalMessage.stop_reason === 'tool_use') {
      const allToolResults = [];
      let loopMessages = [...messages, { role: 'assistant', content: finalMessage.content }];
      let lastToolName = null;
      let lastToolInput = null;
      let lastToolResult = null;
      let currentStopReason = finalMessage.stop_reason;
      let currentContent = finalMessage.content;
      const maxTurns = getMaxTurns(agentId);
      let iteration = 0;
      const loopStartTime = Date.now();
      let timedOut = false;
      let tokenBudgetExceeded = false;

      // TODO: Copilot mode approval in streaming is complex — the SSE connection
      // would need to pause while waiting for user approval via a separate HTTP call.
      // For now, streaming tool use executes tools freely (matching autonomous mode).
      // Non-streaming chat() already handles copilot approval correctly.

      while (currentStopReason === 'tool_use' && iteration < maxTurns) {
        iteration++;

        // ─── Global timeout check ────────────────────────────────────────
        if (Date.now() - loopStartTime > TOOL_LOOP_TIMEOUT_MS) {
          console.warn(`[ChatStream] Agent ${agentId} hit global timeout (${TOOL_LOOP_TIMEOUT_MS}ms) at iteration ${iteration}`);
          timedOut = true;
          break;
        }

        // ─── Token budget check ──────────────────────────────────────────
        const cumulativeTokens = totalInputTokens + totalOutputTokens;
        if (cumulativeTokens > TOKEN_BUDGET_LIMIT) {
          console.warn(`[ChatStream] Agent ${agentId} exceeded token budget (${cumulativeTokens} > ${TOKEN_BUDGET_LIMIT}) at iteration ${iteration}`);
          tokenBudgetExceeded = true;
          break;
        }

        // Find all tool_use blocks in this response (Claude can request multiple tools)
        const toolBlocks = currentContent.filter(block => block.type === 'tool_use');
        if (toolBlocks.length === 0) break;

        // ─── Progress event ──────────────────────────────────────────────
        const toolNames = toolBlocks.map(b => b.name);
        onChunk(JSON.stringify({ _type: 'progress', iteration, maxTurns, tools: toolNames }));

        // Build tool_result messages for all requested tools
        const toolResultContents = [];

        for (const toolBlock of toolBlocks) {
          const { id: toolUseId, name: toolName, input: toolInput } = toolBlock;

          // Send open tag to frontend — shows spinner widget
          onChunk(`\n<${toolName}>`);

          const { toolResult, toolIsError } = await executeToolWithRetry(toolName, toolInput, tenantId);
          _toolsUsed.push(toolName);

          // Send close tag to frontend — shows checkmark widget
          onChunk(`</${toolName}>\n`);

          allToolResults.push({ tool_used: toolName, tool_input: toolInput, tool_result: toolResult, is_error: toolIsError });
          lastToolName = toolName;
          lastToolInput = toolInput;
          lastToolResult = toolResult;

          // Emit task proposal as a special SSE event so frontend can render an inline card
          if (toolName === 'propose_task' && toolResult?._task_proposal) {
            onChunk(JSON.stringify({
              _type: 'task_proposal',
              assignment_id: toolResult.assignment_id,
              title: toolResult.title,
              description: toolResult.description,
              category: toolResult.category,
              priority: toolResult.priority,
              sources: toolResult.sources || [],
            }));
          }

          // Append the tool result to the tool_result content array
          toolResultContents.push({
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: JSON.stringify(toolResult),
            is_error: toolIsError,
          });
        }

        // Add tool results to conversation and stream next response
        loopMessages = [
          ...loopMessages,
          { role: 'user', content: toolResultContents },
        ];

        // Dynamic max_tokens: increase after first tool round for longer reasoning
        const loopMaxTokens = options.helpMode ? 1024 : EXPANDED_MAX_TOKENS;

        const nextRound = await streamOneRound(loopMessages, loopMaxTokens);
        fullText += nextRound.roundText;
        totalInputTokens += nextRound.finalMessage.usage?.input_tokens || 0;
        totalOutputTokens += nextRound.finalMessage.usage?.output_tokens || 0;

        currentStopReason = nextRound.finalMessage.stop_reason;
        currentContent = nextRound.finalMessage.content;

        // Append assistant content for next iteration's context
        loopMessages = [...loopMessages, { role: 'assistant', content: nextRound.finalMessage.content }];
      }

      if (iteration >= maxTurns) {
        console.warn(`[ChatStream] Agent ${agentId} hit max_turns limit (${maxTurns})`);
      }

      // If we hit timeout or token budget, stream a wrap-up response
      if (timedOut || tokenBudgetExceeded) {
        const reason = timedOut ? 'time limit (5 minutes)' : 'token budget limit';
        const wrapUpMessages = [
          ...loopMessages,
          {
            role: 'user',
            content: `[System: You have reached the ${reason} for this request. Please provide your best response with the information gathered so far. Do not make any more tool calls.]`,
          },
        ];
        const wrapUpRound = await streamOneRound(wrapUpMessages, EXPANDED_MAX_TOKENS);
        fullText += wrapUpRound.roundText;
        totalInputTokens += wrapUpRound.finalMessage.usage?.input_tokens || 0;
        totalOutputTokens += wrapUpRound.finalMessage.usage?.output_tokens || 0;
      }

      // If no text was streamed across all rounds (rare), send a fallback
      if (!fullText.trim()) {
        const fallback = 'I wasn\'t able to generate a response. Please try rephrasing your question.';
        onChunk(fallback);
        fullText = fallback;
      }

      // Save assistant response with tool metadata (matches chat() save format)
      saveMessage(tenantId, agentId, userId, 'assistant', fullText, {
        model: selectedModel,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        stop_reason: currentStopReason,
        tool_used: lastToolName,
        tool_input: lastToolInput,
        tool_result: lastToolResult,
        streamed: true,
      }, threadId);

      // Save thread summary for cross-thread awareness
      if (threadId) {
        try { saveThreadSummary(threadId, tenantId, agentId, userId, `User: "${userContent.slice(0, 100)}" → Agent: "${fullText.slice(0, 200)}"`); } catch (e) { /* ignore */ }
      }

      _recordRun({ output: fullText, model: selectedModel, route: 'api', inputTokens: totalInputTokens, outputTokens: totalOutputTokens, status: timedOut ? 'timeout' : 'completed' });

      return {
        response: fullText,
        tool_used: lastToolName,
        tool_input: lastToolInput,
        tool_result: lastToolResult,
        all_tool_results: allToolResults,
      };
    }

    // ─── No tool use — standard text response ─────────────────────────────
    // If model produced no text (rare), send a fallback so the frontend isn't empty
    if (!fullText.trim()) {
      const fallback = 'I wasn\'t able to generate a response. Please try rephrasing your question.';
      onChunk(fallback);
      fullText = fallback;
    }

    if (!skipPersist) {
      saveMessage(tenantId, agentId, userId, 'assistant', fullText, {
        model: finalMessage.model,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        stop_reason: finalMessage.stop_reason,
        streamed: true,
      }, threadId);

      // Save thread summary for cross-thread awareness
      if (threadId) {
        try { saveThreadSummary(threadId, tenantId, agentId, userId, `User: "${userContent.slice(0, 100)}" → Agent: "${fullText.slice(0, 200)}"`); } catch (e) { /* ignore */ }
      }
    }

    _recordRun({ output: fullText, model: finalMessage.model, route: 'api', inputTokens: totalInputTokens, outputTokens: totalOutputTokens });

    return { response: fullText };
  } catch (error) {
    console.error(`ChatStream error (agent=${agentId}, tenant=${tenantId}):`, error.message, error.stack?.split('\n').slice(0, 3).join(' | '));
    _recordRun({ output: null, model: null, route: 'api', status: 'failed', errorMessage: error.message });
    if (!skipPersist) saveMessage(tenantId, agentId, userId, 'system', `Error: ${error.message}`, null, threadId);
    throw error;
  }
}

// ─── Exports for Agent SDK Service ───────────────────────────────────────────
// These are used by agentSdkService.js to bridge existing tools as MCP tools.
export {
  WORKSPACE_TOOLS, LEAD_ENGINE_TOOLS, HUBSPOT_TOOLS, EMAIL_SECURITY_TOOLS,
  KNOWLEDGE_TOOLS, WEB_TOOLS, LEGAL_TOOLS, DOCUMENT_TOOLS, SCHEDULER_TOOLS,
  CALENDAR_TOOLS, DACP_TOOLS, MINING_TOOLS, GWS_TOOLS, EMAIL_TOOLS,
  CODE_EXECUTION_TOOLS, SYSTEM_PROMPTS, PROPRIETARY_GUARD,
  LEAD_ENGINE_PROMPT_ADDON, HUBSPOT_PROMPT_ADDON, WEB_TOOLS_PROMPT_ADDON,
  LEGAL_TOOLS_PROMPT_ADDON, EMAIL_SECURITY_PROMPT_ADDON, DOCUMENT_TOOLS_PROMPT_ADDON,
  DACP_TOOLS_PROMPT_ADDON, GWS_TOOLS_PROMPT_ADDON, SCHEDULER_TOOLS_PROMPT_ADDON,
  CODE_EXECUTION_PROMPT_ADDON, routeToolCall, buildKnowledgeContext,
  getEmailPromptAddon,
};
