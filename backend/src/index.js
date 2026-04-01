import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { initDatabase, onActivityInsert } from './cache/database.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Existing route modules (Phases 1-7)
import yahooRoutes from './routes/yahoo.js';
import hashpriceRoutes from './routes/hashprice.js';
import bitcoinRoutes from './routes/bitcoin.js';
import uraniumRoutes from './routes/uranium.js';
import pmiRoutes from './routes/pmi.js';
import rareEarthRoutes from './routes/rareearth.js';
import japanRoutes from './routes/japan.js';
import tradeRoutes from './routes/trade.js';
import datacenterRoutes from './routes/datacenter.js';
import iranRoutes from './routes/iran.js';
import brazilRoutes from './routes/brazil.js';
import alertRoutes from './routes/alerts.js';
import notesRoutes from './routes/notes.js';
import correlationRoutes from './routes/correlation.js';
import liquidityRoutes from './routes/liquidity.js';
import energyRoutes from './routes/energy.js';
import fleetRoutes from './routes/fleet.js';
import curtailmentRoutes from './routes/curtailment.js';
import poolRoutes from './routes/pools.js';
import chainRoutes from './routes/chain.js';
import diagnosticsRoutes from './routes/diagnostics.js';
import agentRoutes from './routes/agents.js';
import notificationRoutes from './routes/notifications.js';
import workloadRoutes from './routes/workloads.js';
import gpuRoutes from './routes/gpu.js';
import hpcRoutes from './routes/hpc.js';
import allocationRoutes from './routes/allocation.js';
import botsRoutes from './routes/bots.js';
import ercotLmpRoutes from './routes/ercotLmp.js';

// Phase 8: New route modules
import authRoutes from './routes/auth.js';
import tenantRoutes from './routes/tenant.js';
import partnerRoutes from './routes/partners.js';
import adminRoutes from './routes/admin.js';
import webhookRoutes from './routes/webhooks.js';

// Phase 9: Insurance integration routes
import insuranceRoutes from './routes/insurance.js';
import adminInsuranceRoutes from './routes/adminInsurance.js';
import lpRoutes from './routes/lp.js';
import sanghaChartRoutes from './routes/sanghaCharts.js';

import estimateRoutes from './routes/estimate.js';
import leadEngineRoutes from './routes/leadEngine.js';
import chatRoutes from './routes/chat.js';
import workspaceRoutes from './routes/workspace.js';
import approvalRoutes from './routes/approvals.js';
import platformNotificationRoutes from './routes/platformNotifications.js';
import knowledgeRoutes from './routes/knowledge.js';
import voiceRoutes from './routes/voice.js';
import landingRoutes from './routes/landing.js';
import filesRoutes from './routes/files.js';
import hubspotRoutes from './routes/hubspot.js';
import crmRoutes from './routes/crm.js';
import jobsRoutes from './routes/jobs.js';
import activityRoutes from './routes/activity.js';
import reportCommentRoutes from './routes/reportComments.js';
import recallRoutes from './routes/recall.js';
import officeRoutes from './routes/office.js';
import meetingsRoutes from './routes/meetings.js';
import firefliesRoutes from './routes/fireflies.js';
import intuitRoutes from './routes/intuit.js';
import accountingRoutes from './routes/accounting.js';
import priceMonitorRoutes from './routes/priceMonitor.js';
import portfolioRoutes from './routes/portfolio.js';
import schedulerRoutes from './routes/scheduler.js';
import mcpConfigRoutes from './routes/mcpConfig.js';
import ceoRoutes from './routes/ceo.js';
import internalRoutes from './routes/internal.js';
import tenantResolver from './middleware/tenantResolver.js';
import { startRefreshScheduler } from './jobs/liquidityRefresh.js';
import { verifyOnStartup as verifySanghaModel } from './services/sanghaModelClient.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3002;

// Trust Nginx reverse proxy so req.ip reflects the real client IP
app.set('trust proxy', 1);

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.endsWith('.coppice.ai') || origin === 'https://coppice.ai' || origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) {
      return callback(null, true);
    }
    callback(null, false);
  },
  credentials: true,
}));
app.use(express.json());

// Initialize database (includes Phase 8 tables)
initDatabase();

// Landing page routes - no tenant required (root domain)
app.use('/api/v1', landingRoutes);

