'use strict';

const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 }   = require('uuid');
const { log }          = require('./logger');
const { DEFAULT_SYMBOL_MAP } = require('./symbolMapper');

// ─── Supabase client ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
// Server always uses service_role key — bypasses RLS so the server has full access.
// The anon key is locked down via RLS deny-all policies (safe to expose in dashboard JS).
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon (WARNING: use service_role in production)';
  log.info(`[Store] Supabase persistence enabled (${keyType})`);
} else {
  log.warn('[Store] No SUPABASE_URL — using in-memory store (data lost on restart)');
}

// ─── In-memory cache (always present, Supabase writes through) ────────────────
const _tokenMap   = new Map();  // token → userId
const _users      = new Map();  // userId → user object
const _log        = [];         // signal log (max 500 in memory)
let   _logId      = 0;
let   _sigToday   = 0;
const _dedupCache = new Map();

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function dbGet(table, userId) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from(table).select('*').eq('user_id', userId).single();
    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
    return data;
  } catch (e) { log.error(`[DB] GET ${table}:`, e.message); return null; }
}

async function dbUpsert(table, payload) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from(table).upsert(payload, { onConflict: 'user_id' });
    if (error) throw error;
  } catch (e) { log.error(`[DB] UPSERT ${table}:`, e.message); }
}

// ─── User loading ─────────────────────────────────────────────────────────────
async function loadOrCreateUser(userId, token) {
  if (_users.has(userId)) return _users.get(userId);

  // Build base user with defaults
  const user = {
    userId,
    webhookToken: token,
    routes:       [],
    symbolMap:    { ...DEFAULT_SYMBOL_MAP },
    connectors: {
      mt5:       { type: 'mt5',       host: '', apiKey: '' },
      mt4:       { type: 'mt4',       host: '', apiKey: '' },
      dxtrade:   { type: 'dxtrade',   host: '', vendor: '', username: '', password: '', accountId: '', instrumentIds: {} },
      tradovate: { type: 'tradovate', host: 'https://demo.tradovateapi.com', apiKey: '', accountSpec: '' },
    },
    settings: {
      maxPositionSize:       parseFloat(process.env.DEFAULT_MAX_POSITION_SIZE)     || 10,
      dailyLossLimit:        parseFloat(process.env.DEFAULT_DAILY_LOSS_LIMIT)      || 500,
      maxSimultaneousTrades: parseInt(process.env.DEFAULT_MAX_SIMULTANEOUS_TRADES) || 5,
      duplicateWindowSecs:   parseInt(process.env.DEFAULT_DUPLICATE_WINDOW_SECS)   || 30,
      haltOnDailyLoss:       true,
      reverseSignals:        false,
      emailAlerts:           false,
      hmacSecret:            '',
    },
    dailyPnl: 0,
  };

  if (supabase) {
    // Load routes
    try {
      const { data: routes } = await supabase.from('sb_routes').select('*').eq('user_id', userId);
      if (routes?.length) {
        user.routes = routes.map(r => ({
          id:          r.id,
          name:        r.name,
          platform:    r.platform,
          symbols:     r.symbols || [],
          multiplier:  parseFloat(r.multiplier),
          orderType:   r.order_type,
          maxDrawdown: parseFloat(r.max_drawdown),
          active:      r.active,
          createdAt:   r.created_at,
        }));
      }
    } catch (e) { log.error('[DB] Load routes:', e.message); }

    // Load connectors
    const connRow = await dbGet('sb_connectors', userId);
    if (connRow?.data) Object.assign(user.connectors, connRow.data);

    // Load symbol map
    const symRow = await dbGet('sb_symbol_map', userId);
    if (symRow?.data) user.symbolMap = { ...DEFAULT_SYMBOL_MAP, ...symRow.data };

    // Load settings
    const setRow = await dbGet('sb_settings', userId);
    if (setRow?.data) Object.assign(user.settings, setRow.data);
  }

  _users.set(userId, user);
  _tokenMap.set(token, userId);
  log.info(`[Store] Loaded user ${userId} (${user.routes.length} routes)`);
  return user;
}

