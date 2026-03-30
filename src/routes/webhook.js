'use strict';

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { store }          = require('../utils/store');
const { log }            = require('../utils/logger');
const { validateSignal } = require('../utils/validator');
const { routeSignal }    = require('../utils/router');
const mapSymbol          = require('../utils/symbolMapper');

// ─── Middleware: resolve token → user ────────────────────────────────────────
function resolveToken(req, res, next) {
  const token = req.params.token;
  const user  = store.getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Invalid webhook token' });
  req.user = user;
  next();
}

// ─── Optional HMAC signature verification ────────────────────────────────────
function verifyHmac(req, res, next) {
  const user = req.user;
  if (!user.settings.hmacSecret) return next();

  const sig = req.headers['x-signature-256'] || req.headers['x-tv-signature'];
  if (!sig) return res.status(401).json({ error: 'Missing HMAC signature' });

  const expected = 'sha256=' + crypto
    .createHmac('sha256', user.settings.hmacSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }
  next();
}

// ─── Shared: does a route match this symbol? ─────────────────────────────────
function routeMatchesSymbol(route, symbol) {
  if (!route.active) return false;
  if (!route.symbols || route.symbols.length === 0) return true; // blank = all
  return route.symbols.map(s => s.toUpperCase()).includes(symbol.toUpperCase());
}

// ─── POST /hook/:token/signal ─────────────────────────────────────────────────
router.post('/:token/signal', resolveToken, verifyHmac, async (req, res) => {
  const user    = req.user;
  const rawBody = req.body;

  // 1. Validate
  const { valid, errors, signal } = validateSignal(rawBody);
  if (!valid) {
    log.warn(`[WEBHOOK] Invalid payload from ${req.ip}:`, errors);
    return res.status(400).json({ error: 'Invalid signal payload', details: errors });
  }

  // 2. Duplicate signal guard
  if (store.isDuplicate(user.userId, signal.symbol, signal.action, user.settings.duplicateWindowSecs)) {
    log.info(`[WEBHOOK] Duplicate ignored: ${signal.action} ${signal.symbol}`);
    return res.json({ status: 'ignored', reason: 'Duplicate signal within dedup window' });
  }

  // 3. Daily loss limit check
  if (user.settings.haltOnDailyLoss && user.dailyPnl <= -user.settings.dailyLossLimit) {
    log.warn(`[WEBHOOK] Trading halted: daily loss limit reached for ${user.userId}`);
    return res.json({ status: 'halted', reason: 'Daily loss limit reached' });
  }

  // 4. Route signal to brokers
  const results = await routeSignal(user, signal, req.app.get('wss'));

  // 5. Persist log entry
  const entry = {
    id:     store.nextLogId(),
    ts:     new Date().toISOString(),
    signal,
    results,
    ip:     req.ip,
    userId: user.userId,
  };
  store.appendLog(entry);
  store.incrementSignalsToday();

  log.info(`[SIGNAL] ${signal.action.toUpperCase()} ${signal.symbol} x${signal.qty} → ${results.length} routes`);
  res.json({ status: 'processed', signal, results });
});

// ─── POST /hook/:token/test — dry-run, respects symbol filters ───────────────
router.post('/:token/test', resolveToken, async (req, res) => {
  const user = req.user;
  const { symbol = 'EURUSD', action = 'buy', qty = 1, sl, tp } = req.body;
  const symUpper = symbol.toUpperCase();

  // Apply EXACT same routing logic as live signals, including symbol filters
  const results = user.routes
    .filter(r => routeMatchesSymbol(r, symUpper))
    .map(r => ({
      route:        r.name,
      platform:     r.platform,
      brokerSymbol: mapSymbol(symUpper, r.platform, user.symbolMap),
      qty:          parseFloat(qty) * (r.multiplier || 1),
      ...(sl ? { sl } : {}),
      ...(tp ? { tp } : {}),
      status:       'simulated',
    }));

  res.json({ status: 'test_ok', symbol: symUpper, action, qty, results });
});

module.exports = router;
