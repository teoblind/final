/**
 * DACP Construction — Estimating Routes
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { writeFileSync, mkdirSync, existsSync, readFileSync, createReadStream } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { authenticate } from '../middleware/auth.js';
import {
  getDacpBidRequests,
  getDacpBidRequest,
  updateDacpBidRequest,
  getDacpEstimates,
  getDacpEstimate,
  updateDacpEstimate,
  getDacpJobs,
  getDacpJob,
  getDacpFieldReports,
  createDacpFieldReport,
  getDacpPricing,
  createDacpPricing,
  updateDacpPricing,
  deleteDacpPricing,
  getDacpStats,
  getDacpBidDocuments,
  createDacpBidDocument,
  getDacpPlanAnalyses,
  createDacpPlanAnalysis,
  updateDacpPlanAnalysis,
  getKeyVaultValue,
  upsertKeyVaultEntry,
  getTenantEmailConfig,
  getAgentAssignments,
  getAgentAssignment,
  updateAgentAssignment,
  getUsersByTenant,
  createLeadsSheetShare,
  getLeadsSheetShares,
  updateLeadsShareStatus,
  getLeadsShareById,
} from '../cache/database.js';
import {
  generateEstimate,
  processInboundRequest,
  draftClarificationEmail,
  draftQuoteEmail,
} from '../services/estimateBot.js';
import { google } from 'googleapis';
import { generateReport } from '../services/documentService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const uploadDir = join(__dirname, '../../data/uploads');
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = express.Router();
router.use(authenticate);

// ─── Inbox (Bid Requests) ───────────────────────────────────────────────────

router.get('/inbox', (req, res) => {
  try {
    const status = req.query.status || null;
    const bids = getDacpBidRequests(req.user.tenantId, status);
    const parsed = bids.map(b => ({
      ...b,
      attachments: b.attachments_json ? JSON.parse(b.attachments_json) : [],
      scope: b.scope_json ? JSON.parse(b.scope_json) : {},
      missing_info: b.missing_info_json ? JSON.parse(b.missing_info_json) : [],
    }));
    res.json({ bidRequests: parsed });
  } catch (error) {
    console.error('Get inbox error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/inbox/:id', (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });
    const analysis = processInboundRequest(bid);
    res.json({ bidRequest: bid, analysis });
  } catch (error) {
    console.error('Get bid request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/inbox/:id/estimate', (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });
    const result = generateEstimate(bid, req.user.tenantId);
    res.json(result);
  } catch (error) {
    console.error('Generate estimate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Estimates ──────────────────────────────────────────────────────────────

router.get('/estimates', (req, res) => {
  try {
    const estimates = getDacpEstimates(req.user.tenantId);
    const parsed = estimates.map(e => ({
      ...e,
      line_items: e.line_items_json ? JSON.parse(e.line_items_json) : [],
    }));
    res.json({ estimates: parsed });
  } catch (error) {
    console.error('Get estimates error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/estimates/:id', (req, res) => {
  try {
    const estimate = getDacpEstimate(req.user.tenantId, req.params.id);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    const emailDraft = draftQuoteEmail(estimate);
    res.json({ estimate, emailDraft });
  } catch (error) {
    console.error('Get estimate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/estimates/:id', (req, res) => {
  try {
    const updates = {};
    const allowed = ['status', 'subtotal', 'overhead_pct', 'profit_pct', 'mobilization', 'total_bid', 'notes'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (req.body.lineItems) updates.lineItems = req.body.lineItems;
    updateDacpEstimate(req.user.tenantId, req.params.id, updates);
    const estimate = getDacpEstimate(req.user.tenantId, req.params.id);
    res.json({ estimate });
  } catch (error) {
    console.error('Update estimate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/estimates/:id/send', (req, res) => {
  try {
    updateDacpEstimate(req.user.tenantId, req.params.id, { status: 'sent' });
    const estimate = getDacpEstimate(req.user.tenantId, req.params.id);
    const emailDraft = draftQuoteEmail(estimate);
    res.json({ estimate, emailDraft, message: 'Estimate marked as sent' });
  } catch (error) {
    console.error('Send estimate error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Jobs ───────────────────────────────────────────────────────────────────

router.get('/jobs', (req, res) => {
  try {
    const status = req.query.status || null;
    const jobs = getDacpJobs(req.user.tenantId, status);
    res.json({ jobs });
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/jobs/:id', (req, res) => {
  try {
    const job = getDacpJob(req.user.tenantId, req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const fieldReports = getDacpFieldReports(req.user.tenantId, req.params.id);
    const parsed = fieldReports.map(r => ({
      ...r,
      work: r.work_json ? JSON.parse(r.work_json) : [],
      materials: r.materials_json ? JSON.parse(r.materials_json) : [],
      labor: r.labor_json ? JSON.parse(r.labor_json) : {},
      equipment: r.equipment_json ? JSON.parse(r.equipment_json) : [],
      issues: r.issues_json ? JSON.parse(r.issues_json) : [],
    }));
    res.json({ job, fieldReports: parsed });
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Field Reports ──────────────────────────────────────────────────────────

router.get('/field-reports', (req, res) => {
  try {
    const jobId = req.query.jobId || null;
    const reports = getDacpFieldReports(req.user.tenantId, jobId);
    const parsed = reports.map(r => ({
      ...r,
      work: r.work_json ? JSON.parse(r.work_json) : [],
      materials: r.materials_json ? JSON.parse(r.materials_json) : [],
      labor: r.labor_json ? JSON.parse(r.labor_json) : {},
      equipment: r.equipment_json ? JSON.parse(r.equipment_json) : [],
      issues: r.issues_json ? JSON.parse(r.issues_json) : [],
    }));
    res.json({ fieldReports: parsed });
  } catch (error) {
    console.error('Get field reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/field-reports', (req, res) => {
  try {
    const { jobId, date, reportedBy, work, materials, labor, equipment, weather, notes, issues } = req.body;
    if (!jobId || !date) return res.status(400).json({ error: 'jobId and date are required' });
    const id = `FR-${uuidv4().slice(0, 8).toUpperCase()}`;
    createDacpFieldReport({
      id, tenantId: req.user.tenantId, jobId, date, reportedBy: reportedBy || req.user.name,
      work: work || [], materials: materials || [], labor: labor || {},
      equipment: equipment || [], weather: weather || '', notes: notes || '', issues: issues || [],
    });
    res.status(201).json({ id, message: 'Field report created' });
  } catch (error) {
    console.error('Create field report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Pricing ────────────────────────────────────────────────────────────────

router.get('/pricing', (req, res) => {
  try {
    const category = req.query.category || null;
    const pricing = getDacpPricing(req.user.tenantId, category);
    res.json({ pricing });
  } catch (error) {
    console.error('Get pricing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/pricing', (req, res) => {
  try {
    const { id, category, item, unit, material_cost, labor_cost, equipment_cost, unit_price, notes } = req.body;
    if (!id || !category || !item || !unit) {
      return res.status(400).json({ error: 'id, category, item, and unit are required' });
    }
    createDacpPricing(req.user.tenantId, { id, category, item, unit, material_cost, labor_cost, equipment_cost, unit_price, notes });
    const pricing = getDacpPricing(req.user.tenantId, null);
    res.status(201).json({ message: 'Pricing item created', pricing });
  } catch (error) {
    console.error('Create pricing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/pricing/:id', (req, res) => {
  try {
    const { material_cost, labor_cost, equipment_cost, unit_price, notes, category, item, unit } = req.body;
    const updates = {};
    if (material_cost !== undefined) updates.material_cost = material_cost;
    if (labor_cost !== undefined) updates.labor_cost = labor_cost;
    if (equipment_cost !== undefined) updates.equipment_cost = equipment_cost;
    if (unit_price !== undefined) updates.unit_price = unit_price;
    if (notes !== undefined) updates.notes = notes;
    if (category !== undefined) updates.category = category;
    if (item !== undefined) updates.item = item;
    if (unit !== undefined) updates.unit = unit;
    updateDacpPricing(req.user.tenantId, req.params.id, updates);
    const pricing = getDacpPricing(req.user.tenantId, null);
    res.json({ message: 'Pricing item updated', pricing });
  } catch (error) {
    console.error('Update pricing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/pricing/:id', (req, res) => {
  try {
    deleteDacpPricing(req.user.tenantId, req.params.id);
    res.json({ message: 'Pricing item deleted' });
  } catch (error) {
    console.error('Delete pricing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Construction Copilot (Steps 1, 5, 8) ─────────────────────────────────

router.post('/inbox/:id/analyze', async (req, res) => {
  try {
    const { analyzeItb, DEMO_ITB } = await import('../services/constructionCopilot.js');
    let bidReq;
    const isDemo = req.params.id === 'BR-DEMO-001';
    if (isDemo) {
      bidReq = DEMO_ITB;
    } else {
      bidReq = getDacpBidRequest(req.user.tenantId, req.params.id);
      if (!bidReq) return res.status(404).json({ error: 'Bid request not found' });
      if (typeof bidReq.scope_json === 'string') bidReq.scope = JSON.parse(bidReq.scope_json);
      if (typeof bidReq.missing_info_json === 'string') bidReq.missing_info = JSON.parse(bidReq.missing_info_json);
      if (typeof bidReq.attachments_json === 'string') bidReq.attachments = JSON.parse(bidReq.attachments_json);
    }
    const analysis = await analyzeItb(bidReq);

    // Save analysis to bid request and advance workflow
    if (!isDemo) {
      updateDacpBidRequest(req.user.tenantId, req.params.id, {
        itb_analysis_json: JSON.stringify(analysis),
        workflow_step: 1,
      });
    }

    res.json({ bid_request_id: req.params.id, analysis });
  } catch (error) {
    console.error('Analyze ITB error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/supplier-quotes', async (req, res) => {
  try {
    const { draftSupplierQuotes } = await import('../services/constructionCopilot.js');
    const { project_name, gc_name, bid_due_date, materials, project_location } = req.body;
    if (!project_name || !materials?.length) {
      return res.status(400).json({ error: 'project_name and materials are required' });
    }
    const quotes = draftSupplierQuotes(project_name, gc_name, bid_due_date, materials, project_location);
    res.json({ project_name, quotes });
  } catch (error) {
    console.error('Supplier quotes error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/compare-contract', async (req, res) => {
  try {
    const { compareContractProposal, DEMO_PROPOSAL, DEMO_CONTRACT } = await import('../services/constructionCopilot.js');
    const proposalText = req.body.proposal_text || DEMO_PROPOSAL;
    const contractText = req.body.contract_text || DEMO_CONTRACT;
    const comparison = await compareContractProposal(proposalText, contractText);
    res.json({ comparison });
  } catch (error) {
    console.error('Compare contract error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/demo/proposal', async (req, res) => {
  const { DEMO_PROPOSAL } = await import('../services/constructionCopilot.js');
  res.json({ proposal: DEMO_PROPOSAL });
});

router.get('/demo/contract', async (req, res) => {
  const { DEMO_CONTRACT } = await import('../services/constructionCopilot.js');
  res.json({ contract: DEMO_CONTRACT });
});

// ─── Construction Copilot V2 (Steps 2-4, 6-7 + extras) ─────────────────────

router.post('/estimates/:id/sanity-check', async (req, res) => {
  try {
    const { runBidSanityChecks } = await import('../services/constructionCopilotV2.js');
    const estimate = getDacpEstimate(req.user.tenantId, req.params.id);
    if (!estimate) return res.status(404).json({ error: 'Estimate not found' });
    if (estimate.line_items_json) estimate.line_items = JSON.parse(estimate.line_items_json);
    const result = runBidSanityChecks(estimate);
    res.json({ estimate_id: req.params.id, ...result });
  } catch (error) {
    console.error('Sanity check error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/generate-proposal', async (req, res) => {
  try {
    const { generateProposal } = await import('../services/constructionCopilotV2.js');
    const result = await generateProposal(req.body);
    res.json(result);
  } catch (error) {
    console.error('Generate proposal error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/generate-takeoff-template', async (req, res) => {
  try {
    const { generateTakeoffTemplate } = await import('../services/constructionCopilotV2.js');
    const { project_name, gc_name, assemblies } = req.body;
    if (!project_name) return res.status(400).json({ error: 'project_name is required' });
    const result = await generateTakeoffTemplate(project_name, gc_name || '', assemblies || []);
    res.json(result);
  } catch (error) {
    console.error('Generate takeoff template error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/generate-compliance-forms', async (req, res) => {
  try {
    const { generateComplianceForms } = await import('../services/constructionCopilotV2.js');
    const { project_name, gc_name, bid_date } = req.body;
    if (!project_name) return res.status(400).json({ error: 'project_name is required' });
    const result = await generateComplianceForms(project_name, gc_name || '', bid_date || '');
    res.json(result);
  } catch (error) {
    console.error('Generate compliance forms error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/generate-contract-redline', async (req, res) => {
  try {
    const { generateContractRedline } = await import('../services/constructionCopilotV2.js');
    const { comparison, project_name } = req.body;
    if (!comparison) return res.status(400).json({ error: 'comparison data is required' });
    const result = await generateContractRedline(comparison, project_name || '');
    res.json(result);
  } catch (error) {
    console.error('Generate contract redline error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/parse-supplier-quote', async (req, res) => {
  try {
    const { parseSupplierQuote } = await import('../services/constructionCopilotV2.js');
    const { email_body, from_name, from_email } = req.body;
    if (!email_body) return res.status(400).json({ error: 'email_body is required' });
    const result = parseSupplierQuote(email_body, from_name || '', from_email || '');
    res.json(result);
  } catch (error) {
    console.error('Parse supplier quote error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Feature 1: Bid/Pass Decision ────────────────────────────────────────────

router.post('/inbox/:id/bid-decision', (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });

    const { decision, reason } = req.body;
    if (!decision || !['bid', 'pass'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be "bid" or "pass"' });
    }

    if (decision === 'bid') {
      updateDacpBidRequest(req.user.tenantId, req.params.id, {
        status: 'bidding',
        workflow_step: 2,
      });
    } else {
      updateDacpBidRequest(req.user.tenantId, req.params.id, {
        status: 'passed',
        pass_reason: reason || null,
      });
    }

    const updated = getDacpBidRequest(req.user.tenantId, req.params.id);
    res.json({ bidRequest: updated, message: `Bid request marked as ${decision === 'bid' ? 'bidding' : 'passed'}` });
  } catch (error) {
    console.error('Bid decision error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Feature 2: Document Organization ────────────────────────────────────────

router.post('/inbox/:id/upload-documents', upload.array('files', 20), async (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const { parseFile } = await import('../services/fileParserService.js');
    const docs = [];

    for (const file of req.files) {
      const docId = `DOC-${uuidv4().slice(0, 8).toUpperCase()}`;
      const ext = extname(file.originalname).toLowerCase();
      const filePath = join(uploadDir, `${docId}${ext}`);

      // Write buffer to disk for parsing
      writeFileSync(filePath, file.buffer);

      // Parse the file to extract text
      let parsedText = '';
      let pageCount = null;
      try {
        const parsed = await parseFile(filePath, file.mimetype, file.originalname);
        parsedText = parsed.text || '';
        pageCount = parsed.pageCount || null;
      } catch (parseErr) {
        console.warn(`Could not parse ${file.originalname}:`, parseErr.message);
      }

      // Determine file type category
      let fileType = 'other';
      const nameLower = file.originalname.toLowerCase();
      if (nameLower.includes('spec') || nameLower.includes('division')) fileType = 'spec';
      else if (nameLower.includes('structural') || nameLower.match(/s\d{3}/)) fileType = 'structural';
      else if (nameLower.includes('architectural') || nameLower.match(/a\d{3}/)) fileType = 'architectural';
      else if (nameLower.includes('addendum') || nameLower.includes('addenda')) fileType = 'addendum';
      else if (nameLower.includes('geotech') || nameLower.includes('soil')) fileType = 'geotech';
      else if (ext === '.pdf') fileType = 'pdf';
      else if (['.xlsx', '.xls', '.csv'].includes(ext)) fileType = 'spreadsheet';

      createDacpBidDocument({
        id: docId,
        tenantId: req.user.tenantId,
        bidRequestId: req.params.id,
        filename: file.originalname,
        fileType,
        filePath,
        parsedText,
        pageCount,
      });

      docs.push({ id: docId, filename: file.originalname, fileType, pageCount, parsedTextLength: parsedText.length });
    }

    res.status(201).json({ documents: docs, message: `${docs.length} document(s) uploaded and parsed` });
  } catch (error) {
    console.error('Upload documents error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/inbox/:id/analyze-documents', async (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });

    const documents = getDacpBidDocuments(req.user.tenantId, req.params.id);
    if (!documents || documents.length === 0) {
      return res.status(400).json({ error: 'No documents uploaded for this bid request. Upload documents first.' });
    }

    const { analyzeDocuments } = await import('../services/constructionCopilot.js');
    const analysis = await analyzeDocuments(bid, documents);

    // Save scope breakdown to bid request
    updateDacpBidRequest(req.user.tenantId, req.params.id, {
      scope_breakdown_json: JSON.stringify(analysis),
    });

    // Update individual document CSI divisions
    if (analysis.divisions) {
      for (const doc of documents) {
        const relevantDivisions = analysis.divisions.map(d => d.code);
        const { updateDacpBidDocument } = await import('../cache/database.js');
        updateDacpBidDocument(req.user.tenantId, doc.id, {
          csi_divisions_json: JSON.stringify(relevantDivisions),
        });
      }
    }

    res.json({ bid_request_id: req.params.id, analysis });
  } catch (error) {
    console.error('Analyze documents error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/inbox/:id/confirm-scope', (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });

    const { divisions } = req.body;
    if (!divisions || !Array.isArray(divisions)) {
      return res.status(400).json({ error: 'divisions array is required' });
    }

    // Merge confirmed divisions into scope breakdown
    let existingBreakdown = {};
    if (bid.scope_breakdown_json) {
      try { existingBreakdown = JSON.parse(bid.scope_breakdown_json); } catch (e) {}
    }
    existingBreakdown.confirmed_divisions = divisions;
    existingBreakdown.confirmed_at = new Date().toISOString();

    updateDacpBidRequest(req.user.tenantId, req.params.id, {
      scope_breakdown_json: JSON.stringify(existingBreakdown),
      workflow_step: 3,
    });

    const updated = getDacpBidRequest(req.user.tenantId, req.params.id);
    res.json({ bidRequest: updated, message: 'Scope confirmed, workflow advanced to step 3' });
  } catch (error) {
    console.error('Confirm scope error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/inbox/:id/documents', (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });

    const documents = getDacpBidDocuments(req.user.tenantId, req.params.id);
    const parsed = documents.map(d => ({
      ...d,
      csi_divisions: d.csi_divisions_json ? JSON.parse(d.csi_divisions_json) : [],
      // Don't send full parsed_text in list view
      parsed_text: undefined,
      has_text: !!(d.parsed_text && d.parsed_text.length > 0),
      text_length: d.parsed_text ? d.parsed_text.length : 0,
    }));

    res.json({ documents: parsed });
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Feature 3: Plan Analysis ────────────────────────────────────────────────

router.post('/inbox/:id/upload-plans', upload.array('files', 20), async (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const plans = [];

    for (const file of req.files) {
      const planId = `PLAN-${uuidv4().slice(0, 8).toUpperCase()}`;
      const ext = extname(file.originalname).toLowerCase();
      const filePath = join(uploadDir, `${planId}${ext}`);

      // Write buffer to disk
      writeFileSync(filePath, file.buffer);

      // Determine file type
      const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tiff', '.tif', '.bmp'].includes(ext);
      const isSpreadsheet = ['.xlsx', '.xls', '.csv'].includes(ext);
      const fileType = isImage ? 'plan_image' : isSpreadsheet ? 'planswift_export' : 'other';

      createDacpPlanAnalysis({
        id: planId,
        tenantId: req.user.tenantId,
        bidRequestId: req.params.id,
        filename: file.originalname,
        fileType,
        filePath,
      });

      plans.push({ id: planId, filename: file.originalname, fileType });
    }

    res.status(201).json({ plans, message: `${plans.length} plan file(s) uploaded` });
  } catch (error) {
    console.error('Upload plans error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/inbox/:id/analyze-plans', async (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });

    const allPlans = getDacpPlanAnalyses(req.user.tenantId, req.params.id);
    const imagePlans = allPlans.filter(p => p.file_type === 'plan_image');

    if (imagePlans.length === 0) {
      return res.status(400).json({ error: 'No plan images uploaded. Upload plan images first.' });
    }

    // Read images and convert to base64
    const images = [];
    for (const plan of imagePlans) {
      try {
        const buffer = readFileSync(plan.file_path);
        const ext = extname(plan.filename).toLowerCase();
        const mediaMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
        images.push({
          base64: buffer.toString('base64'),
          mediaType: mediaMap[ext] || 'image/png',
          filename: plan.filename,
        });
      } catch (readErr) {
        console.warn(`Could not read plan image ${plan.filename}:`, readErr.message);
      }
    }

    if (images.length === 0) {
      return res.status(400).json({ error: 'Could not read any plan images' });
    }

    const { analyzePlanImages } = await import('../services/constructionCopilot.js');
    const analysis = await analyzePlanImages(images);

    // Save analysis to each plan record
    for (const sheet of analysis.sheets) {
      const matchingPlan = imagePlans.find(p => p.filename === sheet.filename);
      if (matchingPlan) {
        updateDacpPlanAnalysis(req.user.tenantId, matchingPlan.id, {
          analysis_json: JSON.stringify(sheet),
        });
      }
    }

    // Save checklist to bid request
    updateDacpBidRequest(req.user.tenantId, req.params.id, {
      plan_checklist_json: JSON.stringify(analysis.checklist),
    });

    res.json({ bid_request_id: req.params.id, analysis });
  } catch (error) {
    console.error('Analyze plans error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/inbox/:id/import-quantities', async (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });

    const allPlans = getDacpPlanAnalyses(req.user.tenantId, req.params.id);
    const exports = allPlans.filter(p => p.file_type === 'planswift_export');

    if (exports.length === 0) {
      return res.status(400).json({ error: 'No PlanSwift exports uploaded. Upload XLSX/CSV exports first.' });
    }

    const { parsePlanSwiftExport } = await import('../services/constructionCopilot.js');
    const allQuantities = [];

    for (const exp of exports) {
      const ext = extname(exp.filename).toLowerCase();

      let rows = [];
      if (ext === '.xlsx' || ext === '.xls') {
        const ExcelJS = (await import('exceljs')).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(exp.file_path);

        const sheet = workbook.worksheets[0];
        if (sheet) {
          const headers = [];
          sheet.getRow(1).eachCell((cell, colNumber) => {
            headers[colNumber] = cell.text || cell.value?.toString() || `col_${colNumber}`;
          });

          sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // skip header
            const rowObj = {};
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
              if (headers[colNumber]) {
                rowObj[headers[colNumber]] = cell.text || cell.value?.toString() || '';
              }
            });
            rows.push(rowObj);
          });
        }
      } else if (ext === '.csv') {
        const text = readFileSync(exp.file_path, 'utf-8');
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length > 1) {
          const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
          for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const rowObj = {};
            headers.forEach((h, idx) => { rowObj[h] = values[idx] || ''; });
            rows.push(rowObj);
          }
        }
      }

      const items = parsePlanSwiftExport(rows);

      // Save quantities to plan analysis record
      updateDacpPlanAnalysis(req.user.tenantId, exp.id, {
        quantities_json: JSON.stringify(items),
      });

      allQuantities.push({ filename: exp.filename, id: exp.id, items });
    }

    res.json({
      bid_request_id: req.params.id,
      exports: allQuantities,
      total_items: allQuantities.reduce((sum, e) => sum + e.items.length, 0),
    });
  } catch (error) {
    console.error('Import quantities error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/inbox/:id/plan-analysis', (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });

    const plans = getDacpPlanAnalyses(req.user.tenantId, req.params.id);
    const parsed = plans.map(p => ({
      ...p,
      analysis: p.analysis_json ? JSON.parse(p.analysis_json) : null,
      quantities: p.quantities_json ? JSON.parse(p.quantities_json) : null,
    }));

    const checklist = bid.plan_checklist_json ? JSON.parse(bid.plan_checklist_json) : [];

    res.json({ plans: parsed, checklist });
  } catch (error) {
    console.error('Get plan analysis error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Advance Workflow Step ───────────────────────────────────────────────────

router.post('/inbox/:id/advance-step', (req, res) => {
  try {
    const bid = getDacpBidRequest(req.user.tenantId, req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid request not found' });

    const { workflow_step } = req.body;
    if (workflow_step == null || typeof workflow_step !== 'number') {
      return res.status(400).json({ error: 'workflow_step (number) is required' });
    }

    updateDacpBidRequest(req.user.tenantId, req.params.id, { workflow_step });
    const updated = getDacpBidRequest(req.user.tenantId, req.params.id);
    res.json(updated);
  } catch (error) {
    console.error('Advance step error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Stats ──────────────────────────────────────────────────────────────────

router.get('/stats', (req, res) => {
  try {
    const stats = getDacpStats(req.user.tenantId);
    res.json({ stats });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Leads Sheet Linking ──────────────────────────────────────────────────────

function getLeadsClientPairs() {
  const pairs = [
    { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET },
    { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET },
  ].filter(p => p.id && p.secret);
  return pairs;
}

function getLeadsAuth(tenantId, clientIndex = 0) {
  const token = getKeyVaultValue(tenantId, 'google-docs', 'refresh_token');
  const config = !token ? getTenantEmailConfig(tenantId) : null;
  const refreshToken = token || config?.gmailRefreshToken;
  const pairs = getLeadsClientPairs();
  const pair = pairs[clientIndex];
  if (!pair || !refreshToken) return null;
  const client = new google.auth.OAuth2(pair.id, pair.secret, 'http://localhost:8099');
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

async function readLeadsSheet(auth, sheetId, tabName, page = 1, pageSize = 10) {
  const sheets = google.sheets({ version: 'v4', auth });
  let sheetTitle = 'Leads Sheet';
  const tabs = [];
  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'properties.title,sheets.properties' });
    sheetTitle = meta.data.properties?.title || sheetTitle;
    for (const s of (meta.data.sheets || [])) {
      tabs.push(s.properties?.title);
    }
  } catch {}

  // Use requested tab or first tab
  const activeTab = tabName && tabs.includes(tabName) ? tabName : tabs[0] || 'Sheet1';
  const range = `'${activeTab}'!A1:Z1000`;

  const result = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  const allRows = result.data.values || [];
  const headers = allRows[0] || [];
  const dataRows = allRows.slice(1).filter(r => r.some(c => c?.trim()));
  const totalRows = dataRows.length;
  const totalPages = Math.ceil(totalRows / pageSize) || 1;
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * pageSize;
  const pageRows = dataRows.slice(start, start + pageSize);
  return { sheetTitle, headers, dataRows: pageRows, totalRows, tabs, activeTab, page: safePage, totalPages };
}

/** GET /leads-sheet — Get linked leads sheet info + preview rows (per-user, falls back to tenant-level) */
router.get('/leads-sheet', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const userId = req.user?.id;
    // Per-user sheet first, then fall back to tenant-level (legacy)
    let sheetId = userId ? getKeyVaultValue(tenantId, 'dacp-leads', `sheet_id:${userId}`) : null;
    if (!sheetId || sheetId === '__unlinked__') {
      sheetId = getKeyVaultValue(tenantId, 'dacp-leads', 'sheet_id');
    }
    if (!sheetId || sheetId === '__unlinked__') {
      // Include pending shares count even when no sheet is configured
      const pendingShares = userId ? getLeadsSheetShares(tenantId, userId).filter(s => s.status === 'pending') : [];
      return res.json({ configured: false, pendingSharesCount: pendingShares.length });
    }

    // Count pending shares for the bell/badge
    const pendingShares = userId ? getLeadsSheetShares(tenantId, userId).filter(s => s.status === 'pending') : [];

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
    const tabName = req.query.tab || null;
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 10;

    // Try primary OAuth client, then fallback
    for (let ci = 0; ci < 2; ci++) {
      const auth = getLeadsAuth(tenantId, ci);
      if (!auth) continue;
      try {
        const { sheetTitle, headers, dataRows, totalRows, tabs, activeTab, page: safePage, totalPages } = await readLeadsSheet(auth, sheetId, tabName, page, pageSize);
        return res.json({
          configured: true, sheetId, sheetTitle, sheetUrl, headers, tabs, activeTab,
          totalRows, page: safePage, totalPages,
          pendingSharesCount: pendingShares.length,
          preview: dataRows.map(row => {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = row[i] || ''; });
            return obj;
          }),
        });
      } catch (err) {
        if (ci === 0 && (err.code === 401 || err.code === 403 || err.message?.includes('invalid_grant') || err.message?.includes('unauthorized_client'))) {
          console.log('[leads-sheet] Primary client failed, trying fallback...');
          continue;
        }
        throw err;
      }
    }

    return res.json({ configured: true, sheetId, sheetUrl, error: 'No OAuth token', rows: [] });
  } catch (error) {
    console.error('Leads sheet read error:', error.message);
    res.status(500).json({ error: 'Failed to read leads sheet' });
  }
});

