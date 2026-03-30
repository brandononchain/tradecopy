'use strict';

/**
 * DX Trade CFD Adapter
 *
 * Confirmed endpoint structure (tested against demo.dx.trade + dxtrade.ftmo.com):
 *
 *   POST /api/auth/login   { username, password, vendor }
 *     → 200 { token, loginStatusTO: { status, statusCode } }
 *     → Sets JSESSIONID + DXTFID cookies
 *
 *   GET  /                 → HTML page containing <meta name="csrf" content="...">
 *
 *   POST /api/orders/single  { legs, orderSide, orderType, quantity, limitPrice, ... }
 *     → Headers: Cookie, X-Csrf-Token, X-Requested-With
 *
 * "vendor" = the broker subdomain prefix used at login time.
 * For most white-label DX Trade brokers: leave blank or use the subdomain.
 * For FTMO: vendor = "ftmo"
 * For Liquid Charts: try blank first, then "liquidcharts"
 *
 * Instrument IDs are numeric broker-specific values required in the order payload.
 * Find yours by: login to the platform → open DevTools → Network tab →
 * place a manual trade → inspect the POST to /api/orders/single → note instrumentId.
 */

const axios  = require('axios');
const https  = require('https');
const { log } = require('../utils/logger');

// ─── Session cache ────────────────────────────────────────────────────────────
// Keyed by `${host}:${username}` → { axiosInstance, csrf, createdAt }
const sessionCache = new Map();

// ─── Known instrument IDs per broker host ────────────────────────────────────
// These are the numeric IDs DX Trade requires alongside the symbol string.
// Override via connector.instrumentIds = { "EURUSD": 1234, ... }
const KNOWN_IDS = {
  // FTMO / generic DX Trade CFD (from community reverse-engineering)
  'EURUSD': 3438, 'GBPUSD': 3440, 'USDJPY': 3427, 'USDCAD': 3433,
  'USDCHF': 3390, 'AUDUSD': 3411, 'NZDUSD': 3398, 'EURGBP': 3419,
  'EURJPY': 3392, 'AUDCHF': 3395, 'GBPJPY': 3420,
  'XAUUSD': 3406, 'XAGUSD': 3407,
  'US30':   3351, 'NAS100': 3353, 'US500':  3352, 'UK100': 3354,
  'DE40':   3355, 'JP225':  3356,
  'BTCUSD': 3425, 'ETHUSD': 3443,
  'USOIL':  3360, 'NATGAS': 3362,
};

// ─── HTTP client factory ──────────────────────────────────────────────────────
function makeClient(host) {
  const cookieJar = {};

  const instance = axios.create({
    baseURL: `https://${host}`,
    timeout: 12000,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    maxRedirects: 5,
  });

  // Accumulate cookies from every response
  instance.interceptors.response.use(res => {
    const raw = res.headers['set-cookie'] || [];
    raw.forEach(entry => {
      const [pair] = entry.split(';');
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        cookieJar[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
      }
    });
    return res;
  });

  // Inject accumulated cookies on every request
  instance.interceptors.request.use(cfg => {
    const cookieStr = Object.entries(cookieJar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieStr) cfg.headers['Cookie'] = cookieStr;
    return cfg;
  });

  return { instance, cookieJar };
}

