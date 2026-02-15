import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { initDatabase } from './cache/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
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
import { startRefreshScheduler } from './jobs/liquidityRefresh.js';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
initDatabase();

// Start liquidity data refresh scheduler (every 5 minutes)
startRefreshScheduler(5);

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

// API Routes
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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
║           SANGHA MINEOS - BACKEND SERVER                   ║
║═══════════════════════════════════════════════════════════║
║  Server running on http://localhost:${PORT}                   ║
║  WebSocket available on ws://localhost:${PORT}                ║
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
