'use strict';

const { v4: uuidv4 }    = require('uuid');
const { DEFAULT_SYMBOL_MAP } = require('./symbolMapper');

// ─── In-memory store ──────────────────────────────────────────────────────────
// In production: replace Maps with Postgres + Redis

class Store {
  constructor() {
    this._tokenMap   = new Map();   // token → userId
    this._users      = new Map();   // userId → user object
    this._log        = [];          // circular log (max 2000)
    this._logId      = 0;
    this._sigToday   = 0;
    this._dedupCache = new Map();   // `userId:sym:action` → timestamp

    // Reset daily counter at midnight
    this._scheduleDailyReset();

    // Bootstrap a demo user
    this._bootstrapDemo();
  }

  // ─── Token resolution ──────────────────────────────────────────────
  getUserByToken(token) {
    const userId = this._tokenMap.get(token);
    return userId ? this._users.get(userId) : null;
  }

  rotateToken(userId, newToken) {
    // Remove old tokens for this user
    for (const [t, uid] of this._tokenMap.entries()) {
      if (uid === userId) this._tokenMap.delete(t);
    }
    this._tokenMap.set(newToken, userId);
    const user = this._users.get(userId);
    if (user) user.webhookToken = newToken;
  }

  // ─── Duplicate detection ────────────────────────────────────────────
  isDuplicate(userId, symbol, action, windowSecs = 30) {
    const key  = `${userId}:${symbol}:${action}`;
    const last = this._dedupCache.get(key);
    const now  = Date.now();
    if (last && (now - last) < windowSecs * 1000) return true;
    this._dedupCache.set(key, now);
    return false;
  }

  // ─── Signal log ─────────────────────────────────────────────────────
  appendLog(entry) {
    this._log.unshift(entry);
    if (this._log.length > 2000) this._log.pop();
  }

  getLog(userId, limit = 100) {
    return this._log
      .filter(e => e.userId === userId)
      .slice(0, limit);
  }

  nextLogId() { return ++this._logId; }

  // ─── Stats helpers ────────────────────────────────────────────────
  incrementSignalsToday() { this._sigToday++; }
  getSignalsToday()       { return this._sigToday; }
  getTotalRoutes() {
    let n = 0;
    for (const user of this._users.values()) n += user.routes?.length || 0;
    return n;
  }

  // ─── Daily reset ──────────────────────────────────────────────────
  _scheduleDailyReset() {
    const now     = new Date();
    const midnight = new Date(now); midnight.setHours(24,0,0,0);
    setTimeout(() => {
      this._sigToday = 0;
      for (const user of this._users.values()) user.dailyPnl = 0;
      this._scheduleDailyReset();
    }, midnight - now);
  }

  // ─── Demo user bootstrap ─────────────────────────────────────────
  _bootstrapDemo() {
    const userId = 'user_demo';
    const token  = 'abc123xyz9f2e1';

    const user = {
      userId,
      webhookToken: token,
      routes: [
        { id: uuidv4(), name: 'FX → MT5 Live',        platform: 'mt5',       active: true,  symbols: ['EURUSD','GBPUSD','USDJPY'], multiplier: 1.0, orderType: 'MARKET' },
        { id: uuidv4(), name: 'US Futures → Tradovate',platform: 'tradovate', active: true,  symbols: ['ES1!','NQ1!','RTY1!','MNQ1!','MES1!'], multiplier: 1.0, orderType: 'MARKET' },
        { id: uuidv4(), name: 'Gold → DX Trade',       platform: 'dxtrade',   active: true,  symbols: ['XAUUSD','GC1!'], multiplier: 0.5, orderType: 'MARKET' },
        { id: uuidv4(), name: 'Crypto → DX Trade',     platform: 'dxtrade',   active: false, symbols: ['BTCUSD','ETHUSD'], multiplier: 1.0, orderType: 'MARKET' },
        { id: uuidv4(), name: 'Index Mirror (MT5)',     platform: 'mt5',       active: false, symbols: ['SPX','NDX','DJI'], multiplier: 2.0, orderType: 'MARKET' },
      ],
      symbolMap: { ...DEFAULT_SYMBOL_MAP },
      connectors: {
        mt5:       { type: 'mt5',       host: process.env.MT5_RELAY_HOST  || 'mt5-relay.signalbridge.io', apiKey: process.env.MT5_API_KEY   || '' },
        mt4:       { type: 'mt4',       host: process.env.MT4_RELAY_HOST  || 'mt4-relay.signalbridge.io', apiKey: process.env.MT4_API_KEY   || '' },
        dxtrade:   { type: 'dxtrade', host: process.env.DXTRADE_HOST || '', vendor: process.env.DXTRADE_VENDOR || '', username: process.env.DXTRADE_USERNAME || '', password: process.env.DXTRADE_PASSWORD || '', accountId: process.env.DXTRADE_ACCOUNT_ID || '', instrumentIds: {} },
        tradovate: { type: 'tradovate', host: process.env.TRADOVATE_HOST  || 'https://demo.tradovateapi.com', apiKey: process.env.TRADOVATE_API_KEY || '', accountSpec: process.env.TRADOVATE_ACCOUNT_SPEC || '' },
      },
      settings: {
        maxPositionSize:       parseFloat(process.env.DEFAULT_MAX_POSITION_SIZE)       || 10,
        dailyLossLimit:        parseFloat(process.env.DEFAULT_DAILY_LOSS_LIMIT)        || 500,
        maxSimultaneousTrades: parseInt(process.env.DEFAULT_MAX_SIMULTANEOUS_TRADES)   || 5,
        duplicateWindowSecs:   parseInt(process.env.DEFAULT_DUPLICATE_WINDOW_SECS)     || 30,
        haltOnDailyLoss:       true,
        reverseSignals:        false,
        emailAlerts:           false,
        hmacSecret:            '',
      },
      dailyPnl: 0,
    };

    this._users.set(userId, user);
    this._tokenMap.set(token, userId);
  }
}

const store = new Store();
module.exports = { store };
