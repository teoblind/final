/**
 * Fleet Diagnostics Routes — Phase 5
 *
 * Cross-references pool data with fleet config and curtailment events
 * to detect anomalies and reconcile operational state.
 */
import express from 'express';
import {
  getHashrateReconciliation,
  getCurtailmentReconciliation,
  getWorkerAnomalies,
  getDiagnosticsSummary,
} from '../services/diagnosticsEngine.js';

const router = express.Router();

/** GET /reconciliation — Hashrate reconciliation report */
router.get('/reconciliation', async (req, res) => {
  try {
    const reconciliation = await getHashrateReconciliation();
    res.json({
      hashrateReconciliation: reconciliation,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting hashrate reconciliation:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /curtailment — Curtailment execution reconciliation */
router.get('/curtailment', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const reconciliation = await getCurtailmentReconciliation(days);
    res.json({
      curtailmentReconciliation: reconciliation,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting curtailment reconciliation:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /anomalies — Current worker/fleet anomalies */
router.get('/anomalies', async (req, res) => {
  try {
    const anomalies = await getWorkerAnomalies();
    res.json({
      anomalies,
      totalAnomalies: anomalies.length,
      critical: anomalies.filter(a => a.severity === 'critical').length,
      warnings: anomalies.filter(a => a.severity === 'warning').length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting anomalies:', error);
    res.status(500).json({ error: error.message });
  }
});

/** GET /summary — Overall diagnostic health status */
router.get('/summary', async (req, res) => {
  try {
    const summary = await getDiagnosticsSummary();
    res.json({
      ...summary,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting diagnostics summary:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