/** POST /leads-sheet/link — Link a Google Sheet by URL or ID (per-user) */
router.post('/leads-sheet/link', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const userId = req.user?.id;
    const { sheetUrl } = req.body;
    if (!sheetUrl) return res.status(400).json({ error: 'sheetUrl required' });

    // Extract sheet ID from URL or use directly
    const match = sheetUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const sheetId = match ? match[1] : sheetUrl.trim();

    // Verify we can read it
    const auth = getLeadsAuth(tenantId);
    if (!auth) return res.status(400).json({ error: 'No Google OAuth configured for this tenant' });

    const sheets = google.sheets({ version: 'v4', auth });
    let sheetTitle = 'Leads Sheet';
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'properties.title' });
      sheetTitle = meta.data.properties?.title || sheetTitle;
    } catch (err) {
      return res.status(400).json({ error: `Cannot access sheet: ${err.message}. Make sure it's shared with the agent.` });
    }

    // Store in key vault - user-scoped key
    const keyName = userId ? `sheet_id:${userId}` : 'sheet_id';
    upsertKeyVaultEntry({
      tenantId,
      service: 'dacp-leads',
      keyName,
      keyValue: sheetId,
      addedBy: req.user?.email || 'user',
    });

    res.json({ success: true, sheetId, sheetTitle, sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` });
  } catch (error) {
    console.error('Link leads sheet error:', error.message);
    res.status(500).json({ error: 'Failed to link sheet' });
  }
});

/** DELETE /leads-sheet/unlink — Remove the linked sheet (per-user) */
router.delete('/leads-sheet/unlink', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const userId = req.user?.id;
    // Overwrite with empty to effectively unlink - user-scoped key
    const keyName = userId ? `sheet_id:${userId}` : 'sheet_id';
    upsertKeyVaultEntry({
      tenantId,
      service: 'dacp-leads',
      keyName,
      keyValue: '__unlinked__',
      addedBy: req.user?.email || 'user',
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unlink sheet' });
  }
});

/** GET /leads-sheet/search — Search Drive for candidate sheets */
router.get('/leads-sheet/search', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const q = req.query.q || 'leads';
    const auth = getLeadsAuth(tenantId);
    if (!auth) return res.json({ files: [] });

    const drive = google.drive({ version: 'v3', auth });
    const result = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.spreadsheet' and name contains '${q.replace(/'/g, "\\'")}'`,
      fields: 'files(id, name, modifiedTime, webViewLink)',
      orderBy: 'modifiedTime desc',
      pageSize: 10,
    });

    res.json({ files: result.data.files || [] });
  } catch (error) {
    console.error('Search Drive error:', error.message);
    res.json({ files: [] });
  }
});

