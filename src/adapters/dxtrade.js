'use strict';

/**
 * Liquid Charts Pro (pro.liquidcharts.com) Adapter
 *
 * IMPORTANT: Liquid Charts Pro is built on FX Blue Labs (fxbluelabs.com)
 * software — NOT standard DX Trade. It uses a WebSocket-based EA Hub
 * architecture rather than a REST API.
 *
 * How Liquid Charts works:
 *   - The web platform is a client-side SPA (FX Blue / Figaro)
 *   - Trading is executed via an MT4/MT5 Expert Advisor running locally
 *     that connects to the FX Blue Hub via WebSocket
 *   - There is NO public REST API for placing orders directly
 *
 * Integration options:
 *   OPTION A (Recommended): Use the MT5 adapter instead.
 *     Liquid Brokers also offers MT5. Connect via that route.
 *
 *   OPTION B: FX Blue EA Hub (if you run the EA locally)
 *     The EA opens a local WebSocket on ws://localhost:31318
 *     SignalBridge can send orders to it if running on the same machine.
 *     This does NOT work on cloud deployments like Railway.
 *
 *   OPTION C: TradersPost / Webhooks (if Liquid Charts supports it)
 *     Some brokers on FX Blue support TradersPost webhook integration.
 *
 * This adapter implements Option B for local use, and throws a clear
 * error on cloud deployments explaining the situation.
 */

const WebSocket = require('ws');
const { log }   = require('../utils/logger');

// Cache active WS connections: host → ws
const wsCache = new Map();

/**
 * Send an order to the FX Blue EA Hub via WebSocket.
 * Only works when the EA is running locally and the hub is reachable.
 */
async function placeOrder(connector, order) {
  const host = connector.hubHost || 'localhost';
  const port  = connector.hubPort || 31318;
  const wsUrl = `ws://${host}:${port}/`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(
        `Liquid Charts / FX Blue Hub not reachable at ${wsUrl}. ` +
        `This requires the FX Blue EA running locally — it cannot be reached from a cloud server. ` +
        `Use the MT5 connector instead if you have an MT5 account with Liquid Brokers.`
      ));
    }, 5000);

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      clearTimeout(timeout);
      return reject(new Error(`Cannot connect to FX Blue Hub: ${e.message}`));
    }

    ws.on('open', () => {
      clearTimeout(timeout);

      // FX Blue EA Hub order format
      const cmd = JSON.stringify({
        action:  order.action.toLowerCase() === 'buy' ? 'buy' : 'sell',
        symbol:  order.brokerSymbol,
        volume:  parseFloat(order.qty),
        sl:      order.sl ? parseFloat(order.sl) : 0,
        tp:      order.tp ? parseFloat(order.tp) : 0,
        comment: order.comment || 'SignalBridge',
        magic:   connector.magic || 88001,
      });

      ws.send(cmd);
      ws.close();

      resolve({
        orderId:      `hub-${Date.now()}`,
        brokerSymbol: order.brokerSymbol,
        status:       'sent_to_hub',
      });
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(
        `FX Blue Hub connection failed: ${err.message}. ` +
        `Ensure the FX Blue EA is running and connected. ` +
        `On cloud deployments (Railway/Render), use the MT5 connector instead.`
      ));
    });
  });
}

async function testConnection(connector) {
  const host = connector.hubHost || 'localhost';
  const port  = connector.hubPort || 31318;

  // On cloud servers, localhost:31318 will always fail
  // Give a clear, actionable error
  const isCloud = !['localhost', '127.0.0.1', '::1'].includes(host);

  if (isCloud) {
    throw new Error(
      `Liquid Charts Pro uses FX Blue Labs software with a WebSocket EA Hub — ` +
      `not a REST API. Direct cloud integration is not supported. ` +
      `Recommended: connect Liquid Brokers via MT5 instead ` +
      `(they offer MT5 accounts — use the MT5 connector with their server details).`
    );
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}/`);
    const t  = setTimeout(() => { ws.terminate(); reject(new Error('Hub not reachable (timeout)')); }, 3000);
    ws.on('open',  () => { clearTimeout(t); ws.close(); resolve({ message: 'FX Blue Hub reachable', host, port }); });
    ws.on('error', (e) => { clearTimeout(t); reject(new Error(`Hub not reachable: ${e.message}`)); });
  });
}

module.exports = { placeOrder, testConnection };
