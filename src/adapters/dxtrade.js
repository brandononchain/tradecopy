'use strict';

/**
 * DX Trade Adapter — Liquid Charts (pro.liquidcharts.com)
 *
 * DX Trade uses session-based auth, NOT Bearer tokens:
 *   1. POST /api/auth/login  → sets JSESSIONID + DXTFID cookies
 *   2. GET  /               → scrape CSRF meta tag from HTML
 *   3. POST /api/orders/single with cookies + X-CSRF-Token header
 *
 * Instrument IDs are numeric and required alongside the symbol string.
 * Find yours by watching a manual order in browser DevTools → Network tab.
 */

const axios  = require('axios');
const https  = require('https');

// ─── Instrument ID map (Liquid Charts / DX Trade CFD) ────────────────────────
// Verify via browser DevTools: place a manual order and inspect the POST payload.
const INSTRUMENT_IDS = {
  EURUSD: 3438,
  GBPUSD: 3440,
  USDJPY: 3427,
  USDCAD: 3433,
  USDCHF: 3390,
  AUDUSD: 3411,
  NZDUSD: 3398,
  EURGBP: 3419,
  EURJPY: 3392,
  AUDCHF: 3395,
  XAUUSD: 3406,
  XAGUSD: 3407,
  US30:   3351,
  US500:  3352,
  NAS100: 3353,
  BTCUSD: 3425,
  ETHUSD: 3443,
  USOIL:  3360,
};

// ─── Session cache ────────────────────────────────────────────────────────────
const sessionCache = new Map();

function makeHttpClient(host) {
  const jar = {};

  const client = axios.create({
    baseURL: `https://${host}`,
    timeout: 10000,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  });

  // Capture Set-Cookie headers
  client.interceptors.response.use(res => {
    const setCookie = res.headers['set-cookie'] || [];
    setCookie.forEach(raw => {
      const [pair] = raw.split(';');
      const [name, ...rest] = pair.split('=');
      jar[name.trim()] = rest.join('=').trim();
    });
    return res;
  });

  // Inject cookies into every outgoing request
  client.interceptors.request.use(cfg => {
    cfg.headers['Cookie'] = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    return cfg;
  });

  return { client, jar };
}

async function login(host, username, password) {
  const { client } = makeHttpClient(host);

  const resp = await client.post('/api/auth/login', {
    username,
    password,
    vendor: '',  // broker-specific; leave blank for Liquid Charts
  }, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (resp.status !== 200) {
    throw new Error(`DX Trade login failed: HTTP ${resp.status}`);
  }

  // Fetch CSRF token from main page HTML
  const pageResp = await client.get('/', { headers: { Accept: 'text/html' } });
  const csrfMatch = pageResp.data.match(/<meta[^>]+name=["']csrf["'][^>]+content=["']([^"']+)["']/i)
    || pageResp.data.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf["']/i);

  const csrf = csrfMatch ? csrfMatch[1] : null;
  if (!csrf) throw new Error('DX Trade: could not extract CSRF token');

  return { client, csrf };
}

async function getSession(connector) {
  const cacheKey = `${connector.host}:${connector.username}`;
  const cached   = sessionCache.get(cacheKey);
  if (cached && (Date.now() - cached.createdAt) < 4 * 60 * 60 * 1000) return cached;

  const session = await login(connector.host, connector.username, connector.password);
  session.createdAt = Date.now();
  sessionCache.set(cacheKey, session);
  return session;
}

async function placeOrder(connector, order) {
  const { client, csrf } = await getSession(connector);

  const symbol       = order.brokerSymbol.toUpperCase();
  const instrumentId = connector.instrumentIds?.[symbol] ?? INSTRUMENT_IDS[symbol];
  if (!instrumentId) throw new Error(`DX Trade: no instrument ID for "${symbol}". Check INSTRUMENT_IDS map.`);

  const isBuy    = order.action.toUpperCase() === 'BUY';
  const isMarket = !order.price || order.orderType === 'MARKET';
  const qty      = parseFloat(order.qty);

  const payload = {
    directExchange: false,
    legs: [{ instrumentId, positionEffect: 'OPENING', ratioQuantity: 1, symbol }],
    limitPrice:  isMarket ? 0 : parseFloat(order.price),
    orderSide:   isBuy ? 'BUY' : 'SELL',
    orderType:   isMarket ? 'MARKET' : 'LIMIT',
    quantity:    isBuy ? qty : -qty,
    requestId:   `sb-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timeInForce: 'GTC',
  };

  if (order.sl && parseFloat(order.sl) !== 0) {
    payload.stopLoss = {
      fixedOffset: 5, fixedPrice: parseFloat(order.sl),
      orderType: 'STOP', priceFixed: true,
      quantityForProtection: qty, removed: false,
    };
  }

  if (order.tp && parseFloat(order.tp) !== 0) {
    payload.takeProfit = {
      fixedOffset: 5, fixedPrice: parseFloat(order.tp),
      orderType: 'LIMIT', priceFixed: true,
      quantityForProtection: qty, removed: false,
    };
  }

  const resp = await client.post('/api/orders/single',
    JSON.stringify(payload).replace(/ /g, ''), {
    headers: {
      'Content-Type':     'application/json; charset=UTF-8',
      'X-CSRF-Token':     csrf,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (resp.status !== 200) throw new Error(`DX Trade order rejected: HTTP ${resp.status}`);

  return {
    orderId:      resp.data?.orderId || payload.requestId,
    brokerSymbol: symbol,
    status:       'submitted',
  };
}

async function testConnection(connector) {
  if (!connector.host || !connector.username || !connector.password) {
    throw new Error('DX Trade requires: host, username, password');
  }
  sessionCache.delete(`${connector.host}:${connector.username}`);
  await getSession(connector);
  return { message: 'DX Trade session established', host: connector.host };
}

async function closePosition(connector, positionCode, symbol, quantity) {
  const { client, csrf } = await getSession(connector);
  const instrumentId = INSTRUMENT_IDS[symbol.toUpperCase()];
  const payload = {
    legs: [{ instrumentId, positionCode, positionEffect: 'CLOSING', ratioQuantity: 1, symbol }],
    limitPrice: 0, orderType: 'MARKET',
    quantity: -Math.abs(quantity), timeInForce: 'GTC',
  };
  const resp = await client.post('/api/positions/close', JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-CSRF-Token': csrf, 'X-Requested-With': 'XMLHttpRequest' },
  });
  return resp.data;
}

module.exports = { placeOrder, testConnection, closePosition, INSTRUMENT_IDS };
