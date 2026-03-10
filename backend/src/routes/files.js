/**
 * Files Routes — Tenant file browser with Google Drive links
 *
 * GET /api/v1/files           — List files (with category/search filters)
 * GET /api/v1/files/categories — Get category list with counts
 */

import express from 'express';
import { getTenantFiles, getTenantFileCategories, getTenantFileCount } from '../cache/database.js';

const router = express.Router();

function resolveIds(req) {
  const tenantId = req.resolvedTenant?.id || 'default';
  return { tenantId };
}

router.get('/', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const { category, search, limit } = req.query;

    const files = getTenantFiles(tenantId, {
      category: category || undefined,
      search: search || undefined,
      limit: limit ? parseInt(limit) : 100,
    });

    const categories = getTenantFileCategories(tenantId);
    const total = getTenantFileCount(tenantId);

    res.json({ files, categories, total });
  } catch (err) {
    console.error('Files list error:', err);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

router.get('/categories', (req, res) => {
  try {
    const { tenantId } = resolveIds(req);
    const categories = getTenantFileCategories(tenantId);
    res.json({ categories });
  } catch (err) {
    console.error('Files categories error:', err);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

export default router;
