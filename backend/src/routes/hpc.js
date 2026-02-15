/**
 * HPC Contract & SLA Routes — Phase 7
 *
 * API endpoints for managing HPC/AI compute contracts,
 * tracking SLA compliance, monitoring breach risks,
 * and viewing the contract calendar.
 */

import express from 'express';
import {
  getHpcContracts,
  getHpcContract,
  createHpcContract,
  updateHpcContract,
  deleteHpcContract,
  getSlaEvents,
  getSlaEventsSummary,
  getAllSlaSummary,
} from '../cache/database.js';

const router = express.Router();

// ─── Lazy-loaded HPC Contract Service ───────────────────────────────────────

/**
 * The hpcContractService provides computed SLA compliance, breach risk, and
 * calendar views. We load it lazily so the route file can still boot if the
 * service module has not been created yet.
 */
let _hpcService = null;

async function getHpcService() {
  if (_hpcService) return _hpcService;
  try {
    _hpcService = await import('../services/hpcContractService.js');
    return _hpcService;
  } catch (e) {
    return null;
  }
}

// ─── List Contracts ─────────────────────────────────────────────────────────

/**
 * GET /contracts — List all HPC contracts with computed uptime
 */
router.get('/contracts', async (req, res) => {
  try {
    const { status } = req.query;
    const contracts = getHpcContracts(status || null);

    // Compute current uptime for each contract from SLA events
    const enriched = contracts.map(contract => {
      const slaSummary = getSlaEventsSummary(contract.id, 30);
      const totalMinutesInPeriod = 30 * 24 * 60;
      const downtimeMinutes = slaSummary?.total_downtime_minutes || 0;
      const uptimeMinutes = totalMinutesInPeriod - downtimeMinutes;
      const currentUptime = totalMinutesInPeriod > 0
        ? (uptimeMinutes / totalMinutesInPeriod) * 100
        : 100;

      return {
        ...contract,
        currentUptime: parseFloat(currentUptime.toFixed(4)),
        slaTarget: contract.uptime_sla,
        slaMet: currentUptime >= (contract.uptime_sla || 99.9),
      };
    });

    // Get contract summary from service if available
    let summary = null;
    const svc = await getHpcService();
    if (svc?.getContractSummary) {
      try {
        summary = svc.getContractSummary();
      } catch (e) {
        // Service may not be fully implemented
      }
    }

    // Fallback summary if service unavailable
    if (!summary) {
      const active = enriched.filter(c => c.status === 'active');
      summary = {
        totalContracts: enriched.length,
        activeContracts: active.length,
        totalMonthlyRevenue: active.reduce((s, c) => s + (c.monthly_revenue || 0), 0),
        totalGpuCount: active.reduce((s, c) => s + (c.gpu_count || 0), 0),
        totalPowerDrawMW: active.reduce((s, c) => s + (c.power_draw_mw || 0), 0),
        avgUptime: active.length > 0
          ? active.reduce((s, c) => s + c.currentUptime, 0) / active.length
          : 100,
      };
    }

    res.json({ contracts: enriched, summary });
  } catch (error) {
    console.error('Error listing HPC contracts:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Create Contract ────────────────────────────────────────────────────────

/**
 * POST /contracts — Create a new HPC contract
 */
router.post('/contracts', (req, res) => {
  try {
    let { id } = req.body;
    const {
      customer, contractType, gpuModel, gpuCount, powerDrawMW,
      ratePerGpuHr, monthlyRevenue, uptimeSLA, interruptible,
      curtailmentPenalty, curtailmentMaxHours, curtailmentNoticeMin,
      startDate, endDate, autoRenew, status,
    } = req.body;

    if (!customer || !contractType) {
      return res.status(400).json({ error: 'customer and contractType are required' });
    }

    // Generate id if not provided
    if (!id) {
      const randomDigits = String(Math.floor(Math.random() * 900) + 100);
      id = `HPC-${randomDigits}`;
    }

    createHpcContract({
      id,
      customer,
      contractType,
      gpuModel,
      gpuCount,
      powerDrawMW,
      ratePerGpuHr,
      monthlyRevenue,
      uptimeSLA: uptimeSLA || 99.9,
      interruptible: interruptible || false,
      curtailmentPenalty,
      curtailmentMaxHours,
      curtailmentNoticeMin,
      startDate,
      endDate,
      autoRenew: autoRenew || false,
      status: status || 'active',
    });

    res.json({ success: true, id });
  } catch (error) {
    console.error('Error creating HPC contract:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Update Contract ────────────────────────────────────────────────────────

/**
 * PUT /contracts/:id — Update an existing HPC contract
 */
router.put('/contracts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getHpcContract(id);
    if (!existing) {
      return res.status(404).json({ error: `HPC contract not found: ${id}` });
    }

    updateHpcContract(id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating HPC contract:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Delete (Archive) Contract ──────────────────────────────────────────────

/**
 * DELETE /contracts/:id — Archive (soft delete) an HPC contract
 */
router.delete('/contracts/:id', (req, res) => {
  try {
    const { id } = req.params;
    const existing = getHpcContract(id);
    if (!existing) {
      return res.status(404).json({ error: `HPC contract not found: ${id}` });
    }

    deleteHpcContract(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error archiving HPC contract:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── SLA Compliance for One Contract ────────────────────────────────────────

/**
 * GET /contracts/:id/sla — SLA compliance details for one contract
 * Query params: ?days=30
 */
router.get('/contracts/:id/sla', async (req, res) => {
  try {
    const { id } = req.params;
    const days = parseInt(req.query.days) || 30;

    const existing = getHpcContract(id);
    if (!existing) {
      return res.status(404).json({ error: `HPC contract not found: ${id}` });
    }

    // Try the service first for richer compliance data
    const svc = await getHpcService();
    if (svc?.getContractSlaCompliance) {
      try {
        const compliance = svc.getContractSlaCompliance(id, days);
        return res.json({ contractId: id, compliance });
      } catch (e) {
        // Fall through to manual calculation
      }
    }

    // Fallback: compute from raw SLA events
    const events = getSlaEvents(id, days);
    const summary = getSlaEventsSummary(id, days);
    const totalMinutesInPeriod = days * 24 * 60;
    const downtimeMinutes = summary?.total_downtime_minutes || 0;
    const uptimeMinutes = totalMinutesInPeriod - downtimeMinutes;
    const uptimePercent = totalMinutesInPeriod > 0
      ? (uptimeMinutes / totalMinutesInPeriod) * 100
      : 100;

    res.json({
      contractId: id,
      compliance: {
        periodDays: days,
        uptimePercent: parseFloat(uptimePercent.toFixed(4)),
        slaTarget: existing.uptime_sla || 99.9,
        slaMet: uptimePercent >= (existing.uptime_sla || 99.9),
        totalDowntimeMinutes: downtimeMinutes,
        totalEvents: summary?.total_events || 0,
        totalPenalties: summary?.total_penalties || 0,
        breachCount: summary?.breach_count || 0,
        events,
      },
    });
  } catch (error) {
    console.error('Error fetching SLA compliance:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Overall SLA Summary ────────────────────────────────────────────────────

/**
 * GET /sla/summary — Overall SLA summary across all contracts
 * Query params: ?days=30
 */
router.get('/sla/summary', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const svc = await getHpcService();

    // Try service for full compliance and breach risk
    let contracts = null;
    let breachRisks = null;

    if (svc?.getAllSlaCompliance) {
      try {
        contracts = svc.getAllSlaCompliance(days);
      } catch (e) { /* fall through */ }
    }

    if (svc?.checkSlaBreachRisk) {
      try {
        breachRisks = svc.checkSlaBreachRisk();
      } catch (e) { /* fall through */ }
    }

    // Fallback: compute from database
    if (!contracts) {
      const allSummary = getAllSlaSummary(days);
      const hpcContracts = getHpcContracts();
      const totalMinutesInPeriod = days * 24 * 60;

      contracts = allSummary.map(s => {
        const contract = hpcContracts.find(c => c.id === s.contract_id);
        const downtimeMinutes = s.total_downtime_minutes || 0;
        const uptimePercent = totalMinutesInPeriod > 0
          ? ((totalMinutesInPeriod - downtimeMinutes) / totalMinutesInPeriod) * 100
          : 100;

        return {
          contractId: s.contract_id,
          customer: contract?.customer || 'Unknown',
          uptimePercent: parseFloat(uptimePercent.toFixed(4)),
          slaTarget: contract?.uptime_sla || 99.9,
          slaMet: uptimePercent >= (contract?.uptime_sla || 99.9),
          totalDowntimeMinutes: downtimeMinutes,
          totalEvents: s.total_events || 0,
          totalPenalties: s.total_penalties || 0,
        };
      });
    }

    if (!breachRisks) {
      // Simple breach risk check: contracts within 0.5% of SLA threshold
      breachRisks = contracts
        .filter(c => !c.slaMet || (c.uptimePercent - (c.slaTarget || 99.9)) < 0.5)
        .map(c => ({
          contractId: c.contractId,
          customer: c.customer,
          currentUptime: c.uptimePercent,
          slaTarget: c.slaTarget,
          gap: parseFloat((c.uptimePercent - (c.slaTarget || 99.9)).toFixed(4)),
          risk: c.uptimePercent < (c.slaTarget || 99.9) ? 'breached' : 'at_risk',
        }));
    }

    res.json({ contracts, breachRisks });
  } catch (error) {
    console.error('Error fetching SLA summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Contract Calendar ──────────────────────────────────────────────────────

/**
 * GET /calendar — Contract calendar view
 */
router.get('/calendar', async (req, res) => {
  try {
    const svc = await getHpcService();

    if (svc?.getContractCalendar) {
      try {
        const calendar = svc.getContractCalendar();
        return res.json({ contracts: calendar });
      } catch (e) {
        // Fall through to manual construction
      }
    }

    // Fallback: build calendar from raw contracts
    const contracts = getHpcContracts();
    const calendar = contracts.map(c => ({
      id: c.id,
      customer: c.customer,
      contractType: c.contract_type,
      startDate: c.start_date,
      endDate: c.end_date,
      autoRenew: !!c.auto_renew,
      status: c.status,
      monthlyRevenue: c.monthly_revenue,
      gpuCount: c.gpu_count,
      gpuModel: c.gpu_model,
    }));

    res.json({ contracts: calendar });
  } catch (error) {
    console.error('Error fetching contract calendar:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
