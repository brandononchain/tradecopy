'use strict';

const mapSymbol = require('./symbolMapper');
const { log }   = require('./logger');
const WebSocket = require('ws');

/**
 * Route a validated signal to all matching active routes.
 * Returns array of results, one per route.
 */
async function routeSignal(user, signal, wss) {
  const results = await Promise.allSettled(
    user.routes
      .filter(route => shouldRoute(route, signal))
      .map(route  => dispatchToRoute(user, route, signal))
  );

  const output = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const route = user.routes.filter(rt => shouldRoute(rt, signal))[i];
    log.error(`[ROUTER] Route "${route?.name}" threw:`, r.reason?.message);
    return { route: route?.name, platform: route?.platform, status: 'error', error: r.reason?.message };
  });

  // Broadcast to WebSocket clients
  if (wss) {
    const msg = JSON.stringify({ type: 'signal', data: { signal, results: output, ts: new Date().toISOString() } });
    wss.clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN && ws.userId === user.userId) ws.send(msg);
    });
  }

  return output;
}

function shouldRoute(route, signal) {
  if (!route.active) return false;
  // Empty symbols array = match all
  if (!route.symbols || route.symbols.length === 0) return true;
  return route.symbols
    .map(s => s.toUpperCase())
    .includes(signal.symbol.toUpperCase());
}

async function dispatchToRoute(user, route, signal) {
  const platform  = route.platform;
  const connector = user.connectors[platform];

  if (!connector) {
    return { route: route.name, platform, status: 'skipped', reason: 'Connector not configured' };
  }
  if (!connector.apiKey && platform !== 'tradovate') {
    return { route: route.name, platform, status: 'skipped', reason: 'API key missing' };
  }

  const brokerSymbol = mapSymbol(signal.symbol, platform, user.symbolMap);
  const multiplier   = parseFloat(route.multiplier) || 1.0;

  // Apply reverseSignals setting
  let action = signal.action.toLowerCase();
  if (user.settings.reverseSignals) {
    action = action === 'buy' ? 'sell' : 'buy';
  }

  const order = {
    brokerSymbol,
    action,
    qty:       parseFloat(signal.qty) * multiplier,
    price:     signal.price,
    sl:        signal.sl,
    tp:        signal.tp,
    comment:   signal.comment || 'Tradekashi',
    orderType: route.orderType || 'MARKET',
  };

  try {
    const adapter = require(`../adapters/${platform}`);
    const result  = await adapter.placeOrder(connector, order);
    log.info(`[${platform.toUpperCase()}] Order OK: ${action.toUpperCase()} ${brokerSymbol} ×${order.qty}`);
    return { route: route.name, platform, status: 'ok', brokerSymbol, ...result };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    log.error(`[${platform.toUpperCase()}] Order FAILED: ${msg}`);
    return { route: route.name, platform, status: 'error', error: msg, brokerSymbol };
  }
}

module.exports = { routeSignal };