// Voice session instructions - pre-built by createVoiceBot, fetched by voice-agent.html
app.get('/api/v1/voice-session/:sessionId', (req, res) => {
  try {
    const { voiceSessions } = require('./services/recallService.js');
    const session = voiceSessions.get(req.params.sessionId);
    if (session) {
      res.json({ instructions: session.instructions });
      // Clean up after fetch (one-time use)
      voiceSessions.delete(req.params.sessionId);
    } else {
      res.json({ instructions: '' });
    }
  } catch (e) {
    // ESM import fallback
    import('./services/recallService.js').then(mod => {
      const session = mod.voiceSessions.get(req.params.sessionId);
      if (session) {
        res.json({ instructions: session.instructions });
        mod.voiceSessions.delete(req.params.sessionId);
      } else {
        res.json({ instructions: '' });
      }
    }).catch(() => res.json({ instructions: '' }));
  }
});

// Voice agent context - public (no auth), used by voice-agent.html in Recall bot
app.get('/api/v1/voice-context/:tenantId', async (req, res) => {
  try {
    const { getMeetingPrompt } = await import('./services/chatService.js');
    const { getTenantDb } = await import('./cache/database.js');

    const tenantId = req.params.tenantId;
    let basePrompt = getMeetingPrompt(tenantId);

    // Enrich with accumulated knowledge from tenant DB
    try {
      const tdb = getTenantDb(tenantId);

      // Recent meeting summaries
      const recentMeetings = tdb.prepare(`
        SELECT title, content, recorded_at FROM knowledge_entries
        WHERE tenant_id = ? AND type = 'meeting' AND processed = 1
        ORDER BY recorded_at DESC LIMIT 5
      `).all(tenantId);

      // Open action items
      const openItems = tdb.prepare(`
        SELECT title, assignee, due_date, status FROM action_items
        WHERE tenant_id = ? AND status = 'open'
        ORDER BY created_at DESC LIMIT 15
      `).all(tenantId);

      // Recent knowledge entries (non-meeting)
      const knowledgeEntries = tdb.prepare(`
        SELECT title, content, type, recorded_at FROM knowledge_entries
        WHERE tenant_id = ? AND type != 'meeting' AND processed = 1
        ORDER BY recorded_at DESC LIMIT 5
      `).all(tenantId);

      let memory = '';

      if (recentMeetings.length > 0) {
        memory += '\n\nRECENT MEETING HISTORY (you attended these):';
        for (const m of recentMeetings) {
          memory += `\n- ${m.title} (${m.recorded_at}):\n${(m.content || '').slice(0, 500)}`;
        }
      }

      if (openItems.length > 0) {
        memory += '\n\nOPEN ACTION ITEMS:';
        for (const item of openItems) {
          memory += `\n- [${item.assignee || 'Unassigned'}] ${item.title}${item.due_date ? ` (due: ${item.due_date})` : ''}`;
        }
      }

      if (knowledgeEntries.length > 0) {
        memory += '\n\nRECENT KNOWLEDGE:';
        for (const k of knowledgeEntries) {
          memory += `\n- ${k.title} (${k.type}, ${k.recorded_at}): ${(k.content || '').slice(0, 300)}`;
        }
      }

      if (memory) {
        basePrompt += memory;
        console.log(`[VoiceContext] Enriched ${tenantId} prompt with ${recentMeetings.length} meetings, ${openItems.length} action items, ${knowledgeEntries.length} knowledge entries`);
      }
    } catch (e) {
      console.warn('[VoiceContext] Failed to enrich with tenant data:', e.message);
    }

    res.json({ instructions: basePrompt });
  } catch (e) {
    console.error('Voice context error:', e.message);
    res.json({ instructions: '' });
  }
});

// Serve demo files (estimates, reports, etc.)
app.use('/files', express.static(join(__dirname, '../demo-files')));

// Serve bot assets (avatar image for voice-agent.html)
app.use('/assets', express.static(join(__dirname, '../assets')));

// Internal tool endpoint - localhost-only, used by MCP bridge for CLI tunnel agent
// Larger JSON limit for document/presentation tool inputs
app.use('/api/v1/internal', express.json({ limit: '10mb' }), internalRoutes);

// Tenant resolver - runs before all routes, no auth required
app.use(tenantResolver);

