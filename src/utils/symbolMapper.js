'use strict';

/**
 * Map a TradingView symbol to the broker-specific symbol.
 * Falls back to the original symbol if no mapping exists.
 */
function mapSymbol(tvSymbol, platform, symbolMap) {
  if (!tvSymbol) return tvSymbol;
  const key   = tvSymbol.toUpperCase();
  const entry = symbolMap?.[key];
  if (!entry) return tvSymbol;
  return entry[platform] || tvSymbol;
}

/**
 * Default symbol map.
 * Covers common instruments across all platforms.
 * Users can add/override via the dashboard Symbol Map page.
 */
const DEFAULT_SYMBOL_MAP = {
  // ── FX ──────────────────────────────────────────────────────────────────
  'EURUSD': { dxtrade: 'EURUSD',   mt4: 'EURUSD',   mt5: 'EURUSD',   tradovate: 'EUR/USD',  category: 'fx', pointValue: 1 },
  'GBPUSD': { dxtrade: 'GBPUSD',   mt4: 'GBPUSD',   mt5: 'GBPUSD',   tradovate: 'GBP/USD',  category: 'fx', pointValue: 1 },
  'USDJPY': { dxtrade: 'USDJPY',   mt4: 'USDJPY',   mt5: 'USDJPY',   tradovate: 'USD/JPY',  category: 'fx', pointValue: 1 },
  'USDCAD': { dxtrade: 'USDCAD',   mt4: 'USDCAD',   mt5: 'USDCAD',   tradovate: 'USD/CAD',  category: 'fx', pointValue: 1 },
  'AUDUSD': { dxtrade: 'AUDUSD',   mt4: 'AUDUSD',   mt5: 'AUDUSD',   tradovate: 'AUD/USD',  category: 'fx', pointValue: 1 },
  'NZDUSD': { dxtrade: 'NZDUSD',   mt4: 'NZDUSD',   mt5: 'NZDUSD',   tradovate: 'NZD/USD',  category: 'fx', pointValue: 1 },
  'USDCHF': { dxtrade: 'USDCHF',   mt4: 'USDCHF',   mt5: 'USDCHF',   tradovate: 'USD/CHF',  category: 'fx', pointValue: 1 },
  'EURGBP': { dxtrade: 'EURGBP',   mt4: 'EURGBP',   mt5: 'EURGBP',   tradovate: 'EUR/GBP',  category: 'fx', pointValue: 1 },
  'EURJPY': { dxtrade: 'EURJPY',   mt4: 'EURJPY',   mt5: 'EURJPY',   tradovate: 'EUR/JPY',  category: 'fx', pointValue: 1 },
  'GBPJPY': { dxtrade: 'GBPJPY',   mt4: 'GBPJPY',   mt5: 'GBPJPY',   tradovate: 'GBP/JPY',  category: 'fx', pointValue: 1 },
  'AUDCHF': { dxtrade: 'AUDCHF',   mt4: 'AUDCHF',   mt5: 'AUDCHF',                          category: 'fx', pointValue: 1 },
  'CADJPY': { dxtrade: 'CADJPY',   mt4: 'CADJPY',   mt5: 'CADJPY',                          category: 'fx', pointValue: 1 },

  // ── US Equity Index Futures (continuous) ─────────────────────────────────
  'ES1!':   { dxtrade: 'US500',    mt4: 'SP500',    mt5: 'SP500',    tradovate: 'ESU4',     category: 'futures', pointValue: 50  },
  'NQ1!':   { dxtrade: 'NAS100',   mt4: 'NQ100',    mt5: 'NQ100',    tradovate: 'NQU4',     category: 'futures', pointValue: 20  },
  'RTY1!':  { dxtrade: 'US2000',   mt4: 'RTY',      mt5: 'RTY',      tradovate: 'RTYU4',    category: 'futures', pointValue: 50  },
  'YM1!':   { dxtrade: 'US30',     mt4: 'US30',     mt5: 'US30',     tradovate: 'YMU4',     category: 'futures', pointValue: 5   },

  // ── Micro Futures ────────────────────────────────────────────────────────
  'MES1!':  { dxtrade: 'MES',      mt5: 'MES',      tradovate: 'MESU4',  category: 'futures', pointValue: 5 },
  'MNQ1!':  { dxtrade: 'MNQ',      mt5: 'MNQ',      tradovate: 'MNQU4',  category: 'futures', pointValue: 2 },

  // ── Commodities ──────────────────────────────────────────────────────────
  'XAUUSD': { dxtrade: 'GOLD',     mt4: 'XAUUSD',   mt5: 'XAUUSD',   tradovate: 'GCQ4',     category: 'index',   pointValue: 100   },
  'XAGUSD': { dxtrade: 'SILVER',   mt4: 'XAGUSD',   mt5: 'XAGUSD',   tradovate: 'SIN4',     category: 'index',   pointValue: 5000  },
  'GC1!':   { dxtrade: 'GOLD',     mt4: 'XAUUSD',   mt5: 'XAUUSD',   tradovate: 'GCQ4',     category: 'futures', pointValue: 100   },
  'CL1!':   { dxtrade: 'USOIL',    mt4: 'USOIL',    mt5: 'USOIL',    tradovate: 'CLQ4',     category: 'futures', pointValue: 1000  },
  'NG1!':   { dxtrade: 'NATGAS',   mt4: 'NATGAS',   mt5: 'NATGAS',   tradovate: 'NGN4',     category: 'futures', pointValue: 10000 },

  // ── Crypto ───────────────────────────────────────────────────────────────
  'BTCUSD': { dxtrade: 'BTC/USD',  mt4: 'BTCUSD',   mt5: 'BTCUSD',   tradovate: 'BTCUSD',   category: 'crypto',  pointValue: 1 },
  'ETHUSD': { dxtrade: 'ETH/USD',  mt4: 'ETHUSD',   mt5: 'ETHUSD',   tradovate: 'ETHUSD',   category: 'crypto',  pointValue: 1 },

  // ── Indices (TradingView native tickers) ─────────────────────────────────
  'SPX':    { dxtrade: 'US500',    mt4: 'SP500',    mt5: 'SP500',    tradovate: 'ESU4',      category: 'index',   pointValue: 1 },
  'NDX':    { dxtrade: 'NAS100',   mt4: 'NQ100',    mt5: 'NQ100',    tradovate: 'NQU4',      category: 'index',   pointValue: 1 },
  'DJI':    { dxtrade: 'US30',     mt4: 'US30',     mt5: 'US30',     tradovate: 'YMU4',      category: 'index',   pointValue: 1 },
  'VIX':    { dxtrade: 'VIX',      mt5: 'VIX',                                               category: 'index',   pointValue: 1 },

  // ── Capital.com tickers (used when charting Capital.com data in TradingView) ──
  // These are the CFD tickers Capital.com uses — different from futures tickers
  'US100':  { dxtrade: 'NAS100',   mt4: 'NQ100',    mt5: 'NQ100',    tradovate: 'NQU4',      category: 'index',   pointValue: 1 },
  'US500':  { dxtrade: 'US500',    mt4: 'SP500',    mt5: 'SP500',    tradovate: 'ESU4',       category: 'index',   pointValue: 1 },
  'US30':   { dxtrade: 'US30',     mt4: 'US30',     mt5: 'US30',     tradovate: 'YMU4',       category: 'index',   pointValue: 1 },
  'US2000': { dxtrade: 'US2000',   mt4: 'US2000',   mt5: 'US2000',   tradovate: 'RTYU4',      category: 'index',   pointValue: 1 },
  'UK100':  { dxtrade: 'UK100',    mt4: 'UK100',    mt5: 'UK100',                             category: 'index',   pointValue: 1 },
  'DE40':   { dxtrade: 'DE40',     mt4: 'GER40',    mt5: 'GER40',                             category: 'index',   pointValue: 1 },
  'EU50':   { dxtrade: 'EU50',     mt4: 'STOXX50',  mt5: 'STOXX50',                           category: 'index',   pointValue: 1 },
  'JP225':  { dxtrade: 'JP225',    mt4: 'JPN225',   mt5: 'JPN225',                            category: 'index',   pointValue: 1 },
  'AU200':  { dxtrade: 'AU200',    mt4: 'AUS200',   mt5: 'AUS200',                            category: 'index',   pointValue: 1 },
  'HK50':   { dxtrade: 'HK50',     mt4: 'HK50',     mt5: 'HK50',                             category: 'index',   pointValue: 1 },
  'FR40':   { dxtrade: 'FR40',     mt4: 'FRA40',    mt5: 'FRA40',                             category: 'index',   pointValue: 1 },

  // ── Capital.com commodity names ──────────────────────────────────────────
  'GOLD':   { dxtrade: 'GOLD',     mt4: 'XAUUSD',   mt5: 'XAUUSD',                           category: 'index',   pointValue: 1 },
  'SILVER': { dxtrade: 'SILVER',   mt4: 'XAGUSD',   mt5: 'XAGUSD',                           category: 'index',   pointValue: 1 },
  'OIL':    { dxtrade: 'USOIL',    mt4: 'USOIL',    mt5: 'USOIL',                             category: 'index',   pointValue: 1 },
  'NGAS':   { dxtrade: 'NATGAS',   mt4: 'NATGAS',   mt5: 'NATGAS',                            category: 'index',   pointValue: 1 },
};

module.exports = mapSymbol;
module.exports.DEFAULT_SYMBOL_MAP = DEFAULT_SYMBOL_MAP;
