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
const wss    = new WebSocket.Server({ noServer: true });

const DASHBOARD = path.join(__dirname, '..', 'dashboard');

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '16kb' }));
app.use(express.static(DASHBOARD));

// Rate limit webhooks
app.use('/hook', rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_PER_MIN) || 60,
  message: { error: 'Rate limit exceeded' },
}));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/hook', webhookRouter);
app.use('/api',  apiRouter);

// Serve EA file download
app.get('/ea/:file', (req, res) => {
  const eaPath = path.join(__dirname, '..', 'ea', req.params.file);
  res.download(eaPath, req.params.file, err => {
    if (err) res.status(404).json({ error: 'File not found' });
  });
});

app.get('/health', (_req, res) => res.json({
  status:       'ok',
  version:      '2.1.0',
  ts:           new Date().toISOString(),
  routes:       store.getTotalRoutes(),
  signalsToday: store.getSignalsToday(),
}));

// SPA fallback — serve dashboard for all non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/hook') || req.path.startsWith('/health')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(DASHBOARD, 'index.html'));
});

// Error handler
app.use((err, _req, res, _next) => {
  log.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── WebSocket upgrade — token auth ──────────────────────────────────────────
server.on('upgrade', (req, socket, head) => {
  const url   = new URL(req.url, 'ws://x');
  const token = url.searchParams.get('token');
  const user  = store.getUserByToken(token);

  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.userId = user.userId;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  log.info(`[WS] Dashboard connected: ${ws.userId}`);
  ws.on('close', () => log.info(`[WS] Disconnected: ${ws.userId}`));
  ws.on('error', (e) => log.error('[WS] Error:', e.message));
});

// Expose wss for routes to broadcast
app.set('wss', wss);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// Bootstrap store (loads all users from Supabase) then start listening
store.bootstrap().then(() => {
  server.listen(PORT, () => {
    log.info(`Tradekashi running on :${PORT}`);
    log.info(`Dashboard: ${DASHBOARD}`);
    log.info(`Supabase: ${process.env.SUPABASE_URL ? 'connected' : 'in-memory fallback'}`);
  });
}).catch(err => {
  log.error('Bootstrap failed:', err.message);
  process.exit(1);
});

module.exports = { app, server, wss };
