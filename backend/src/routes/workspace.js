/**
 * Workspace Agent Proxy Routes
 *
 * Proxies requests to the Python FastAPI workspace agent service
 * running at localhost:3010. Forwards tenant context and auth headers.
 */
import express from 'express';
import { authenticate } from '../middleware/auth.js';
import { SANGHA_TENANT_ID } from '../cache/database.js';

const router = express.Router();
router.use(authenticate);

const WORKSPACE_URL = process.env.WORKSPACE_AGENT_URL || 'http://localhost:3010';
const INTERNAL_SECRET = process.env.WORKSPACE_INTERNAL_SECRET || 'dev-secret';

/**
 * Build common headers for requests to the Python workspace service.
 */
function buildHeaders(tenantId) {
  return {
    'Content-Type': 'application/json',
    'X-Tenant-Id': tenantId,
    'X-Internal-Secret': INTERNAL_SECRET,
  };
}

/**
 * Resolve the tenant ID from the request (set by upstream middleware).
 */
function getTenantId(req) {
  return req.resolvedTenant?.id || SANGHA_TENANT_ID;
}

/**
 * Proxy a fetch call to the workspace service with standardised error handling.
 * Returns the parsed JSON response or throws.
 */
async function proxyRequest(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    // Network-level failure - service is unreachable
    const error = new Error('Workspace agent is unavailable');
    error.status = 503;
    error.detail = err.message;
    throw error;
  }

  const contentType = response.headers.get('content-type') || '';
  let body;
  if (contentType.includes('application/json')) {
    body = await response.json();
  } else {
    body = await response.text();
  }

  if (!response.ok) {
    const error = new Error(
      typeof body === 'object' ? (body.detail || body.error || JSON.stringify(body)) : body
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

// ─── Tool Proxy ──────────────────────────────────────────────────────────────

/** POST /tools/:toolName - Proxy any tool call to the Python workspace agent */
router.post('/tools/:toolName', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { toolName } = req.params;
    const result = await proxyRequest(`${WORKSPACE_URL}/tools/${encodeURIComponent(toolName)}`, {
      method: 'POST',
      headers: buildHeaders(tenantId),
      body: JSON.stringify(req.body),
    });
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    console.error(`Workspace tool proxy error (${req.params.toolName}):`, error.message);
    res.status(status).json({
      error: error.message,
      ...(error.body && typeof error.body === 'object' ? { detail: error.body } : {}),
    });
  }
});

// ─── Templates ───────────────────────────────────────────────────────────────

