'use strict';

require('dotenv').config();
const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const WebSocket    = require('ws');
const http         = require('http');
const path         = require('path');

const webhookRouter = require('./routes/webhook');
const apiRouter     = require('./routes/api');
const { store }     = require('./utils/store');
const { log }       = require('./utils/logger');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// Absolute path to dashboard — works regardless of where node is invoked from
const DASHBOARD = path.join(__dirname, '..', 'dashboard');

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '16kb' }));

// Serve dashboard static files
app.use(express.static(DASHBOARD));

// Rate limit webhook endpoint: 60 req/min per IP
app.use('/hook', rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Rate limit exceeded' },
}));

// ─── API + Webhook routes ─────────────────────────────────────────────────────
app.use('/hook', webhookRouter);
app.use('/api',  apiRouter);

app.get('/health', (_req, res) => res.json({
  status: 'ok',
  version: '2.1.0',
  ts: new Date().toISOString(),
  routes: store.getTotalRoutes(),
  signalsToday: store.getSignalsToday(),
}));

// Catch-all: serve dashboard index.html for any non-API route
// This makes the SPA work even on direct URL loads
app.get('*', (req, res) => {
  // Don't serve HTML for /api or /hook routes (already handled above)
  if (req.path.startsWith('/api') || req.path.startsWith('/hook')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(DASHBOARD, 'index.html'));
});

// Error handler
app.use((err, _req, res, _next) => {
  log.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── WebSocket (live dashboard feed) ─────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const url   = new URL(req.url, 'ws://x');
  const token = url.searchParams.get('token');
  const user  = store.getUserByToken(token);

  if (!user) {
    ws.close(1008, 'Unauthorized');
    return;
  }

  ws.userId = user.userId;
  log.info(`[WS] Dashboard connected: ${user.userId}`);
  ws.on('close', () => log.info(`[WS] Dashboard disconnected: ${user.userId}`));
  ws.on('error', (err) => log.error('[WS] Error:', err.message));
});

app.set('wss', wss);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log.info(`SignalBridge relay started on :${PORT}`);
  log.info(`Dashboard: http://localhost:${PORT}`);
  log.info(`Webhook:   POST http://localhost:${PORT}/hook/:token/signal`);
  log.info(`Dashboard files: ${DASHBOARD}`);
});

module.exports = { app, server, wss };