// ─── Login + CSRF ─────────────────────────────────────────────────────────────
async function createSession(connector) {
  const { host, username, password, vendor = '' } = connector;
  const { instance } = makeClient(host);

  // Step 1: POST /api/auth/login
  const loginRes = await instance.post('/api/auth/login', {
    username,
    password,
    vendor,
  }, {
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  });

  const loginData = loginRes.data;

  // Check login success
  const status = loginData?.loginStatusTO?.status
    ?? loginData?.loginInfoTO?.status;

  if (status === false) {
    const code = loginData?.loginStatusTO?.statusCode
      || loginData?.loginInfoTO?.errorMessage
      || 'INVALID_CREDENTIALS';
    throw new Error(`DX Trade login failed: ${code}`);
  }

  log.info(`[DXTrade] Logged in as ${username} on ${host}`);

  // Step 2: GET / to scrape CSRF token from HTML
  const pageRes = await instance.get('/', {
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });

  const html = typeof pageRes.data === 'string' ? pageRes.data : '';

  // Try multiple CSRF meta tag patterns
  const csrfMatch =
    html.match(/<meta[^>]+name=["']csrf["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf["']/i) ||
    html.match(/csrf['":\s]+["']([a-f0-9\-]{8,64})["']/i);

  const csrf = csrfMatch ? csrfMatch[1] : null;

  if (!csrf) {
    log.warn('[DXTrade] CSRF token not found in page HTML — proceeding without it');
  } else {
    log.info(`[DXTrade] CSRF token acquired`);
  }

  return { instance, csrf };
}

// ─── Get or refresh session ───────────────────────────────────────────────────
async function getSession(connector) {
  const key    = `${connector.host}:${connector.username}`;
  const cached = sessionCache.get(key);

  // Reuse if less than 4h old
  if (cached && Date.now() - cached.createdAt < 4 * 60 * 60 * 1000) {
    return cached;
  }

  const session = await createSession(connector);
  session.createdAt = Date.now();
  sessionCache.set(key, session);
  return session;
}

// ─── Place order ──────────────────────────────────────────────────────────────
async function placeOrder(connector, order) {
  const { instance, csrf } = await getSession(connector);

  const symbol = order.brokerSymbol.toUpperCase();

  // Resolve instrument ID: connector override → known list → error
  const instrumentIds = { ...KNOWN_IDS, ...(connector.instrumentIds || {}) };
  const instrumentId  = instrumentIds[symbol];

  if (!instrumentId) {
    throw new Error(
      `DX Trade: no instrument ID for "${symbol}". ` +
      `Find it via DevTools: place a manual trade on the platform, ` +
      `inspect POST /api/orders/single, note the instrumentId number. ` +
      `Then add it in the connector settings as instrumentIds.${symbol}=<number>.`
    );
  }

  const isBuy    = order.action.toUpperCase() === 'BUY';
  const isMarket = !order.price || order.orderType === 'MARKET';
  const qty      = parseFloat(order.qty);
  const reqId    = `sb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const payload = {
    directExchange: false,
    legs: [{
      instrumentId,
      positionEffect:  'OPENING',
      ratioQuantity:   1,
      symbol,
    }],
    limitPrice:  isMarket ? 0 : parseFloat(order.price || 0),
    orderSide:   isBuy ? 'BUY' : 'SELL',
    orderType:   isMarket ? 'MARKET' : 'LIMIT',
    quantity:    isBuy ? qty : -qty,       // DX Trade: sells use negative quantity
    requestId:   reqId,
    timeInForce: 'GTC',
  };

  if (order.sl && parseFloat(order.sl) !== 0) {
    payload.stopLoss = {
      fixedOffset:           5,
      fixedPrice:            parseFloat(order.sl),
      orderType:             'STOP',
      priceFixed:            true,
      quantityForProtection: qty,
      removed:               false,
    };
  }

  if (order.tp && parseFloat(order.tp) !== 0) {
    payload.takeProfit = {
      fixedOffset:           5,
      fixedPrice:            parseFloat(order.tp),
      orderType:             'LIMIT',
      priceFixed:            true,
      quantityForProtection: qty,
      removed:               false,
    };
  }

  // DX Trade requires JSON without spaces (from observed behaviour)
  const body = JSON.stringify(payload).replace(/ /g, '');

  const headers = {
    'Content-Type':     'application/json; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (csrf) headers['X-Csrf-Token'] = csrf;

  const res = await instance.post('/api/orders/single', body, { headers });

  if (res.status !== 200) {
    throw new Error(`DX Trade order failed: HTTP ${res.status} — ${JSON.stringify(res.data)}`);
  }

  log.info(`[DXTrade] ${isBuy ? 'BUY' : 'SELL'} ${symbol} ×${qty} — reqId: ${reqId}`);

  return {
    orderId:      res.data?.orderId || res.data?.id || reqId,
    brokerSymbol: symbol,
    status:       'submitted',
    instrumentId,
  };
}

// ─── Test connection ──────────────────────────────────────────────────────────
async function testConnection(connector) {
  const { host, username, password } = connector;

  if (!host)     throw new Error('host is required (e.g. dxtrade.ftmo.com)');
  if (!username) throw new Error('username is required');
  if (!password) throw new Error('password is required');

  // Force fresh login
  sessionCache.delete(`${host}:${username}`);
  await getSession(connector);

  return {
    message:  `DX Trade login successful`,
    host,
    username,
  };
}

// ─── Close a position ─────────────────────────────────────────────────────────
async function closePosition(connector, positionCode, symbol, quantity) {
  const { instance, csrf } = await getSession(connector);
  const instrumentIds = { ...KNOWN_IDS, ...(connector.instrumentIds || {}) };
  const instrumentId  = instrumentIds[symbol.toUpperCase()];

  const payload = {
    legs: [{
      instrumentId,
      positionCode,
      positionEffect: 'CLOSING',
      ratioQuantity:  1,
      symbol:         symbol.toUpperCase(),
    }],
    limitPrice:  0,
    orderType:   'MARKET',
    quantity:    -Math.abs(quantity),
    timeInForce: 'GTC',
  };

  const headers = {
    'Content-Type':     'application/json; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (csrf) headers['X-Csrf-Token'] = csrf;

  const res = await instance.post('/api/positions/close',
    JSON.stringify(payload), { headers });
  return res.data;
}

module.exports = { placeOrder, testConnection, closePosition, KNOWN_IDS };
