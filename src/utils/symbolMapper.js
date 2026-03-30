'use strict';

/**
 * Map a TradingView symbol to the broker-specific symbol.
 * Falls back to the original symbol if no mapping exists.
 *
 * symbolMap structure:
 * {
 *   "NQ1!": { "tradovate": "NQU4", "mt5": "NQ100", "dxtrade": "NQ100" },
 *   "EURUSD": { "mt5": "EURUSD", "mt4": "EURUSD", "dxtrade": "EURUSD", "tradovate": "EUR/USD" },
 *   ...
 * }
 */
function mapSymbol(tvSymbol, platform, symbolMap) {
  if (!tvSymbol) return tvSymbol;
  const key   = tvSymbol.toUpperCase();
  const entry = symbolMap?.[key];
  if (!entry) return tvSymbol; // pass through as-is
  return entry[platform] || tvSymbol;
}

/**
 * Default symbol map covering common instruments across all platforms.
 */
const DEFAULT_SYMBOL_MAP = {
  // FX
  'EURUSD': { dxtrade: 'EURUSD',   mt4: 'EURUSD',   mt5: 'EURUSD',   tradovate: 'EUR/USD',  category: 'fx', pointValue: 1 },
  'GBPUSD': { dxtrade: 'GBPUSD',   mt4: 'GBPUSD',   mt5: 'GBPUSD',   tradovate: 'GBP/USD',  category: 'fx', pointValue: 1 },
  'USDJPY': { dxtrade: 'USDJPY',   mt4: 'USDJPY',   mt5: 'USDJPY',   tradovate: 'USD/JPY',  category: 'fx', pointValue: 1 },
  'USDCAD': { dxtrade: 'USDCAD',   mt4: 'USDCAD',   mt5: 'USDCAD',   tradovate: 'USD/CAD',  category: 'fx', pointValue: 1 },
  'AUDUSD': { dxtrade: 'AUDUSD',   mt4: 'AUDUSD',   mt5: 'AUDUSD',   tradovate: 'AUD/USD',  category: 'fx', pointValue: 1 },
  'NZDUSD': { dxtrade: 'NZDUSD',   mt4: 'NZDUSD',   mt5: 'NZDUSD',   tradovate: 'NZD/USD',  category: 'fx', pointValue: 1 },
  'EURGBP': { dxtrade: 'EURGBP',   mt4: 'EURGBP',   mt5: 'EURGBP',   tradovate: 'EUR/GBP',  category: 'fx', pointValue: 1 },
  'EURJPY': { dxtrade: 'EURJPY',   mt4: 'EURJPY',   mt5: 'EURJPY',   tradovate: 'EUR/JPY',  category: 'fx', pointValue: 1 },

  // US Equity Index Futures (Tradovate continuous)
  'ES1!':   { dxtrade: 'US500',    mt4: 'SP500',    mt5: 'SP500',    tradovate: 'ESU4',     category: 'futures', pointValue: 50 },
  'NQ1!':   { dxtrade: 'NAS100',   mt4: 'NQ100',    mt5: 'NQ100',    tradovate: 'NQU4',     category: 'futures', pointValue: 20 },
  'RTY1!':  { dxtrade: 'US2000',   mt4: 'RTY',      mt5: 'RTY',      tradovate: 'RTYU4',    category: 'futures', pointValue: 50 },
  'YM1!':   { dxtrade: 'US30',     mt4: 'YM',       mt5: 'YM',       tradovate: 'YMU4',     category: 'futures', pointValue: 5  },

  // Micro Futures
  'MES1!':  { tradovate: 'MESU4',  mt5: 'MES',      dxtrade: 'MES',  category: 'futures', pointValue: 5 },
  'MNQ1!':  { tradovate: 'MNQU4',  mt5: 'MNQ',      dxtrade: 'MNQ',  category: 'futures', pointValue: 2 },

  // Commodities
  'GC1!':   { dxtrade: 'GOLD',     mt4: 'XAUUSD',   mt5: 'XAUUSD',   tradovate: 'GCQ4',     category: 'futures', pointValue: 100 },
  'XAUUSD': { dxtrade: 'GOLD',     mt4: 'XAUUSD',   mt5: 'XAUUSD',   tradovate: 'GCQ4',     category: 'index',   pointValue: 100 },
  'SI1!':   { dxtrade: 'SILVER',   mt4: 'XAGUSD',   mt5: 'XAGUSD',   tradovate: 'SIN4',     category: 'futures', pointValue: 5000 },
  'CL1!':   { dxtrade: 'USOIL',    mt4: 'USOIL',    mt5: 'USOIL',    tradovate: 'CLQ4',     category: 'futures', pointValue: 1000 },
  'NG1!':   { dxtrade: 'NATGAS',   mt4: 'NATGAS',   mt5: 'NATGAS',   tradovate: 'NGN4',     category: 'futures', pointValue: 10000 },

  // Crypto
  'BTCUSD': { dxtrade: 'BTC/USD',  mt4: 'BTCUSD',   mt5: 'BTCUSD',   tradovate: 'BTCUSD',   category: 'crypto',  pointValue: 1 },
  'ETHUSD': { dxtrade: 'ETH/USD',  mt4: 'ETHUSD',   mt5: 'ETHUSD',   tradovate: 'ETHUSD',   category: 'crypto',  pointValue: 1 },

  // Indices (CFD)
  'SPX':    { dxtrade: 'US500',    mt4: 'SP500',    mt5: 'SP500',    tradovate: 'ESU4',      category: 'index',   pointValue: 1 },
  'NDX':    { dxtrade: 'NAS100',   mt4: 'NQ100',    mt5: 'NQ100',    tradovate: 'NQU4',      category: 'index',   pointValue: 1 },
  'DJI':    { dxtrade: 'US30',     mt4: 'US30',     mt5: 'US30',     tradovate: 'YMU4',      category: 'index',   pointValue: 1 },
  'VIX':    { dxtrade: 'VIX',      mt5: 'VIX',      category: 'index', pointValue: 1 },
};

module.exports = mapSymbol;
module.exports.DEFAULT_SYMBOL_MAP = DEFAULT_SYMBOL_MAP;
