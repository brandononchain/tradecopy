'use strict';

const VALID_ACTIONS = new Set(['buy','sell','long','short','close','close_buy','close_sell']);

/**
 * Validate and normalize an incoming signal payload.
 * Accepts flexible field names to handle various TradingView alert formats.
 */
function validateSignal(body) {
  const errors = [];

  // ── Action ──────────────────────────────────────────────────────────
  const rawAction = (body.action || body.side || body.direction || '').toLowerCase().trim();
  if (!rawAction) {
    errors.push('Missing field: action (buy|sell)');
  } else if (!VALID_ACTIONS.has(rawAction)) {
    errors.push(`Invalid action "${rawAction}". Expected: buy|sell|long|short|close`);
  }

  // Normalize long/short → buy/sell
  const action = rawAction === 'long' ? 'buy' : rawAction === 'short' ? 'sell' : rawAction;

  // ── Symbol ──────────────────────────────────────────────────────────
  const symbol = (body.symbol || body.ticker || body.instrument || '').toUpperCase().trim();
  if (!symbol) errors.push('Missing field: symbol');

  // ── Quantity ────────────────────────────────────────────────────────
  const rawQty = body.qty ?? body.quantity ?? body.contracts ?? body.size ?? body.lots ?? 1;
  const qty    = parseFloat(rawQty);
  if (isNaN(qty) || qty <= 0) errors.push(`Invalid qty "${rawQty}". Must be a positive number.`);

  // ── Optional fields ─────────────────────────────────────────────────
  const price   = body.price   ? parseFloat(body.price)   : null;
  const sl      = body.sl      ? parseFloat(body.sl)      : (body.stop_loss   ? parseFloat(body.stop_loss)   : null);
  const tp      = body.tp      ? parseFloat(body.tp)      : (body.take_profit ? parseFloat(body.take_profit) : null);
  const comment = (body.comment || body.tag || '').slice(0, 64); // max 64 chars

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    errors: [],
    signal: { symbol, action, qty, price, sl, tp, comment },
  };
}

module.exports = { validateSignal };
