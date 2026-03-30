'use strict';

/**
 * Tradovate Adapter
 * REST API — https://api.tradovate.com/v1/docs
 * Supports both live (live.tradovateapi.com) and demo (demo.tradovateapi.com)
 */

const axios = require('axios');

// Simple in-memory token cache per host
const tokenCache = new Map(); // host → { accessToken, expiry }

async function getAccessToken(connector) {
  const { host } = connector;
  const cached = tokenCache.get(host);
  if (cached && Date.now() < cached.expiry) return cached.accessToken;

  const resp = await axios.post(`${host}/v1/auth/accesstokenrequest`, {
    name:       connector.username   || process.env.TRADOVATE_USERNAME,
    password:   connector.password   || process.env.TRADOVATE_PASSWORD,
    appId:      connector.appId      || process.env.TRADOVATE_APP_ID,
    appVersion: '1.0',
    cid:        connector.cid        || process.env.TRADOVATE_APP_ID,
    sec:        connector.appSecret  || process.env.TRADOVATE_APP_SECRET,
    deviceId:   'tradekashi-relay',
  }, { timeout: 8000 });

  const token  = resp.data.accessToken;
  const expiry = Date.now() + (resp.data.expirationTime
    ? new Date(resp.data.expirationTime).getTime() - Date.now() - 60000
    : 3600000); // default 1h - 60s buffer

  tokenCache.set(host, { accessToken: token, expiry });
  return token;
}

async function placeOrder(connector, order) {
  const { host } = connector;
  const token     = await getAccessToken(connector);

  const payload = {
    accountSpec:  connector.accountSpec || process.env.TRADOVATE_ACCOUNT_SPEC,
    accountId:    connector.accountId,
    action:       order.action.toUpperCase() === 'BUY' ? 'Buy' : 'Sell',
    symbol:       order.brokerSymbol,
    orderQty:     Math.max(1, Math.round(order.qty)),   // Tradovate = integer contracts
    orderType:    'Market',
    isAutomated:  true,
    ...(order.sl && { stopPrice: parseFloat(order.sl) }),
    text: order.comment || 'Tradekashi',
  };

  const resp = await axios.post(`${host}/v1/order/placeorder`, payload, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    timeout: 8000,
  });

  return {
    orderId:      resp.data.orderId || resp.data.order?.id,
    brokerSymbol: order.brokerSymbol,
    status:       resp.data.orderStatus || 'Working',
    fillPrice:    resp.data.avgFillPrice,
  };
}

async function testConnection(connector) {
  const { host } = connector;
  const token     = await getAccessToken(connector);

  const resp = await axios.get(`${host}/v1/account/list`, {
    headers: { 'Authorization': `Bearer ${token}` },
    timeout: 5000,
  });

  return {
    accounts: resp.data?.length || 0,
    message:  'Tradovate connection successful',
  };
}

async function getPositions(connector) {
  const { host } = connector;
  const token     = await getAccessToken(connector);

  const resp = await axios.get(`${host}/v1/position/list`, {
    headers: { 'Authorization': `Bearer ${token}` },
    timeout: 5000,
  });
  return resp.data;
}

module.exports = { placeOrder, testConnection, getPositions };
