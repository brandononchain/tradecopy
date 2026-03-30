'use strict';

/**
 * MT4 / MT5 Adapter
 * Communicates with the SignalBridge EA via a lightweight relay bridge.
 * The EA polls /pending and ACKs completed orders back via /ack.
 *
 * The relay bridge is a small HTTP proxy that queues orders
 * and forwards them to the MT terminal's EA socket listener.
 */

const axios = require('axios');

// MT order types
const OP_BUY  = 0;
const OP_SELL = 1;

async function placeOrder(connector, order) {
  const { host, apiKey } = connector;

  const payload = {
    symbol:  order.brokerSymbol,
    type:    order.action.toUpperCase() === 'BUY' ? OP_BUY : OP_SELL,
    lots:    parseFloat(order.qty),
    price:   parseFloat(order.price || 0),       // 0 = market
    sl:      parseFloat(order.sl    || 0),
    tp:      parseFloat(order.tp    || 0),
    magic:   order.magic   || 88001,
    comment: order.comment || 'SB',
    expiration: 0,
  };

  const resp = await axios.post(`https://${host}/order`, payload, {
    headers: {
      'X-API-Key':    apiKey,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });

  return {
    orderId:      resp.data.orderId || resp.data.ticket,
    brokerSymbol: order.brokerSymbol,
    status:       resp.data.status || 'queued',
    ticket:       resp.data.ticket,
  };
}

async function testConnection(connector) {
  const { host, apiKey } = connector;
  const resp = await axios.get(`https://${host}/ping`, {
    headers: { 'X-API-Key': apiKey },
    timeout: 5000,
  });
  return {
    terminal:  resp.data.terminal || 'MT',
    version:   resp.data.version,
    connected: resp.data.connected,
    message:   'EA bridge reachable',
  };
}

module.exports = { placeOrder, testConnection };
