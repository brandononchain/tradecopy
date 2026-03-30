'use strict';

/**
 * DX Trade Adapter
 * REST API — https://dxtrade.com/docs/api
 */

const axios = require('axios');

async function placeOrder(connector, order) {
  const { host, apiKey, accountId } = connector;

  const payload = {
    instrument:  order.brokerSymbol,
    side:        order.action.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
    quantity:    order.qty,
    type:        order.orderType || 'MARKET',
    accountId:   accountId,
    ...(order.sl && { stopLoss:   parseFloat(order.sl)  }),
    ...(order.tp && { takeProfit: parseFloat(order.tp)  }),
    ...(order.price && order.orderType !== 'MARKET' && { limitPrice: parseFloat(order.price) }),
    comment:     order.comment || 'SignalBridge',
  };

  const resp = await axios.post(`${host}/api/v1/orders`, payload, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
    },
    timeout: 8000,
  });

  return {
    orderId:      resp.data.orderId || resp.data.id,
    brokerSymbol: order.brokerSymbol,
    status:       resp.data.status || 'submitted',
  };
}

async function testConnection(connector) {
  const { host, apiKey } = connector;
  const resp = await axios.get(`${host}/api/v1/accounts`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    timeout: 5000,
  });
  return { accounts: resp.data?.length || 0, message: 'Connection successful' };
}

async function getPositions(connector) {
  const { host, apiKey, accountId } = connector;
  const resp = await axios.get(`${host}/api/v1/positions?accountId=${accountId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
    timeout: 5000,
  });
  return resp.data;
}

module.exports = { placeOrder, testConnection, getPositions };
