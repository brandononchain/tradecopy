'use strict';

require('dotenv').config();
const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const WebSocket    = require('ws');
const http         = require('http');

const webhookRouter    = require('./routes/webhook');
const apiRouter        = require('./routes/api');
const { store }        = require('./utils/store');
const { log }          = require('./utils/logger');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '16kb' }));
app.use(express.static('dashboard'));

// Rate limit webhook endpoint: 60 req/min per IP
app.use('/hook', rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Rate limit exceeded' },
}));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/hook',  webhookRouter);
app.use('/api',   apiRouter);

app.get('/health', (_req, res) => res.json({
  status: 'ok',
  version: '2.1.0',
  ts: new Date().toISOString(),
  routes: store.getTotalRoutes(),
  signalsToday: store.getSignalsToday(),
}));

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

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

// Expose wss so routes can broadcast
app.set('wss', wss);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log.info(`SignalBridge relay started on :${PORT}`);
  log.info(`Dashboard: http://localhost:${PORT}`);
  log.info(`Webhook:   POST http://localhost:${PORT}/hook/:token/signal`);
});

module.exports = { app, server, wss };
