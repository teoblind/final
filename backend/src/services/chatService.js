/**
 * Chat Service — Claude API backend for agent conversations
 *
 * Each agent gets a system prompt defining its role and knowledge.
 * Messages are persisted to SQLite and sent as conversation history to Claude.
 */

import Anthropic from '@anthropic-ai/sdk';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const db = new Database(join(__dirname, '../../data/cache.db'));

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

    // Create the doc in Google Drive via workspace tools
    try {
      const wsResult = await callWorkspaceTool('workspace_create_doc', {
        title: doc.title,
        content: doc.content,
        folder: 'Legal Documents',
      }, tenantId);
      return { ...doc, google_doc: wsResult };
    } catch (wsErr) {
      // If workspace agent is unavailable, still return the content
      return { ...doc, google_doc_error: wsErr.message };
    }
  }
  throw new Error(`Unknown legal tool: ${toolName}`);
}

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

const SYSTEM_PROMPTS = {
  // DACP Construction agents
  hivemind: `You are the DACP Agent, an AI assistant for DACP Construction — a concrete subcontractor based in Houston, Texas. You coordinate across all departments: estimating, field operations, documents, meetings, and email.

You can help with:
- Routing tasks to the right sub-agent (estimating, documents, meetings, email)
- Answering questions about active jobs, bids, and field reports
- Looking up pricing, job history, and company data
- General project management and business questions

You have access to Google Workspace tools — you can create Docs, Sheets, and Slides, search Drive, and add comments to files. You can generate full branded presentations with custom styling — just provide the topic and context.

Keep responses concise and professional. Use construction industry terminology naturally. When referencing numbers, be specific. If you don't have the data to answer something, say so clearly.`,

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

  sangha: `You are the Sangha Agent, the AI assistant for Sangha Holdings — a Bitcoin mining operator with 8 years of operational experience. You coordinate across all departments: operations, energy markets, pool routing, insurance, and LP relations.

You can help with:
- Fleet operations monitoring (hashrate, uptime, efficiency)
- ERCOT energy market analysis (LMP pricing, curtailment decisions)
- Mining pool optimization and hashrate allocation
- Financial modeling and LP reporting
- Insurance and risk management (revenue floor swaps)
- IPP mine specification analysis — use the generate_mine_specs tool when someone asks about behind-the-meter mining economics, IPP evaluation, or mine specs for a given facility. Provide capacity (MW) at minimum. The tool returns fleet sizing, revenue projections (bull/base/bear hashprice scenarios), infrastructure requirements, and an Excel report.
- Answering questions about meetings, action items, people, companies, and deal status

You can manage email outreach through the Lead Engine — drafting personalized emails, tracking outreach campaigns, monitoring reply rates, and managing follow-ups. Emails are sent from agent@sangha.coppice.ai on behalf of the team.

You have access to Google Workspace tools — you can create Docs, Sheets, and Slides, search Drive, and add comments to files. You can generate full branded presentations with custom styling — just provide the topic and context.

You also have a search_knowledge tool — use it to look up meeting notes, action items, entity profiles, and documents when the user asks about past discussions, people, companies, deal status, or tasks. Always search before saying you don't have information.

Use Bitcoin mining and energy market terminology naturally. Be precise with numbers — hashrate in PH/s, energy in MW, prices in $/MWh. When referencing meeting data, cite specific dates, numbers, and names.

RECENT MEETING CONTEXT:
The most recent Sangha weekly operations call (March 9, 2026) covered:
- Land expansion: negotiating with Hanwha for 50 acres at Oberon, proposed easement consent trade
- Strategic pivot: Oberon shifting from mining to powered land play for AI developers, backed by Marathon Capital
- Fundraise: $250K committed of $4M target, Minneapolis meetings this week, Colin preparing investor model
- Equipment: Auradyne ASIC price reduced to $4,500/unit (245 units, ~$2M), Excalibur loan at $39K/month
- Operations: ambient heat causing mining downtime, March revenue forecasts revised downward
- Blockers: Fusion deal in legal review, blocking hard money loan; Bit Deer non-committal on hosting

When Spencer or team members ask about action items, status of deals, or operational issues, reference this meeting data. Be specific with numbers and names.`,

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
  const leAgents = ['sangha', 'hivemind', 'email', 'lead-engine'];
  const leadEngineAddon = leAgents.includes(agentId) ? LEAD_ENGINE_PROMPT_ADDON : '';
  // HubSpot tools for Sangha agents only (when API key is configured)
  const hsAgents = ['sangha', 'hivemind'];
  const hubspotAddon = (hsAgents.includes(agentId) && process.env.HUBSPOT_API_KEY) ? HUBSPOT_PROMPT_ADDON : '';
  // Web browsing — available to all agents
  const webAddon = WEB_TOOLS_PROMPT_ADDON;
  // Legal tools for relevant agents
  const legalAgents = ['sangha', 'hivemind', 'documents'];
  const legalAddon = legalAgents.includes(agentId) ? LEGAL_TOOLS_PROMPT_ADDON : '';
  const systemPrompt = basePrompt + leadEngineAddon + hubspotAddon + webAddon + legalAddon + knowledgeContext;

  // Build tools list — include lead engine tools and knowledge tools for relevant agents
  const tools = [...WORKSPACE_TOOLS];
  if (leAgents.includes(agentId)) {
    tools.push(...LEAD_ENGINE_TOOLS);
  }
  // Knowledge tools for Sangha agents
  const knAgents = ['sangha', 'curtailment', 'pools'];
  if (knAgents.includes(agentId)) {
    tools.push(...KNOWLEDGE_TOOLS);
  }
  // HubSpot tools for Sangha agents (only when key is configured)
  if (hsAgents.includes(agentId) && process.env.HUBSPOT_API_KEY) {
    tools.push(...HUBSPOT_TOOLS);
  }
  // Mining/IPP tools for Sangha agents
  const miningAgents = ['sangha', 'curtailment'];
  if (miningAgents.includes(agentId)) {
    tools.push(...MINING_TOOLS);
  }
  // Web browsing — available to all agents
  tools.push(...WEB_TOOLS);
  // Legal document tools
  if (legalAgents.includes(agentId)) {
    tools.push(...LEGAL_TOOLS);
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

      // Call the tool — route to appropriate handler
      let toolResult;
      let toolIsError = false;
      const leadEngineToolNames = ['discover_leads', 'get_leads', 'get_lead_stats', 'generate_outreach', 'get_outreach_log', 'get_reply_inbox', 'get_followup_queue'];
      const knowledgeToolNames = ['search_knowledge'];
      const hubspotToolNames = ['search_hubspot_contacts', 'search_hubspot_companies', 'search_hubspot_deals', 'get_hubspot_pipeline', 'create_hubspot_contact'];
      const miningToolNames = ['generate_mine_specs'];
      const webToolNames = ['browse_url'];
      const legalToolNames = ['generate_legal_doc'];
      try {
        if (leadEngineToolNames.includes(toolName)) {
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
        } else {
          toolResult = await callWorkspaceTool(toolName, toolInput, tenantId);
        }
      } catch (toolError) {
        toolResult = { error: toolError.message };
        toolIsError = true;
      }

      // Send tool result back to Claude for a final response
      const followUpMessages = [
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

      const followUp = await getAnthropic().messages.create({
        model: MODEL,
        max_tokens: 2048,
        system: systemPrompt,
        messages: followUpMessages,
        tools: WORKSPACE_TOOLS,
      });

      const responseText = followUp.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      // Save assistant response with tool metadata
      saveMessage(tenantId, agentId, userId, 'assistant', responseText, {
        model: followUp.model,
        input_tokens: (completion.usage?.input_tokens || 0) + (followUp.usage?.input_tokens || 0),
        output_tokens: (completion.usage?.output_tokens || 0) + (followUp.usage?.output_tokens || 0),
        stop_reason: followUp.stop_reason,
        tool_used: toolName,
        tool_input: toolInput,
        tool_result: toolResult,
      }, threadId);

      // Generate TTS audio for tool-use responses
      const audioUrl = await generateAudioIfEnabled(responseText);

      return {
        response: responseText,
        audio_url: audioUrl,
        tool_used: toolName,
        tool_input: toolInput,
        tool_result: toolResult,
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