// ─── Public Store API ─────────────────────────────────────────────────────────
const store = {
  // ── Token resolution ────────────────────────────────────────────────────────
  getUserByToken(token) {
    const userId = _tokenMap.get(token);
    return userId ? _users.get(userId) : null;
  },

  async rotateToken(userId, newToken) {
    // Remove old token mapping
    for (const [t, uid] of _tokenMap.entries()) {
      if (uid === userId) _tokenMap.delete(t);
    }
    _tokenMap.set(newToken, userId);
    const user = _users.get(userId);
    if (user) user.webhookToken = newToken;
    // Persist
    if (supabase) {
      try {
        await supabase.from('sb_users').update({ token: newToken }).eq('id', userId);
      } catch (e) { log.error('[DB] rotateToken:', e.message); }
    }
  },

  // ── Routes ──────────────────────────────────────────────────────────────────
  async saveRoute(userId, route) {
    if (!supabase) return;
    try {
      await supabase.from('sb_routes').upsert({
        id:           route.id,
        user_id:      userId,
        name:         route.name,
        platform:     route.platform,
        symbols:      route.symbols || [],
        multiplier:   route.multiplier,
        order_type:   route.orderType,
        max_drawdown: route.maxDrawdown || 0,
        active:       route.active,
      }, { onConflict: 'id' });
    } catch (e) { log.error('[DB] saveRoute:', e.message); }
  },

  async deleteRoute(userId, routeId) {
    if (!supabase) return;
    try {
      await supabase.from('sb_routes').delete().eq('id', routeId).eq('user_id', userId);
    } catch (e) { log.error('[DB] deleteRoute:', e.message); }
  },

  // ── Connectors ──────────────────────────────────────────────────────────────
  async saveConnectors(userId, connectors) {
    await dbUpsert('sb_connectors', { user_id: userId, data: connectors });
  },

  // ── Symbol map ──────────────────────────────────────────────────────────────
  async saveSymbolMap(userId, symbolMap) {
    await dbUpsert('sb_symbol_map', { user_id: userId, data: symbolMap });
  },

  // ── Settings ────────────────────────────────────────────────────────────────
  async saveSettings(userId, settings) {
    await dbUpsert('sb_settings', { user_id: userId, data: settings });
  },

  // ── Dedup ────────────────────────────────────────────────────────────────────
  isDuplicate(userId, symbol, action, windowSecs = 30) {
    const key  = `${userId}:${symbol}:${action}`;
    const last = _dedupCache.get(key);
    const now  = Date.now();
    if (last && (now - last) < windowSecs * 1000) return true;
    _dedupCache.set(key, now);
    return false;
  },

  // ── Signal log ───────────────────────────────────────────────────────────────
  appendLog(entry) {
    _log.unshift(entry);
    if (_log.length > 500) _log.pop();
    // Async persist to Supabase (don't await — don't block signal path)
    if (supabase) {
      supabase.from('sb_signal_log').insert({
        user_id: entry.userId,
        ts:      entry.ts,
        signal:  entry.signal,
        results: entry.results,
        ip:      entry.ip || null,
      }).then(({ error }) => {
        if (error) log.error('[DB] appendLog:', error.message);
      });
    }
  },

  getLog(userId, limit = 100) {
    return _log.filter(e => e.userId === userId).slice(0, limit);
  },

  nextLogId()              { return ++_logId; },
  incrementSignalsToday()  { _sigToday++; },
  getSignalsToday()        { return _sigToday; },
  getTotalRoutes() {
    let n = 0;
    for (const u of _users.values()) n += u.routes?.length || 0;
    return n;
  },

  // ── Daily reset ───────────────────────────────────────────────────────────────
  _scheduleDailyReset() {
    const now      = new Date();
    const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
    setTimeout(() => {
      _sigToday = 0;
      for (const u of _users.values()) u.dailyPnl = 0;
      this._scheduleDailyReset();
    }, midnight - now);
  },

  // ── Bootstrap ────────────────────────────────────────────────────────────────
  async bootstrap() {
    this._scheduleDailyReset();
    if (supabase) {
      // Load all users from DB
      try {
        const { data: users, error } = await supabase.from('sb_users').select('id, token');
        if (error) throw error;
        for (const u of users) {
          await loadOrCreateUser(u.id, u.token);
        }
        log.info(`[Store] Bootstrapped ${users.length} user(s) from Supabase`);
      } catch (e) {
        log.error('[Store] Bootstrap failed, falling back to in-memory:', e.message);
        this._bootstrapDemo();
      }
    } else {
      this._bootstrapDemo();
    }
  },

  _bootstrapDemo() {
    const userId = 'user_demo';
    const token  = 'abc123xyz9f2e1';
    const user = {
      userId,
      webhookToken: token,
      routes: [],
      symbolMap:    { ...DEFAULT_SYMBOL_MAP },
      connectors: {
        mt5:       { type: 'mt5',       host: '', apiKey: '' },
        mt4:       { type: 'mt4',       host: '', apiKey: '' },
        dxtrade:   { type: 'dxtrade',   host: '', vendor: '', username: '', password: '', accountId: '', instrumentIds: {} },
        tradovate: { type: 'tradovate', host: 'https://demo.tradovateapi.com', apiKey: '', accountSpec: '' },
      },
      settings: {
        maxPositionSize: 10, dailyLossLimit: 500, maxSimultaneousTrades: 5,
        duplicateWindowSecs: 30, haltOnDailyLoss: true, reverseSignals: false,
        emailAlerts: false, hmacSecret: '',
      },
      dailyPnl: 0,
    };
    _users.set(userId, user);
    _tokenMap.set(token, userId);
    log.info('[Store] In-memory demo user ready');
  },
};

module.exports = { store, loadOrCreateUser };