/** GET /leads-sheet/team — Get team members for share picker */
router.get('/leads-sheet/team', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const users = getUsersByTenant(tenantId).filter(u => u.id !== req.user.id && u.status === 'active');
    res.json({ users: users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })) });
  } catch (error) {
    console.error('Get team error:', error.message);
    res.status(500).json({ error: 'Failed to get team members' });
  }
});

/** POST /leads-sheet/share — Share leads sheet with team members */
router.post('/leads-sheet/share', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const userId = req.user?.id;
    const { targetUserIds, sheetId, sheetTitle } = req.body;

    if (!targetUserIds || !Array.isArray(targetUserIds) || targetUserIds.length === 0) {
      return res.status(400).json({ error: 'targetUserIds array required' });
    }
    if (!sheetId) return res.status(400).json({ error: 'sheetId required' });

    const fromUserName = req.user?.name || req.user?.email || 'A team member';
    const results = [];

    for (const targetUserId of targetUserIds) {
      // Create platform notification
      const { default: dbProxy } = await import('../cache/database.js');
      const notifResult = dbProxy.prepare(`
        INSERT INTO platform_notifications (tenant_id, user_id, agent_id, title, body, type, link_tab)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        tenantId,
        targetUserId,
        'leads',
        `${fromUserName} shared a leads sheet with you`,
        `"${sheetTitle || 'Leads Sheet'}" - Accept to add it to your pipeline.`,
        'action',
        'command'
      );

      // Create share record
      const shareId = createLeadsSheetShare({
        tenantId,
        fromUserId: userId,
        fromUserName,
        toUserId: targetUserId,
        sheetId,
        sheetTitle: sheetTitle || 'Leads Sheet',
        notificationId: notifResult.lastInsertRowid || null,
      });

      results.push({ targetUserId, shareId });
    }

    res.json({ success: true, shares: results });
  } catch (error) {
    console.error('Share leads sheet error:', error.message);
    res.status(500).json({ error: 'Failed to share sheet' });
  }
});

/** GET /leads-sheet/shares — Get pending share invitations for current user */
router.get('/leads-sheet/shares', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const userId = req.user?.id;
    const shares = getLeadsSheetShares(tenantId, userId).filter(s => s.status === 'pending');
    res.json({ shares });
  } catch (error) {
    console.error('Get shares error:', error.message);
    res.status(500).json({ error: 'Failed to get shares' });
  }
});

/** POST /leads-sheet/shares/:id/accept — Accept a share invitation */
router.post('/leads-sheet/shares/:id/accept', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const userId = req.user?.id;
    const share = getLeadsShareById(req.params.id, tenantId);
    if (!share) return res.status(404).json({ error: 'Share not found' });
    if (share.to_user_id !== userId) return res.status(403).json({ error: 'Not authorized' });
    if (share.status !== 'pending') return res.status(400).json({ error: `Share already ${share.status}` });

    // Check if user already has a sheet linked
    const existingSheetId = getKeyVaultValue(tenantId, 'dacp-leads', `sheet_id:${userId}`);
    const hasExisting = existingSheetId && existingSheetId !== '__unlinked__';

    if (!hasExisting) {
      // No existing sheet - just set the shared sheet as theirs
      upsertKeyVaultEntry({
        tenantId,
        service: 'dacp-leads',
        keyName: `sheet_id:${userId}`,
        keyValue: share.sheet_id,
        addedBy: req.user?.email || 'user',
      });
      updateLeadsShareStatus(share.id, tenantId, 'accepted');
      return res.json({ success: true, action: 'linked', sheetId: share.sheet_id, message: `Linked "${share.sheet_title || 'Leads Sheet'}" to your pipeline.` });
    }

    // User has existing sheet - consolidate: read both, append unique rows from source to target
    let consolidated = false;
    for (let ci = 0; ci < 2; ci++) {
      const auth = getLeadsAuth(tenantId, ci);
      if (!auth) continue;
      try {
        // Read source sheet (the shared one)
        const sourceData = await readLeadsSheet(auth, share.sheet_id, null, 1, 10000);
        // Read target sheet (user's existing)
        const targetData = await readLeadsSheet(auth, existingSheetId, null, 1, 10000);

        // Build a set of existing rows for deduplication (join all cells as key)
        const existingKeys = new Set();
        // Re-read full data from target to get all rows (readLeadsSheet paginates, use large pageSize)
        const allTargetRows = targetData.dataRows || [];
        for (const row of allTargetRows) {
          existingKeys.add(row.join('|||'));
        }

        // Find unique rows in source not in target
        const newRows = [];
        for (const row of (sourceData.dataRows || [])) {
          const key = row.join('|||');
          if (!existingKeys.has(key)) {
            newRows.push(row);
          }
        }

        if (newRows.length > 0) {
          // Append to target sheet
          const sheets = google.sheets({ version: 'v4', auth });
          const activeTab = targetData.activeTab || 'Sheet1';
          await sheets.spreadsheets.values.append({
            spreadsheetId: existingSheetId,
            range: `'${activeTab}'!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: newRows },
          });
        }

        consolidated = true;
        updateLeadsShareStatus(share.id, tenantId, 'accepted');
        return res.json({
          success: true,
          action: 'consolidated',
          sheetId: existingSheetId,
          rowsAdded: newRows.length,
          message: `Merged ${newRows.length} new row(s) from "${share.sheet_title || 'shared sheet'}" into your existing pipeline.`,
        });
      } catch (err) {
        if (ci === 0 && (err.code === 401 || err.code === 403 || err.message?.includes('invalid_grant') || err.message?.includes('unauthorized_client'))) {
          console.log('[leads-sheet/accept] Primary client failed, trying fallback...');
          continue;
        }
        throw err;
      }
    }

    if (!consolidated) {
      return res.status(500).json({ error: 'No OAuth token available to read sheets for consolidation' });
    }
  } catch (error) {
    console.error('Accept share error:', error.message);
    res.status(500).json({ error: 'Failed to accept share' });
  }
});

