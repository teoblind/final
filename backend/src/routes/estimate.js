/**
 * DACP Construction — Estimating Routes
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
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
} from '../cache/database.js';
import {
  generateEstimate,
  processInboundRequest,
  draftClarificationEmail,
  draftQuoteEmail,
} from '../services/estimateBot.js';
import { google } from 'googleapis';

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

const LEADS_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GMAIL_CLIENT_ID;
const LEADS_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET;

function getLeadsAuth(tenantId) {
  const token = getKeyVaultValue(tenantId, 'google-docs', 'refresh_token');
  const config = !token ? getTenantEmailConfig(tenantId) : null;
  const refreshToken = token || config?.gmail_refresh_token;
  if (!LEADS_CLIENT_ID || !LEADS_CLIENT_SECRET || !refreshToken) return null;
  const client = new google.auth.OAuth2(LEADS_CLIENT_ID, LEADS_CLIENT_SECRET, 'http://localhost:8099');
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/** GET /leads-sheet — Get linked leads sheet info + preview rows */
router.get('/leads-sheet', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const sheetId = getKeyVaultValue(tenantId, 'dacp-leads', 'sheet_id');
    if (!sheetId || sheetId === '__unlinked__') return res.json({ configured: false });

    const auth = getLeadsAuth(tenantId);
    if (!auth) return res.json({ configured: true, sheetId, sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`, error: 'No OAuth token', rows: [] });

    const sheets = google.sheets({ version: 'v4', auth });

    // Get sheet metadata for title
    let sheetTitle = 'Leads Sheet';
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: 'properties.title' });
      sheetTitle = meta.data.properties?.title || sheetTitle;
    } catch {}

    // Read first sheet's header + data rows
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'A1:Z200',
    });
    const allRows = result.data.values || [];
    const headers = allRows[0] || [];
    const dataRows = allRows.slice(1).filter(r => r.some(c => c?.trim()));

    // Return summary: total rows, headers, last 10 rows preview
    res.json({
      configured: true,
      sheetId,
      sheetTitle,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
      headers,
      totalRows: dataRows.length,
      preview: dataRows.slice(0, 10).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = row[i] || ''; });
        return obj;
      }),
    });
  } catch (error) {
    console.error('Leads sheet read error:', error.message);
    res.status(500).json({ error: 'Failed to read leads sheet' });
  }
});

/** POST /leads-sheet/link — Link a Google Sheet by URL or ID */
router.post('/leads-sheet/link', async (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
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

    // Store in key vault
    upsertKeyVaultEntry({
      tenantId,
      service: 'dacp-leads',
      keyName: 'sheet_id',
      keyValue: sheetId,
      addedBy: req.user?.email || 'user',
    });

    res.json({ success: true, sheetId, sheetTitle, sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` });
  } catch (error) {
    console.error('Link leads sheet error:', error.message);
    res.status(500).json({ error: 'Failed to link sheet' });
  }
});

/** DELETE /leads-sheet/unlink — Remove the linked sheet */
router.delete('/leads-sheet/unlink', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    // Overwrite with empty to effectively unlink
    upsertKeyVaultEntry({
      tenantId,
      service: 'dacp-leads',
      keyName: 'sheet_id',
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

// ─── Agent Assignments ────────────────────────────────────────────────────────

/** GET /assignments — List proposed/active assignments */
router.get('/assignments', (req, res) => {
  try {
    const tenantId = req.resolvedTenant?.id || req.user.tenantId;
    const status = req.query.status || null;
    const assignments = getAgentAssignments(tenantId, status);
    res.json({ assignments });
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
    if (assignment.status !== 'proposed') return res.status(400).json({ error: 'Assignment not in proposed state' });

    // Mark as confirmed
    updateAgentAssignment(tenantId, id, {
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    });

    // Execute asynchronously via chat
    const prompt = assignment.action_prompt || `Execute this task: ${assignment.title}\n\n${assignment.description}`;
    const agentId = assignment.agent_id || 'estimating';

    // Start execution in background
    updateAgentAssignment(tenantId, id, { status: 'in_progress' });

    (async () => {
      try {
        const { chat } = await import('../services/chatService.js');
        const result = await chat(tenantId, agentId, 'system', prompt, null, { helpMode: false });
        updateAgentAssignment(tenantId, id, {
          status: 'completed',
          result_summary: (result.response || '').slice(0, 2000),
          completed_at: new Date().toISOString(),
          thread_id: result.threadId || null,
        });
        console.log(`[Assignments] Completed: ${assignment.title}`);
      } catch (err) {
        updateAgentAssignment(tenantId, id, {
          status: 'proposed',
          result_summary: `Failed: ${err.message}`,
        });
        console.error(`[Assignments] Failed: ${assignment.title}:`, err.message);
      }
    })();

    res.json({ success: true, status: 'in_progress' });
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

export default router;