// Start liquidity data refresh scheduler (every 5 minutes)
startRefreshScheduler(5);

// Start webhook retry scheduler
try {
  const { startWebhookRetryScheduler } = await import('./services/webhookService.js');
  startWebhookRetryScheduler(2);
} catch (err) {
  console.warn('Webhook retry scheduler not started:', err.message);
}

// Start Gmail inbox poll scheduler (for activity feed reply detection)
try {
  const { startGmailPollScheduler } = await import('./jobs/gmailPoll.js');
  if (process.env.GMAIL_REFRESH_TOKEN) {
    startGmailPollScheduler(1);
  }
} catch (err) {
  console.warn('Gmail poll scheduler not started:', err.message);
}

// Start calendar poll scheduler - multi-tenant meeting auto-join (every 30s)
try {
  const { startCalendarPollScheduler } = await import('./jobs/calendarPoll.js');
  if (process.env.GMAIL_REFRESH_TOKEN || process.env.RECALL_API_KEY) {
    startCalendarPollScheduler(30);
  }
} catch (err) {
  console.warn('Calendar poll scheduler not started:', err.message);
}

// Start accounting poll scheduler (every 15 minutes)
try {
  const { startAccountingPollScheduler } = await import('./jobs/accountingPoll.js');
  startAccountingPollScheduler(15);
} catch (err) {
  console.warn('Accounting poll scheduler not started:', err.message);
}

// Start price monitor scheduler (every 5 minutes)
try {
  const { startPriceMonitorScheduler } = await import('./jobs/priceMonitorJob.js');
  startPriceMonitorScheduler(5);
} catch (err) {
  console.warn('Price monitor scheduler not started:', err.message);
}

// Start company email stats job (daily)
try {
  const { startCompanyEmailStatsJob } = await import('./jobs/companyEmailStats.js');
  startCompanyEmailStatsJob(24);
} catch (err) {
  console.warn('Company email stats job not started:', err.message);
}

// Start nightly lead discovery job (runs at 2 AM server time)
try {
  const { startLeadDiscoveryJob } = await import('./jobs/leadDiscovery.js');
  startLeadDiscoveryJob({ runAtHour: 2, intervalHours: 24 });
} catch (err) {
  console.warn('Lead discovery job not started:', err.message);
}

// Start scheduled task runner (every 60s)
try {
  const { startScheduledTaskRunner } = await import('./jobs/scheduledTaskRunner.js');
  startScheduledTaskRunner(60000);
} catch (err) {
  console.warn('Scheduled task runner not started:', err.message);
}

// Overnight autonomous analysis (3 AM nightly)
try {
  const { startOvernightAnalysisJob } = await import('./jobs/overnightAnalysis.js');
  startOvernightAnalysisJob({ runAtHour: 3, intervalHours: 24 });
} catch (err) {
  console.warn('Overnight analysis job not started:', err.message);
}

// Daily intelligence newsletter (6 AM CT)
try {
  const { startDailyNewsletter } = await import('./jobs/dailyNewsletter.js');
  startDailyNewsletter({ runAtHour: 6, intervalHours: 24 });
} catch (err) {
  console.warn('Daily newsletter not started:', err.message);
}

// Assignment executor - polls confirmed assignments and executes via CLI tunnel
try {
  const { startAssignmentExecutor } = await import('./jobs/assignmentExecutor.js');
  startAssignmentExecutor(30000);
} catch (err) {
  console.warn('Assignment executor not started:', err.message);
}

// Chat health check - BBB heartbeat monitor (every 5 minutes)
try {
  const { startChatHealthCheck } = await import('./jobs/chatHealthCheck.js');
  startChatHealthCheck(5 * 60 * 1000);
} catch (err) {
  console.warn('Chat health check not started:', err.message);
}

// Phase 9 schedulers: NOT auto-started - enable via Settings or API
// POST /api/v1/insurance/schedulers/start to start them
// POST /api/v1/insurance/schedulers/stop to stop them

// Store connected clients
const clients = new Set();

