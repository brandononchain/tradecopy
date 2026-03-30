'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { store } = require('../utils/store');

// ─── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers['x-api-token'] || req.params.token;
  const user  = store.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

// ─── Webhook token management ────────────────────────────────────────────────
router.post('/token/regenerate', auth, (req, res) => {
  const newToken = uuidv4().replace(/-/g, '');
  store.rotateToken(req.user.userId, newToken);
  res.json({ token: newToken });
});

// ─── Routes CRUD ─────────────────────────────────────────────────────────────
router.get('/routes', auth, (req, res) => {
  res.json(req.user.routes);
});

router.post('/routes', auth, (req, res) => {
  const { name, platform, symbols, multiplier, orderType, maxDrawdown } = req.body;
  if (!name || !platform) return res.status(400).json({ error: 'name and platform required' });

  const route = {
    id:          uuidv4(),
    name,
    platform,
    symbols:     symbols || [],
    multiplier:  parseFloat(multiplier) || 1.0,
    orderType:   orderType || 'MARKET',
    maxDrawdown: parseFloat(maxDrawdown) || 0,
    active:      true,
    createdAt:   new Date().toISOString(),
  };
  req.user.routes.push(route);
  res.status(201).json(route);
});

router.patch('/routes/:id', auth, (req, res) => {
  const route = req.user.routes.find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  const allowed = ['name','platform','symbols','multiplier','orderType','maxDrawdown','active'];
  allowed.forEach(k => { if (req.body[k] !== undefined) route[k] = req.body[k]; });
  res.json(route);
});

router.delete('/routes/:id', auth, (req, res) => {
  const before = req.user.routes.length;
  req.user.routes = req.user.routes.filter(r => r.id !== req.params.id);
  if (req.user.routes.length === before) return res.status(404).json({ error: 'Route not found' });
  res.json({ ok: true });
});

// ─── Symbol Map CRUD ──────────────────────────────────────────────────────────
router.get('/symbols', auth, (req, res) => {
  res.json(req.user.symbolMap);
});

router.post('/symbols', auth, (req, res) => {
  const { tvSymbol, platform, brokerSymbol, category, pointValue } = req.body;
  if (!tvSymbol || !platform || !brokerSymbol)
    return res.status(400).json({ error: 'tvSymbol, platform, brokerSymbol required' });

  const key = tvSymbol.toUpperCase();
  if (!req.user.symbolMap[key]) req.user.symbolMap[key] = {};
  req.user.symbolMap[key][platform]    = brokerSymbol;
  req.user.symbolMap[key].category     = category || 'fx';
  req.user.symbolMap[key].pointValue   = parseFloat(pointValue) || 1;
  res.json({ ok: true, key, mapping: req.user.symbolMap[key] });
});

router.put('/symbols', auth, (req, res) => {
  req.user.symbolMap = req.body;
  res.json({ ok: true });
});

router.delete('/symbols/:tvSymbol', auth, (req, res) => {
  const key = req.params.tvSymbol.toUpperCase();
  if (!req.user.symbolMap[key]) return res.status(404).json({ error: 'Symbol not found' });
  delete req.user.symbolMap[key];
  res.json({ ok: true });
});

// ─── Connectors ───────────────────────────────────────────────────────────────
router.get('/connectors', auth, (req, res) => {
  // Mask secrets
  const masked = {};
  for (const [k, v] of Object.entries(req.user.connectors)) {
    masked[k] = { ...v, apiKey: v.apiKey ? '***' + v.apiKey.slice(-4) : null };
  }
  res.json(masked);
});

router.put('/connectors/:platform', auth, (req, res) => {
  const platform = req.params.platform;
  if (!['mt4','mt5','dxtrade','tradovate'].includes(platform))
    return res.status(400).json({ error: 'Unknown platform' });
  req.user.connectors[platform] = { ...req.user.connectors[platform], ...req.body, type: platform };
  res.json({ ok: true });
});

// Test connection to a broker
router.post('/connectors/:platform/test', auth, async (req, res) => {
  const platform  = req.params.platform;
  const connector = req.user.connectors[platform];
  if (!connector) return res.status(404).json({ error: 'Connector not configured' });

  try {
    const adapter = require(`../adapters/${platform}`);
    const result  = await adapter.testConnection(connector);
    res.json({ status: 'ok', platform, ...result });
  } catch (err) {
    res.status(502).json({ status: 'error', platform, error: err.message });
  }
});

// ─── Settings ─────────────────────────────────────────────────────────────────
router.get('/settings', auth, (req, res) => {
  res.json(req.user.settings);
});

router.patch('/settings', auth, (req, res) => {
  const allowed = [
    'maxPositionSize','dailyLossLimit','maxSimultaneousTrades',
    'duplicateWindowSecs','haltOnDailyLoss','reverseSignals',
    'emailAlerts','hmacSecret'
  ];
  allowed.forEach(k => { if (req.body[k] !== undefined) req.user.settings[k] = req.body[k]; });
  res.json(req.user.settings);
});

// ─── Signal log ───────────────────────────────────────────────────────────────
router.get('/log', auth, (req, res) => {
  const limit    = Math.min(parseInt(req.query.limit)  || 100, 500);
  const platform = req.query.platform;
  const status   = req.query.status;

  let entries = store.getLog(req.user.userId, 500);

  if (platform) entries = entries.filter(e =>
    e.results?.some(r => r.platform === platform));
  if (status)   entries = entries.filter(e =>
    e.results?.some(r => r.status === status));

  res.json(entries.slice(0, limit));
});

// ─── Stats ────────────────────────────────────────────────────────────────────
router.get('/stats', auth, (req, res) => {
  const entries = store.getLog(req.user.userId, 500);
  const today   = entries.filter(e => {
    const d = new Date(e.ts);
    const n = new Date();
    return d.toDateString() === n.toDateString();
  });

  const successes = today.flatMap(e => e.results || []).filter(r => r.status === 'ok').length;
  const total     = today.flatMap(e => e.results || []).length;

  res.json({
    signalsToday:  today.length,
    successRate:   total ? ((successes / total) * 100).toFixed(1) : '100.0',
    activeRoutes:  req.user.routes.filter(r => r.active).length,
    totalRoutes:   req.user.routes.length,
  });
});

module.exports = router;
