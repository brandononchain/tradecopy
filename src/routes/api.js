'use strict';

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { store } = require('../utils/store');

// ─── Auth ─────────────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers['x-api-token'] || req.params.token;
  const user  = store.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

// ─── Token ────────────────────────────────────────────────────────────────────
router.post('/token/regenerate', auth, async (req, res) => {
  const newToken = uuidv4().replace(/-/g, '');
  await store.rotateToken(req.user.userId, newToken);
  res.json({ token: newToken });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
router.get('/routes', auth, (req, res) => {
  res.json(req.user.routes);
});

router.post('/routes', auth, async (req, res) => {
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
    active:      req.body.active !== false,
    createdAt:   new Date().toISOString(),
  };
  req.user.routes.push(route);
  await store.saveRoute(req.user.userId, route);
  res.status(201).json(route);
});

router.patch('/routes/:id', auth, async (req, res) => {
  const route = req.user.routes.find(r => r.id === req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  const allowed = ['name','platform','symbols','multiplier','orderType','maxDrawdown','active'];
  allowed.forEach(k => { if (req.body[k] !== undefined) route[k] = req.body[k]; });
  await store.saveRoute(req.user.userId, route);
  res.json(route);
});

router.delete('/routes/:id', auth, async (req, res) => {
  const before = req.user.routes.length;
  req.user.routes = req.user.routes.filter(r => r.id !== req.params.id);
  if (req.user.routes.length === before) return res.status(404).json({ error: 'Route not found' });
  await store.deleteRoute(req.user.userId, req.params.id);
  res.json({ ok: true });
});

// ─── Symbol map ───────────────────────────────────────────────────────────────
router.get('/symbols', auth, (req, res) => {
  res.json(req.user.symbolMap);
});

router.post('/symbols', auth, async (req, res) => {
  const { tvSymbol, platform, brokerSymbol, category, pointValue } = req.body;
  if (!tvSymbol || !platform || !brokerSymbol)
    return res.status(400).json({ error: 'tvSymbol, platform, brokerSymbol required' });
  const key = tvSymbol.toUpperCase();
  if (!req.user.symbolMap[key]) req.user.symbolMap[key] = {};
  req.user.symbolMap[key][platform]  = brokerSymbol;
  req.user.symbolMap[key].category   = category || 'fx';
  req.user.symbolMap[key].pointValue = parseFloat(pointValue) || 1;
  await store.saveSymbolMap(req.user.userId, req.user.symbolMap);
  res.json({ ok: true, key, mapping: req.user.symbolMap[key] });
});

router.put('/symbols', auth, async (req, res) => {
  req.user.symbolMap = req.body;
  await store.saveSymbolMap(req.user.userId, req.user.symbolMap);
  res.json({ ok: true });
});

router.delete('/symbols/:tvSymbol', auth, async (req, res) => {
  const key = req.params.tvSymbol.toUpperCase();
  if (!req.user.symbolMap[key]) return res.status(404).json({ error: 'Symbol not found' });
  delete req.user.symbolMap[key];
  await store.saveSymbolMap(req.user.userId, req.user.symbolMap);
  res.json({ ok: true });
});

// ─── Connectors ───────────────────────────────────────────────────────────────
router.get('/connectors', auth, (req, res) => {
  const masked = {};
  for (const [k, v] of Object.entries(req.user.connectors)) {
    masked[k] = { ...v };
    if (masked[k].password)  masked[k].password  = masked[k].password  ? '••••••••' : null;
    if (masked[k].apiKey)    masked[k].apiKey    = masked[k].apiKey    ? '***' + String(masked[k].apiKey).slice(-4)    : null;
    if (masked[k].appSecret) masked[k].appSecret = masked[k].appSecret ? '***' + String(masked[k].appSecret).slice(-4) : null;
  }
  res.json(masked);
});

router.put('/connectors/:platform', auth, async (req, res) => {
  const platform = req.params.platform;
  if (!['mt4','mt5','dxtrade','tradovate'].includes(platform))
    return res.status(400).json({ error: 'Unknown platform' });

  const existing = req.user.connectors[platform] || {};
  const incoming = { ...req.body };

  // Don't overwrite with masked values
  if (incoming.password  === '••••••••')             delete incoming.password;
  if (incoming.apiKey    && incoming.apiKey.startsWith('***'))    delete incoming.apiKey;
  if (incoming.appSecret && incoming.appSecret.startsWith('***')) delete incoming.appSecret;

  // Strip trailing slashes from host
  if (incoming.host) incoming.host = incoming.host.replace(/\/+$/, '');

  req.user.connectors[platform] = { ...existing, ...incoming, type: platform };

  // Persist all connectors together
  await store.saveConnectors(req.user.userId, req.user.connectors);
  res.json({ ok: true });
});

router.post('/connectors/:platform/test', auth, async (req, res) => {
  const platform  = req.params.platform;
  const connector = req.user.connectors[platform];
  if (!connector) return res.status(404).json({ error: 'Connector not configured' });

  if (!connector.host || connector.host.trim() === '') {
    return res.status(200).json({
      status: 'error', platform,
      error: `No host configured for ${platform}. Fill in and save the connector first.`
    });
  }

  try {
    const adapter = require(`../adapters/${platform}`);
    const result  = await adapter.testConnection(connector);
    res.json({ status: 'ok', platform, ...result });
  } catch (err) {
    res.status(200).json({ status: 'error', platform, error: err.message });
  }
});

// ─── Settings ─────────────────────────────────────────────────────────────────
router.get('/settings', auth, (req, res) => {
  res.json(req.user.settings);
});

router.patch('/settings', auth, async (req, res) => {
  const allowed = [
    'maxPositionSize','dailyLossLimit','maxSimultaneousTrades',
    'duplicateWindowSecs','haltOnDailyLoss','reverseSignals',
    'emailAlerts','hmacSecret'
  ];
  allowed.forEach(k => { if (req.body[k] !== undefined) req.user.settings[k] = req.body[k]; });
  await store.saveSettings(req.user.userId, req.user.settings);
  res.json(req.user.settings);
});

// ─── Signal log ───────────────────────────────────────────────────────────────
router.get('/log', auth, (req, res) => {
  const limit    = Math.min(parseInt(req.query.limit) || 100, 500);
  const platform = req.query.platform;
  const status   = req.query.status;
  let entries    = store.getLog(req.user.userId, 500);
  if (platform) entries = entries.filter(e => e.results?.some(r => r.platform === platform));
  if (status)   entries = entries.filter(e => e.results?.some(r => r.status   === status));
  res.json(entries.slice(0, limit));
});

// ─── Stats ────────────────────────────────────────────────────────────────────
router.get('/stats', auth, (req, res) => {
  const entries   = store.getLog(req.user.userId, 500);
  const today     = entries.filter(e => new Date(e.ts).toDateString() === new Date().toDateString());
  const allRes    = today.flatMap(e => e.results || []);
  const successes = allRes.filter(r => r.status === 'ok').length;
  res.json({
    signalsToday: today.length,
    successRate:  allRes.length ? ((successes / allRes.length) * 100).toFixed(1) : '100.0',
    activeRoutes: req.user.routes.filter(r => r.active).length,
    totalRoutes:  req.user.routes.length,
  });
});

module.exports = router;