// Handle WebSocket upgrade to route Recall audio vs regular clients
server.on('upgrade', (request, socket, head) => {
  const url = request.url || '';

  if (url.startsWith('/ws/recall-audio/')) {
    // Recall.ai real-time audio WebSocket - handle separately
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('recall-audio', ws, request);
    });
  } else {
    // Regular dashboard WebSocket
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

// Recall.ai real-time transcript WebSocket handler
wss.on('recall-audio', async (ws, req) => {
  let botId = null;
  console.log(`[WS] Recall transcript connection opened`);

  // Import voice loop to feed transcript events
  const { handleTranscriptEvent } = await import('./services/meetingVoiceLoop.js');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // Recall payload: { event: "transcript.data", data: { bot: { id }, data: { words, ... }, ... } }
      console.log(`[WS] Recall msg: ${JSON.stringify(msg).slice(0, 300)}`);
      const msgBotId = msg.data?.bot?.id || msg.bot?.id || msg.data?.bot_id;
      if (msgBotId && !botId) {
        botId = msgBotId;
        console.log(`[WS] Identified bot: ${botId}`);
      }
      const effectiveBotId = msgBotId || botId;
      if (!effectiveBotId) {
        console.log(`[WS] No botId found, skipping`);
      } else if (msg.event === 'transcript.data' || msg.type === 'transcript.data') {
        const transcriptPayload = msg.data?.data || msg.data;
        handleTranscriptEvent(effectiveBotId, { data: transcriptPayload });
      } else {
        console.log(`[WS] Unknown event type: ${msg.event || msg.type || 'none'}`);
      }
    } catch {
      // Not JSON - ignore
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Recall transcript disconnected for bot: ${botId || 'unknown'}`);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Recall transcript error for bot ${botId}:`, err.message);
  });
});

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('WebSocket client connected');

  ws.on('close', () => {
    clients.delete(ws);
    console.log('WebSocket client disconnected');
  });
});

// Broadcast to all clients
export function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

// Broadcast new activities to office visualization in real-time
onActivityInsert((activity) => {
  broadcast('office:activity', activity);
});

// =========================================================================
// Phase 8: Versioned API Routes (/api/v1/)
// =========================================================================

// Auth routes (no auth middleware - public)
app.use('/api/v1/auth', authRoutes);

// Email open tracking pixel (public - no auth)
app.get('/api/v1/track/open/:trackingId', (req, res) => {
  const { trackingId } = req.params;
  try {
    // trackingId format: tenantId__messageId (base64url encoded)
    const decoded = Buffer.from(trackingId, 'base64url').toString('utf-8');
    const [tenantId, messageId] = decoded.split('__');
    if (tenantId && messageId) {
      const { insertActivity, runWithTenant } = require('./cache/database.js');
      runWithTenant(tenantId, () => {
        insertActivity({
          tenantId,
          type: 'in',
          title: 'Email opened',
          subtitle: `Message ${messageId} was opened`,
          detailJson: JSON.stringify({ messageId, openedAt: new Date().toISOString(), ip: req.ip, userAgent: req.headers['user-agent'] }),
          sourceType: 'email-tracking',
          sourceId: messageId,
          agentId: 'email-guard',
        });
      });
      console.log(`[EmailTrack] Open tracked: ${tenantId} / ${messageId}`);
    }
  } catch {}
  // Return 1x1 transparent GIF
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({ 'Content-Type': 'image/gif', 'Content-Length': pixel.length, 'Cache-Control': 'no-cache, no-store, must-revalidate' });
  res.send(pixel);
});

// Tenant & user management
app.use('/api/v1/tenant', tenantRoutes);

// Partner access
app.use('/api/v1/partners', partnerRoutes);

// Sangha admin routes
app.use('/api/v1/admin', adminRoutes);

// Webhooks
app.use('/api/v1/webhooks', webhookRoutes);

// Phase 9: Insurance routes
app.use('/api/v1/insurance', insuranceRoutes);
app.use('/api/v1/admin/insurance', adminInsuranceRoutes);
app.use('/api/v1/lp', lpRoutes);
app.use('/api/v1/charts', sanghaChartRoutes);

// DACP Construction estimate routes
app.use('/api/v1/estimates', estimateRoutes);

// Lead Engine routes
app.use('/api/v1/lead-engine', leadEngineRoutes);

