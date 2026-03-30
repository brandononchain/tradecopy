'use strict';

const { validateSignal } = require('../src/utils/validator');
const mapSymbol          = require('../src/utils/symbolMapper');
const { DEFAULT_SYMBOL_MAP } = require('../src/utils/symbolMapper');

// ─── Validator tests ──────────────────────────────────────────────────────────
describe('validateSignal', () => {
  test('accepts standard buy signal', () => {
    const r = validateSignal({ action: 'buy', symbol: 'EURUSD', qty: '1.5' });
    expect(r.valid).toBe(true);
    expect(r.signal.action).toBe('buy');
    expect(r.signal.symbol).toBe('EURUSD');
    expect(r.signal.qty).toBe(1.5);
  });

  test('normalizes long → buy', () => {
    const r = validateSignal({ action: 'long', symbol: 'NQ1!', qty: '1' });
    expect(r.valid).toBe(true);
    expect(r.signal.action).toBe('buy');
  });

  test('normalizes short → sell', () => {
    const r = validateSignal({ action: 'short', symbol: 'ES1!', qty: '2' });
    expect(r.valid).toBe(true);
    expect(r.signal.action).toBe('sell');
  });

  test('accepts alternate field names', () => {
    const r = validateSignal({ side: 'sell', ticker: 'BTCUSD', contracts: '0.01' });
    expect(r.valid).toBe(true);
    expect(r.signal.action).toBe('sell');
    expect(r.signal.symbol).toBe('BTCUSD');
    expect(r.signal.qty).toBe(0.01);
  });

  test('defaults qty to 1 when missing', () => {
    const r = validateSignal({ action: 'buy', symbol: 'GBPUSD' });
    expect(r.valid).toBe(true);
    expect(r.signal.qty).toBe(1);
  });

  test('rejects missing action', () => {
    const r = validateSignal({ symbol: 'EURUSD', qty: '1' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/action/i);
  });

  test('rejects invalid action', () => {
    const r = validateSignal({ action: 'hold', symbol: 'EURUSD', qty: '1' });
    expect(r.valid).toBe(false);
  });

  test('rejects missing symbol', () => {
    const r = validateSignal({ action: 'buy', qty: '1' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/symbol/i);
  });

  test('rejects negative qty', () => {
    const r = validateSignal({ action: 'buy', symbol: 'EURUSD', qty: '-1' });
    expect(r.valid).toBe(false);
    expect(r.errors[0]).toMatch(/qty/i);
  });

  test('parses optional sl/tp', () => {
    const r = validateSignal({ action: 'buy', symbol: 'NQ1!', qty: '1', sl: '18000', tp: '18500' });
    expect(r.signal.sl).toBe(18000);
    expect(r.signal.tp).toBe(18500);
  });

  test('accepts stop_loss / take_profit field names', () => {
    const r = validateSignal({ action: 'sell', symbol: 'GBPUSD', qty: '2', stop_loss: '1.2800', take_profit: '1.2600' });
    expect(r.signal.sl).toBe(1.28);
    expect(r.signal.tp).toBe(1.26);
  });
});

// ─── Symbol mapper tests ──────────────────────────────────────────────────────
describe('mapSymbol', () => {
  test('maps NQ1! → NQU4 for Tradovate', () => {
    expect(mapSymbol('NQ1!', 'tradovate', DEFAULT_SYMBOL_MAP)).toBe('NQU4');
  });

  test('maps ES1! → SP500 for MT5', () => {
    expect(mapSymbol('ES1!', 'mt5', DEFAULT_SYMBOL_MAP)).toBe('SP500');
  });

  test('maps XAUUSD → GOLD for DX Trade', () => {
    expect(mapSymbol('XAUUSD', 'dxtrade', DEFAULT_SYMBOL_MAP)).toBe('GOLD');
  });

  test('maps EURUSD → EUR/USD for Tradovate', () => {
    expect(mapSymbol('EURUSD', 'tradovate', DEFAULT_SYMBOL_MAP)).toBe('EUR/USD');
  });

  test('returns original symbol when no mapping found', () => {
    expect(mapSymbol('UNKNOWN', 'mt5', DEFAULT_SYMBOL_MAP)).toBe('UNKNOWN');
  });

  test('is case-insensitive on TV symbol', () => {
    expect(mapSymbol('eurusd', 'mt5', DEFAULT_SYMBOL_MAP)).toBe('EURUSD');
  });

  test('returns original when platform not in map', () => {
    expect(mapSymbol('NQ1!', 'unknownplatform', DEFAULT_SYMBOL_MAP)).toBe('NQ1!');
  });
});
