/**
 * Background Jobs + Key Vault Routes
 *
 * Long-running agent tasks with progress tracking, agent-to-user
 * mid-task messaging, and per-tenant API key storage.
 */

import express from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  createBackgroundJob,
  getBackgroundJobs,
  getBackgroundJob,
  updateBackgroundJob,
  addJobMessage,
  getJobMessages,
  respondToJobMessage,
  getPendingJobRequests,
  getKeyVaultEntries,
  upsertKeyVaultEntry,
  deleteKeyVaultEntry,
  getDefaultTenantId,
} from '../cache/database.js';

const router = express.Router();

router.use(authenticate);

function resolveTenant(req) {
  return req.resolvedTenant?.id || getDefaultTenantId();
}

// ─── Background Jobs ─────────────────────────────────────────────────────────

/**
 * POST / - Create a new background job
 */
router.post('/', (req, res) => {
  try {
    const tenantId = resolveTenant(req);
    const userId = req.user?.id || 'anonymous';
    const { title, description, agentId } = req.body;

    if (!title) return res.status(400).json({ error: 'title is required' });

    const id = createBackgroundJob({ tenantId, userId, agentId, title, description });

    // Add initial message
    addJobMessage(id, 'agent', `Job created: ${title}`, 'info');

    res.status(201).json({ id, status: 'pending' });
  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET / - List jobs for current tenant
 */
router.get('/', (req, res) => {
  try {
    const tenantId = resolveTenant(req);
    const { status } = req.query;
    const jobs = getBackgroundJobs(tenantId, status || null);
    res.json({ jobs });
  } catch (error) {
    console.error('List jobs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /pending-requests - Get all unanswered agent questions across jobs
 */
router.get('/pending-requests', (req, res) => {
  try {
    const tenantId = resolveTenant(req);
    const requests = getPendingJobRequests(tenantId);
    res.json({ requests });
  } catch (error) {
    console.error('Pending requests error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:id - Get job details + messages
 */
router.get('/:id', (req, res) => {
  try {
    const job = getBackgroundJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const tenantId = resolveTenant(req);
    if (job.tenant_id !== tenantId) return res.status(403).json({ error: 'Access denied' });

    const messages = getJobMessages(job.id);
    const result = job.result_json ? JSON.parse(job.result_json) : null;

    res.json({ job: { ...job, result: result }, messages });
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /:id - Update job status/progress (used by agent internally)
 */
router.patch('/:id', (req, res) => {
  try {
    const job = getBackgroundJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const { status, progressPct, progressMessage, resultJson, errorMessage } = req.body;
    updateBackgroundJob(job.id, { status, progressPct, progressMessage, resultJson, errorMessage });

    // Auto-add progress message to job log
    if (progressMessage) {
      addJobMessage(job.id, 'agent', progressMessage, 'info');
    }
    if (errorMessage) {
      addJobMessage(job.id, 'agent', errorMessage, 'warning');
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:id/messages - User responds to an agent prompt, or agent posts a message
 */
router.post('/:id/messages', (req, res) => {
  try {
    const job = getBackgroundJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const tenantId = resolveTenant(req);
    if (job.tenant_id !== tenantId) return res.status(403).json({ error: 'Access denied' });

    const { role, content, messageType, requestType, respondToId } = req.body;

    if (!content) return res.status(400).json({ error: 'content is required' });

    // If responding to a pending agent request
    if (respondToId) {
      respondToJobMessage(respondToId, content);
      addJobMessage(job.id, 'user', content, 'info');

      // If job was paused waiting for input, resume it
      if (job.status === 'paused') {
        updateBackgroundJob(job.id, { status: 'running' });
      }

      return res.json({ success: true, resumed: job.status === 'paused' });
    }

    // Otherwise add a new message
    addJobMessage(job.id, role || 'user', content, messageType || 'info', requestType || null);

    res.json({ success: true });
  } catch (error) {
    console.error('Job message error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Key Vault ───────────────────────────────────────────────────────────────

/**
 * GET /keys - List API keys for tenant (values masked)
 */
router.get('/keys/list', (req, res) => {
  try {
    const tenantId = resolveTenant(req);
    const entries = getKeyVaultEntries(tenantId);
    res.json({ keys: entries });
  } catch (error) {
    console.error('List keys error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /keys - Add or update a key
 */
router.post('/keys', (req, res) => {
  try {
    const tenantId = resolveTenant(req);
    const { service, keyName, keyValue } = req.body;

    if (!service || !keyValue) return res.status(400).json({ error: 'service and keyValue are required' });

    const id = upsertKeyVaultEntry({
      tenantId,
      service,
      keyName: keyName || 'default',
      keyValue,
      addedBy: req.user?.id || 'user',
    });

    res.status(201).json({ id, service, keyName: keyName || 'default' });
  } catch (error) {
    console.error('Add key error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /keys/:id - Remove a key
 */
router.delete('/keys/:id', (req, res) => {
  try {
    const tenantId = resolveTenant(req);
    const result = deleteKeyVaultEntry(req.params.id, tenantId);
    if (result.changes === 0) return res.status(404).json({ error: 'Key not found' });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete key error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Batch API (300K output) ────────────────────────────────────────────────

/**
 * POST /batch - Submit a batch generation request
 * Body: { type: 'report'|'newsletter', system, prompt, model? }
 */
router.post('/batch', async (req, res) => {
  try {
    const tenantId = resolveTenant(req);
    const { type, system, prompt, model } = req.body;

    if (!type || !prompt) {
      return res.status(400).json({ error: 'type and prompt are required' });
    }

    const { generateReport, generateLongForm } = await import('../services/batchService.js');

    if (type === 'report') {
      // Fire and forget - store job ID for polling
      const jobId = `batch-${Date.now()}`;
      const job = createBackgroundJob(tenantId, req.user?.id || 'system', {
        type: 'batch_generation',
        status: 'running',
        metadata: JSON.stringify({ batchType: type }),
      });

      // Run async
      generateReport({ tenantId, reportType: 'custom', system, prompt, model })
        .then(result => {
          updateBackgroundJob(job.id, {
            status: 'completed',
            result: JSON.stringify({ text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens }),
          });
        })
        .catch(err => {
          updateBackgroundJob(job.id, { status: 'failed', result: JSON.stringify({ error: err.message }) });
        });

      res.json({ jobId: job.id, status: 'submitted' });
    } else {
      const result = await generateLongForm({ system, prompt, model });
      res.json({ text: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
    }
  } catch (error) {
    console.error('Batch submit error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /batch/test - Quick test of the batch API with a simple prompt
 */
router.post('/batch/test', async (req, res) => {
  try {
    const { submitBatch, waitForBatch } = await import('../services/batchService.js');

    const { batchId } = await submitBatch([{
      id: 'test-ping',
      messages: [{ role: 'user', content: 'Reply with exactly: "Batch API working. 300K output ready."' }],
      maxTokens: 256,
    }], { longOutput: false });

    const results = await waitForBatch(batchId, { pollIntervalMs: 5000, maxWaitMs: 120000 });
    const result = results.get('test-ping');

    res.json({
      success: result?.type === 'succeeded',
      batchId,
      response: result?.text,
      tokens: { input: result?.inputTokens, output: result?.outputTokens },
    });
  } catch (error) {
    console.error('Batch test error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