// All existing routes under /api/v1/ (versioned)
app.use('/api/v1/yahoo', yahooRoutes);
app.use('/api/v1/hashprice', hashpriceRoutes);
app.use('/api/v1/bitcoin', bitcoinRoutes);
app.use('/api/v1/uranium', uraniumRoutes);
app.use('/api/v1/pmi', pmiRoutes);
app.use('/api/v1/rareearth', rareEarthRoutes);
app.use('/api/v1/japan', japanRoutes);
app.use('/api/v1/trade', tradeRoutes);
app.use('/api/v1/datacenter', datacenterRoutes);
app.use('/api/v1/iran', iranRoutes);
app.use('/api/v1/brazil', brazilRoutes);
app.use('/api/v1/alerts', alertRoutes);
app.use('/api/v1/notes', notesRoutes);
app.use('/api/v1/correlation', correlationRoutes);
app.use('/api/v1/liquidity', liquidityRoutes);
app.use('/api/v1/energy', energyRoutes);
app.use('/api/v1/fleet', fleetRoutes);
app.use('/api/v1/curtailment', curtailmentRoutes);
app.use('/api/v1/pools', poolRoutes);
app.use('/api/v1/chain', chainRoutes);
app.use('/api/v1/diagnostics', diagnosticsRoutes);
app.use('/api/v1/agents', agentRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/workloads', workloadRoutes);
app.use('/api/v1/gpu', gpuRoutes);
app.use('/api/v1/hpc', hpcRoutes);
app.use('/api/v1/allocation', allocationRoutes);
app.use('/api/v1/bots', botsRoutes);
app.use('/api/v1/ercot/lmp', ercotLmpRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/workspace', workspaceRoutes);
app.use('/api/v1/approvals', approvalRoutes);
app.use('/api/v1/platform-notifications', platformNotificationRoutes);
app.use('/api/v1/knowledge', knowledgeRoutes);
app.use('/api/v1/files', filesRoutes);
app.use('/api/v1/hubspot', hubspotRoutes);
app.use('/api/v1/crm', crmRoutes);
app.use('/api/v1/jobs', jobsRoutes);
app.use('/api/v1/activity', activityRoutes);
app.use('/api/v1/report-comments', reportCommentRoutes);
app.use('/api/v1/voice', voiceRoutes);
app.use('/api/v1/recall', recallRoutes);
app.use('/api/v1/office', officeRoutes);
app.use('/api/v1/meetings', meetingsRoutes);
app.use('/api/v1/fireflies', firefliesRoutes);
app.use('/api/v1/auth/intuit', intuitRoutes);
app.use('/api/v1/accounting', accountingRoutes);
app.use('/api/v1/price-monitor', priceMonitorRoutes);
app.use('/api/v1/portfolio', portfolioRoutes);
app.use('/api/v1/scheduler', schedulerRoutes);
app.use('/api/v1/mcp-servers', mcpConfigRoutes);
app.use('/api/v1/ceo', ceoRoutes);

// =========================================================================
// Backward-compatible routes (/api/) - redirect to /api/v1/
// =========================================================================
app.use('/api/yahoo', yahooRoutes);
app.use('/api/hashprice', hashpriceRoutes);
app.use('/api/bitcoin', bitcoinRoutes);
app.use('/api/uranium', uraniumRoutes);
app.use('/api/pmi', pmiRoutes);
app.use('/api/rareearth', rareEarthRoutes);
app.use('/api/japan', japanRoutes);
app.use('/api/trade', tradeRoutes);
app.use('/api/datacenter', datacenterRoutes);
app.use('/api/iran', iranRoutes);
app.use('/api/brazil', brazilRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/correlation', correlationRoutes);
app.use('/api/liquidity', liquidityRoutes);
app.use('/api/energy', energyRoutes);
app.use('/api/fleet', fleetRoutes);
app.use('/api/curtailment', curtailmentRoutes);
app.use('/api/pools', poolRoutes);
app.use('/api/chain', chainRoutes);
app.use('/api/diagnostics', diagnosticsRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/workloads', workloadRoutes);
app.use('/api/gpu', gpuRoutes);
app.use('/api/hpc', hpcRoutes);
app.use('/api/allocation', allocationRoutes);
app.use('/api/bots', botsRoutes);
app.use('/api/lead-engine', leadEngineRoutes);
app.use('/api/ercot/lmp', ercotLmpRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/platform-notifications', platformNotificationRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/voice', voiceRoutes);

// =========================================================================
// OpenAPI documentation
// =========================================================================
try {
  const swaggerJsdoc = (await import('swagger-jsdoc')).default;
  const swaggerUi = (await import('swagger-ui-express')).default;

  const swaggerSpec = swaggerJsdoc({
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'Ampera API',
        version: '1.0.0',
        description: 'Multi-tenant mining operations platform API. Manage energy, fleet, curtailment, pools, agents, HPC workloads, and more.',
        contact: { name: 'Sangha', email: 'support@sangha.io' },
      },
      servers: [{ url: `/api/v1`, description: 'API v1' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKeyAuth: { type: 'apiKey', in: 'header', name: 'Authorization', description: 'Use "ApiKey mk_live_..." format' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    apis: ['./src/routes/*.js'],
  });

  app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Ampera API Docs',
  }));

  app.get('/api/v1/docs.json', (req, res) => res.json(swaggerSpec));
} catch (err) {
  console.warn('Swagger docs not available:', err.message);
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// SEO: serve robots.txt and sitemap.xml from project root
app.get('/robots.txt', (req, res) => res.sendFile(join(__dirname, '../../robots.txt')));
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Content-Type', 'application/xml');
  res.sendFile(join(__dirname, '../../sitemap.xml'));
});

// Serve voice-agent.html for Recall.ai output_media bots
app.get('/voice-agent', (req, res) => {
  res.sendFile(join(__dirname, '../public/voice-agent.html'));
});

// Serve static frontend files in production
const frontendPath = join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// SPA catch-all - serve index.html for all non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(join(frontendPath, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: err.message,
    cached: false,
    stale: true
  });
});