/** POST /leads-sheet/shares/:id/decline — Decline a share invitation */
router.post('/leads-sheet/shares/:id/decline', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const userId = req.user?.id;
    const share = getLeadsShareById(req.params.id, tenantId);
    if (!share) return res.status(404).json({ error: 'Share not found' });
    if (share.to_user_id !== userId) return res.status(403).json({ error: 'Not authorized' });
    if (share.status !== 'pending') return res.status(400).json({ error: `Share already ${share.status}` });

    updateLeadsShareStatus(share.id, tenantId, 'declined');
    res.json({ success: true });
  } catch (error) {
    console.error('Decline share error:', error.message);
    res.status(500).json({ error: 'Failed to decline share' });
  }
});

// ─── Agent Assignments ────────────────────────────────────────────────────────

/** GET /assignments — List proposed/active assignments */
router.get('/assignments', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const status = req.query.status || null;
    const userId = req.user?.id || null;
    const assignments = getAgentAssignments(tenantId, status, userId);
    res.json({ assignments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** PATCH /assignments/:id/inputs — Submit input values for a task's required fields */
router.patch('/assignments/:id/inputs', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id } = req.params;
    const { values } = req.body;
    if (!values || typeof values !== 'object') return res.status(400).json({ error: 'values object is required' });

    const assignment = getAgentAssignment(tenantId, id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    // Validate required fields
    let inputFields = [];
    try { inputFields = JSON.parse(assignment.input_fields_json || '[]'); } catch {}
    const missing = inputFields
      .filter(f => f.required && (!values[f.name] || String(values[f.name]).trim() === ''))
      .map(f => f.label || f.name);
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    updateAgentAssignment(tenantId, id, { input_values_json: JSON.stringify(values) });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /assignments/:id/confirm — Confirm an assignment for execution */
router.post('/assignments/:id/confirm', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id } = req.params;
    const assignment = getAgentAssignment(tenantId, id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (!['proposed', 'completed'].includes(assignment.status)) return res.status(400).json({ error: 'Assignment cannot be run in current state' });

    // Check required input fields are filled before allowing confirmation
    let inputFields = [];
    try { inputFields = JSON.parse(assignment.input_fields_json || '[]'); } catch {}
    if (inputFields.length > 0) {
      let inputValues = {};
      try { inputValues = JSON.parse(assignment.input_values_json || '{}'); } catch {}
      const missing = inputFields
        .filter(f => f.required && (!inputValues[f.name] || String(inputValues[f.name]).trim() === ''))
        .map(f => f.label || f.name);
      if (missing.length > 0) {
        return res.status(400).json({ error: `Fill in required fields before confirming: ${missing.join(', ')}` });
      }
    }

    // Mark as confirmed and claim for this user — the assignment executor polls for 'confirmed' status and picks it up
    const userId = req.user?.id || null;
    updateAgentAssignment(tenantId, id, {
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      user_id: userId,
      job_id: null,
      result_summary: null,
      full_response: null,
      output_artifacts_json: null,
    });
    console.log(`[Assignments] Confirmed by ${userId}: ${assignment.title} — executor will pick up`);

    res.json({ success: true, status: 'confirmed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /assignments/:id/chat — Refine an assignment via inline chat */
router.post('/assignments/:id/chat', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id } = req.params;
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required' });

    const assignment = getAgentAssignment(tenantId, id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const { tunnelPrompt } = await import('../services/cliTunnel.js');

    const prompt = `You are refining an autonomous task assignment for a construction company (DACP).

CURRENT ASSIGNMENT:
- Title: ${assignment.title}
- Description: ${assignment.description}
- Category: ${assignment.category}
- Priority: ${assignment.priority}
- Action Prompt: ${assignment.action_prompt || 'None'}

USER'S MODIFICATION REQUEST:
${message}

Based on the user's request, update the assignment. Return a JSON object with the updated fields and a brief confirmation message:
{
  "title": "Updated title (keep concise, 5-10 words)",
  "description": "Updated description (1-2 sentences, reflects the modification)",
  "action_prompt": "Updated detailed execution prompt for the agent",
  "reply": "Brief confirmation of what you changed (1-2 sentences, conversational)"
}

Return ONLY the JSON, no markdown or explanation.`;

    const response = await tunnelPrompt({
      tenantId,
      agentId: assignment.agent_id || 'estimating',
      prompt,
      maxTurns: 3,
      timeoutMs: 60_000,
      label: 'Assignment Refinement',
    });

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.json({ reply: response.slice(0, 500), assignment });
    }

    const updates = JSON.parse(jsonMatch[0]);
    const { reply, ...fields } = updates;

    // Update assignment in DB
    const dbUpdates = {};
    if (fields.title) dbUpdates.title = fields.title;
    if (fields.description) dbUpdates.description = fields.description;
    if (fields.action_prompt) dbUpdates.action_prompt = fields.action_prompt;

    if (Object.keys(dbUpdates).length > 0) {
      updateAgentAssignment(tenantId, id, dbUpdates);
    }

    // Return updated assignment
    const updated = getAgentAssignment(tenantId, id);
    res.json({ reply: reply || 'Updated.', assignment: updated });
  } catch (error) {
    console.error('[Assignments] Chat refinement error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/** POST /assignments/:id/dismiss — Dismiss a proposed assignment */
router.post('/assignments/:id/dismiss', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id } = req.params;
    updateAgentAssignment(tenantId, id, { status: 'dismissed' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /assignments/team-members — List tenant members for sharing (minimal: id, name, email, role) */
router.get('/assignments/team-members', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const users = getUsersByTenant(tenantId)
      .filter(u => u.status === 'active')
      .map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role }));
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /assignments/:id/archive — Archive a completed assignment */
router.post('/assignments/:id/archive', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id } = req.params;
    const assignment = getAgentAssignment(tenantId, id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (assignment.status !== 'completed') return res.status(400).json({ error: 'Only completed tasks can be archived' });
    updateAgentAssignment(tenantId, id, { status: 'archived' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /assignments/:id/share-internal — Share a completed task with specific tenant users */
router.post('/assignments/:id/share-internal', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id } = req.params;
    const { shared_with } = req.body || {};
    const assignment = getAgentAssignment(tenantId, id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (assignment.status !== 'completed' && assignment.status !== 'archived') {
      return res.status(400).json({ error: 'Only completed tasks can be shared' });
    }
    const updates = { visibility: 'shared' };
    if (shared_with && Array.isArray(shared_with)) {
      updates.shared_with_json = JSON.stringify(shared_with);
    }
    updateAgentAssignment(tenantId, id, updates);
    res.json({ success: true, visibility: 'shared', shared_with: shared_with || [] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /assignments/:id/unshare — Make a shared task private again */
router.post('/assignments/:id/unshare', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id } = req.params;
    updateAgentAssignment(tenantId, id, { visibility: 'private' });
    res.json({ success: true, visibility: 'private' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /assignments/:id/context — Return knowledge entries attached to this assignment */
router.get('/assignments/:id/context', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const assignment = getAgentAssignment(tenantId, req.params.id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const { getTenantDb } = await import('../cache/database.js');
    const tdb = getTenantDb(tenantId);
    let entries = [];

    // Load referenced knowledge entries
    if (assignment.knowledge_entry_ids_json) {
      try {
        const ids = JSON.parse(assignment.knowledge_entry_ids_json);
        if (ids.length > 0) {
          const placeholders = ids.map(() => '?').join(',');
          entries = tdb.prepare(`SELECT id, type, title, summary, source, source_agent, recorded_at, substr(content, 1, 500) as content_preview FROM knowledge_entries WHERE id IN (${placeholders}) AND tenant_id = ?`).all(...ids, tenantId);
        }
      } catch {}
    }

    // Also load thread entries if source_thread_id exists
    if (assignment.source_thread_id) {
      const existingIds = entries.map(e => e.id);
      const threadEntries = tdb.prepare(
        "SELECT id, type, title, summary, source, source_agent, recorded_at, substr(content, 1, 500) as content_preview FROM knowledge_entries WHERE tenant_id = ? AND content LIKE ? ORDER BY recorded_at DESC LIMIT 10"
      ).all(tenantId, `%${assignment.source_thread_id}%`);
      for (const te of threadEntries) {
        if (!existingIds.includes(te.id)) entries.push(te);
      }
    }

    res.json({ entries });
  } catch (err) {
    console.error('Get assignment context error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /assignments/:id/approve-email — Approve and send a drafted email from task execution */
router.post('/assignments/:id/approve-email', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id } = req.params;
    const { index = 0 } = req.body; // which email draft to approve (if multiple)

    const assignment = getAgentAssignment(tenantId, id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const artifacts = assignment.output_artifacts_json ? JSON.parse(assignment.output_artifacts_json) : [];
    const emailDrafts = artifacts.filter(a => a.type === 'email_draft' && a.status === 'pending_approval');

    if (emailDrafts.length === 0) return res.status(400).json({ error: 'No pending email drafts' });
    const draft = emailDrafts[index] || emailDrafts[0];
    if (!draft) return res.status(400).json({ error: 'Email draft not found' });

    // Send the email
    const { sendHtmlEmail } = await import('../services/emailService.js');
    await sendHtmlEmail({
      to: draft.to,
      subject: draft.subject,
      html: draft.body,
      tenantId,
    });

    // Mark the draft as sent in artifacts
    const updatedArtifacts = artifacts.map(a => {
      if (a.type === 'email_draft' && a.index === draft.index) {
        return { ...a, status: 'sent', sent_at: new Date().toISOString(), sent_by: req.user?.id || 'unknown' };
      }
      return a;
    });

    updateAgentAssignment(tenantId, id, {
      output_artifacts_json: JSON.stringify(updatedArtifacts),
    });

    console.log(`[Assignments] Email approved and sent by ${req.user?.id}: "${draft.subject}" to ${draft.to}`);
    res.json({ success: true, to: draft.to, subject: draft.subject });
  } catch (error) {
    console.error('[Assignments] Approve email error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/** POST /assignments/:id/reject-email — Reject a drafted email */
router.post('/assignments/:id/reject-email', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id } = req.params;
    const { index = 0 } = req.body;

    const assignment = getAgentAssignment(tenantId, id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const artifacts = assignment.output_artifacts_json ? JSON.parse(assignment.output_artifacts_json) : [];
    const updatedArtifacts = artifacts.map(a => {
      if (a.type === 'email_draft' && a.index === (index || 0)) {
        return { ...a, status: 'rejected', rejected_at: new Date().toISOString(), rejected_by: req.user?.id || 'unknown' };
      }
      return a;
    });

    updateAgentAssignment(tenantId, id, {
      output_artifacts_json: JSON.stringify(updatedArtifacts),
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /assignments/:id/attach-to-entity — Attach task artifacts to a knowledge entity */
router.post('/assignments/:id/attach-to-entity', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id } = req.params;
    const { entity_id } = req.body;
    if (!entity_id) return res.status(400).json({ error: 'entity_id required' });

    const assignment = getAgentAssignment(tenantId, id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const { getTenantDb } = await import('../cache/database.js');
    const db = getTenantDb(tenantId);

    // Verify entity exists
    const entity = db.prepare('SELECT * FROM knowledge_entities WHERE id = ? AND tenant_id = ?').get(entity_id, tenantId);
    if (!entity) return res.status(404).json({ error: 'Entity not found' });

    // Create a knowledge entry for the task output
    const artifacts = assignment.output_artifacts_json ? JSON.parse(assignment.output_artifacts_json) : [];
    const pdfArt = artifacts.find(a => a.type === 'pdf');
    const gdocArt = artifacts.find(a => a.type === 'gdoc');
    const entryId = uuidv4();

    db.prepare(`
      INSERT INTO knowledge_entries (id, tenant_id, type, title, content, source, source_agent, drive_file_id, drive_url, recorded_at, processed)
      VALUES (?, ?, 'document', ?, ?, 'task-output', 'coppice', ?, ?, datetime('now'), 1)
    `).run(
      entryId,
      tenantId,
      assignment.title,
      (assignment.result_summary || '').slice(0, 2000),
      gdocArt?.fileId || null,
      gdocArt?.url || pdfArt?.path || null,
    );

    // Link entry to entity
    const linkId = uuidv4();
    db.prepare(`
      INSERT OR IGNORE INTO knowledge_links (id, entry_id, entity_id, relationship)
      VALUES (?, ?, ?, 'has_report')
    `).run(linkId, entryId, entity_id);

    // Store which entities this assignment is attached to
    const existingAttached = assignment.attached_entity_ids_json ? JSON.parse(assignment.attached_entity_ids_json) : [];
    if (!existingAttached.includes(entity_id)) {
      existingAttached.push(entity_id);
      updateAgentAssignment(tenantId, id, {
        attached_entity_ids_json: JSON.stringify(existingAttached),
      });
    }

    console.log(`[Assignments] Attached "${assignment.title}" to entity ${entity.name} (${entity_id})`);
    res.json({ success: true, entry_id: entryId, entity_name: entity.name });
  } catch (error) {
    console.error('[Assignments] Attach to entity error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/** POST /assignments/:id/regenerate-report — Regenerate PDF/DOC artifacts for a completed task */
router.post('/assignments/:id/regenerate-report', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id } = req.params;
    const assignment = getAgentAssignment(tenantId, id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (assignment.status !== 'completed') return res.status(400).json({ error: 'Only completed tasks can be regenerated' });

    // Use full_response if available, fall back to result_summary
    // Also accept content override from request body
    const content = req.body.content || assignment.full_response || assignment.result_summary;
    if (!content) return res.status(400).json({ error: 'No content available to generate report' });

    const result = await generateReport({
      title: assignment.title,
      content,
      tenantName: 'DACP Construction',
      assignmentId: id,
      theme: 'construction',
      label: 'Intelligence Brief',
      tenantId,
    });

    // Preserve existing Google Doc artifacts that weren't regenerated
    const oldArtifacts = assignment.output_artifacts_json ? JSON.parse(assignment.output_artifacts_json) : [];
    const oldGdoc = oldArtifacts.find(a => a.type === 'gdoc' || a.type === 'gdrive');
    if (oldGdoc && !result.artifacts.find(a => a.type === 'gdoc')) {
      result.artifacts.push({ type: 'gdoc', label: 'Google Docs', url: oldGdoc.url, fileId: oldGdoc.fileId });
    }

    updateAgentAssignment(tenantId, id, {
      output_artifacts_json: JSON.stringify(result.artifacts),
    });

    res.json({ success: true, artifacts: result.artifacts });
  } catch (error) {
    console.error('[Assignments] Regenerate report error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/** GET /assignments/:id/download/:format — Download a generated document */
router.get('/assignments/:id/download/:format', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const { id, format } = req.params;

    const assignment = getAgentAssignment(tenantId, id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const artifacts = assignment.output_artifacts_json ? JSON.parse(assignment.output_artifacts_json) : [];
    const artifact = artifacts.find(a => a.type === format);
    if (!artifact || !artifact.filename) return res.status(404).json({ error: `No ${format} artifact found` });

    const docDir = join(__dirname, '../../data/generated-docs');
    const filePath = join(docDir, artifact.filename);

    if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

    // Our .doc files are HTML (Word opens HTML natively).
    // If ?preview=1, serve as text/html for iframe rendering; otherwise as msword for download.
    const isPreview = req.query.preview === '1';
    const mimeTypes = {
      docx: isPreview ? 'text/html' : 'application/msword',
      doc: isPreview ? 'text/html' : 'application/msword',
      pdf: 'application/pdf',
    };

    res.setHeader('Content-Type', mimeTypes[format] || 'application/octet-stream');
    if (!isPreview) {
      res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
    }
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
