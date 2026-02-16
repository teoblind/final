import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { initDatabase } from './cache/database.js';

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
import manualRoutes from './routes/manual.js';
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

// Phase 8: New route modules
import authRoutes from './routes/auth.js';
import tenantRoutes from './routes/tenant.js';
import partnerRoutes from './routes/partners.js';
import adminRoutes from './routes/admin.js';
import webhookRoutes from './routes/webhooks.js';

// Phase 9: Insurance integration routes
import insuranceRoutes from './routes/insurance.js';
import adminInsuranceRoutes from './routes/adminInsurance.js';

import { startRefreshScheduler } from './jobs/liquidityRefresh.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json());

// Initialize database (includes Phase 8 tables)
initDatabase();

// Start liquidity data refresh scheduler (every 5 minutes)
startRefreshScheduler(5);

// Start webhook retry scheduler
try {
  const { startWebhookRetryScheduler } = await import('./services/webhookService.js');
  startWebhookRetryScheduler(2);
} catch (err) {
  console.warn('Webhook retry scheduler not started:', err.message);
}

// Phase 9 schedulers: NOT auto-started — enable via Settings or API
// POST /api/v1/insurance/schedulers/start to start them
// POST /api/v1/insurance/schedulers/stop to stop them

// Store connected clients
const clients = new Set();

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

// =========================================================================
// Phase 8: Versioned API Routes (/api/v1/)
// =========================================================================

// Auth routes (no auth middleware — public)
app.use('/api/v1/auth', authRoutes);

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
app.use('/api/v1/manual', manualRoutes);
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

// =========================================================================
// Backward-compatible routes (/api/) — redirect to /api/v1/
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
app.use('/api/manual', manualRoutes);
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

    console.log('Clawbot Agent Runtime initialized with 4 agents');
  } catch (err) {
    console.error('Failed to initialize agent runtime:', err.message);
  }
});