/** GET /templates - List available workspace templates */
router.get('/templates', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const result = await proxyRequest(
      `${WORKSPACE_URL}/templates?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'GET', headers: buildHeaders(tenantId) },
    );
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    console.error('Workspace templates list error:', error.message);
    res.status(status).json({ error: error.message });
  }
});

/** GET /templates/:templateId - Get a specific template */
router.get('/templates/:templateId', async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    const { templateId } = req.params;
    const result = await proxyRequest(
      `${WORKSPACE_URL}/templates/${encodeURIComponent(templateId)}?tenant_id=${encodeURIComponent(tenantId)}`,
      { method: 'GET', headers: buildHeaders(tenantId) },
    );
    res.json(result);
  } catch (error) {
    const status = error.status || 500;
    console.error(`Workspace template error (${req.params.templateId}):`, error.message);
    res.status(status).json({ error: error.message });
  }
});

// ─── Health ──────────────────────────────────────────────────────────────────

/** GET /health - Health check for the workspace agent service */
router.get('/health', async (req, res) => {
  try {
    const result = await proxyRequest(`${WORKSPACE_URL}/health`, {
      method: 'GET',
      headers: buildHeaders(getTenantId(req)),
    });
    res.json(result);
  } catch (error) {
    const status = error.status || 503;
    console.error('Workspace health check error:', error.message);
    res.status(status).json({
      error: error.message,
      status: 'unavailable',
    });
  }
});

// ─── Files ───────────────────────────────────────────────────────────────────

/** GET /files - List recent files from the workspace (via search with generic query) */
router.get('/files', async (req, res) => {
  const tenantId = getTenantId(req);

  // Only DACP tenant gets construction files
  if (tenantId === 'dacp-construction-001') {
    res.json({
      files: [
        { name: 'DACP_Estimate_BishopArts_MixedUse.xlsx', type: 'sheet', folder: 'Estimates', owner: 'Estimating Bot', modified: 'Mar 9, 2026', agent: true, url: '/files/estimates/DACP_Estimate_BishopArts_MixedUse.xlsx' },
        { name: 'DACP_Estimate_I35_RetainingWalls.xlsx', type: 'sheet', folder: 'Estimates', owner: 'Estimating Bot', modified: 'Mar 8, 2026', agent: true, url: '/files/estimates/DACP_Estimate_I35_RetainingWalls.xlsx' },
        { name: 'DACP_Estimate_MemorialHermann_Ph2.xlsx', type: 'sheet', folder: 'Estimates', owner: 'Estimating Bot', modified: 'Mar 6, 2026', agent: true, url: '/files/estimates/DACP_Estimate_MemorialHermann_Ph2.xlsx' },
        { name: 'DACP_Estimate_SamsungFab_Revised.xlsx', type: 'sheet', folder: 'Estimates', owner: 'Estimating Bot', modified: 'Mar 6, 2026', agent: true, url: '/files/estimates/DACP_Estimate_SamsungFab_Revised.xlsx' },
        { name: 'DACP_Estimate_McKinneyTC_Draft.xlsx', type: 'sheet', folder: 'Estimates', owner: 'Estimating Bot', modified: 'Mar 8, 2026', agent: true, url: '/files/estimates/DACP_Estimate_McKinneyTC_Draft.xlsx' },
        { name: 'Turner_CoordinationCall_Mar6.pdf', type: 'pdf', folder: 'Meeting Notes', owner: 'Meeting Bot', modified: 'Mar 6, 2026', agent: true, url: '/files/meetings/Turner_CoordinationCall_Mar6.pdf' },
        { name: 'WeeklyStandup_Mar5.pdf', type: 'pdf', folder: 'Meeting Notes', owner: 'Meeting Bot', modified: 'Mar 5, 2026', agent: true, url: '/files/meetings/WeeklyStandup_Mar5.pdf' },
        { name: 'DPR_SamsungFab_ScopeReview_Mar3.pdf', type: 'pdf', folder: 'Meeting Notes', owner: 'Meeting Bot', modified: 'Mar 3, 2026', agent: true, url: '/files/meetings/DPR_SamsungFab_ScopeReview_Mar3.pdf' },
        { name: 'DACP_DailyOps_Mar8.pdf', type: 'pdf', folder: 'Daily Reports', owner: 'Reporting Engine', modified: 'Mar 8, 2026', agent: true, url: '/files/reports/DACP_DailyOps_Mar8.pdf' },
        { name: 'DACP_DailyOps_Mar7.pdf', type: 'pdf', folder: 'Daily Reports', owner: 'Reporting Engine', modified: 'Mar 7, 2026', agent: true, url: '/files/reports/DACP_DailyOps_Mar7.pdf' },
        { name: 'DACP_DailyOps_Mar6.pdf', type: 'pdf', folder: 'Daily Reports', owner: 'Reporting Engine', modified: 'Mar 6, 2026', agent: true, url: '/files/reports/DACP_DailyOps_Mar6.pdf' },
        { name: 'DACP_DailyOps_Mar5.pdf', type: 'pdf', folder: 'Daily Reports', owner: 'Reporting Engine', modified: 'Mar 5, 2026', agent: true, url: '/files/reports/DACP_DailyOps_Mar5.pdf' },
        { name: 'Westpark_DailyLog_Mar7.pdf', type: 'pdf', folder: 'Field Reports', owner: 'Carlos Mendez', modified: 'Mar 7, 2026', agent: false, url: '/files/field/Westpark_DailyLog_Mar7.pdf' },
        { name: 'FriscoStation_RockFlag_Mar7.pdf', type: 'pdf', folder: 'Field Reports', owner: 'Carlos Mendez', modified: 'Mar 7, 2026', agent: false, url: '/files/field/FriscoStation_RockFlag_Mar7.pdf' },
        { name: 'Turner_MemorialHermann_Ph2_Bid.pdf', type: 'pdf', folder: 'GC Correspondence', owner: 'Email Agent', modified: 'Mar 6, 2026', agent: true, url: '/files/gc-correspondence/Turner_MemorialHermann_Ph2_Bid.pdf' },
        { name: 'HenselPhelps_I35_RFQ.pdf', type: 'pdf', folder: 'GC Correspondence', owner: 'Email Agent', modified: 'Mar 8, 2026', agent: true, url: '/files/gc-correspondence/HenselPhelps_I35_RFQ.pdf' },
        { name: 'DPR_SamsungFab_RevisedScope.pdf', type: 'pdf', folder: 'GC Correspondence', owner: 'Email Agent', modified: 'Mar 6, 2026', agent: true, url: '/files/gc-correspondence/DPR_SamsungFab_RevisedScope.pdf' },
        { name: 'DACP_MasterPricingTable_2026.xlsx', type: 'sheet', folder: 'Pricing', owner: 'David Castillo', modified: 'Mar 1, 2026', agent: false, url: '/files/pricing/DACP_MasterPricingTable_2026.xlsx' },
        { name: 'TXI_PriceLetter_Mar2026.pdf', type: 'pdf', folder: 'Pricing', owner: 'Marcel Pineda', modified: 'Mar 1, 2026', agent: false, url: '/files/pricing/TXI_PriceLetter_Mar2026.pdf' },
      ]
    });
  } else {
    // Fall back to workspace agent proxy for non-DACP tenants
    try {
      const query = req.query.q || '';
      const limit = parseInt(req.query.limit) || 20;

      const result = await proxyRequest(`${WORKSPACE_URL}/tools/workspace_search_drive`, {
        method: 'POST',
        headers: buildHeaders(tenantId),
        body: JSON.stringify({
          query,
          limit,
          tenant_id: tenantId,
        }),
      });
      res.json(result);
    } catch (error) {
      const status = error.status || 500;
      console.error('Workspace files list error:', error.message);
      res.status(status).json({ error: error.message });
    }
  }
});

export default router;