server.listen(PORT, async () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           AMPERA - BACKEND SERVER                   ║
║═══════════════════════════════════════════════════════════║
║  Server running on http://localhost:${PORT}                   ║
║  API v1:  http://localhost:${PORT}/api/v1/                    ║
║  API Docs: http://localhost:${PORT}/api/v1/docs               ║
║  WebSocket: ws://localhost:${PORT}                            ║
╚═══════════════════════════════════════════════════════════╝
  `);

  // Initialize Clawbot Agent Runtime (Phase 6)
  try {
    const { default: agentRuntime } = await import('./services/agentRuntime.js');
    const { default: CurtailmentAgent } = await import('./services/agents/curtailmentAgent.js');
    const { default: PoolOptimizationAgent } = await import('./services/agents/poolOptimizationAgent.js');
    const { default: AlertSynthesisAgent } = await import('./services/agents/alertSynthesisAgent.js');
    const { default: ReportingAgent } = await import('./services/agents/reportingAgent.js');

    agentRuntime.registerAgent(new CurtailmentAgent());
    agentRuntime.registerAgent(new PoolOptimizationAgent());
    agentRuntime.registerAgent(new AlertSynthesisAgent());
    agentRuntime.registerAgent(new ReportingAgent());

    // Wire AgentRuntime events to WebSocket broadcast for real-time office visualization
    const officeEvents = [
      'agent:started', 'agent:stopped', 'agent:action', 'agent:error',
      'agent:recommendation', 'agent:approval_requested', 'agent:rejected',
      'agent:registered', 'agent:unregistered', 'agent:downgraded', 'agent:auto_stopped',
    ];
    for (const eventName of officeEvents) {
      agentRuntime.on(eventName, (data) => {
        broadcast('office:agent-event', { event: eventName, ...data });
      });
    }

    console.log('Clawbot Agent Runtime initialized with 4 agents');
  } catch (err) {
    console.error('Failed to initialize agent runtime:', err.message);
  }

  // Verify SanghaModel simulator connectivity (Phase 9)
  verifySanghaModel();

  // Auto-connect enabled MCP servers for all tenants
  try {
    const { mcpManager } = await import('./services/mcpClientService.js');
    const { getMcpServers, getSystemDb } = await import('./cache/database.js');
    const sysDb = getSystemDb();
    const allTenants = sysDb.prepare('SELECT id FROM tenants').all();
    for (const tenant of allTenants) {
      const servers = getMcpServers(tenant.id);
      for (const server of servers.filter(s => s.enabled)) {
        try {
          await mcpManager.connect(tenant.id, server);
        } catch (e) {
          console.warn(`[MCP] Failed to connect "${server.name}" for tenant ${tenant.id}: ${e.message}`);
        }
      }
    }
  } catch (err) {
    console.warn('[MCP] MCP startup auto-connect skipped:', err.message);
  }
});
