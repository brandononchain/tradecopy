'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 2;

function fmt(level, ...args) {
  if (LEVELS[level] > current) return;
  const ts  = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  console[level === 'error' ? 'error' : 'log'](`[${ts}] ${tag}`, ...args);
}

const log = {
  error: (...a) => fmt('error', ...a),
  warn:  (...a) => fmt('warn',  ...a),
  info:  (...a) => fmt('info',  ...a),
  debug: (...a) => fmt('debug', ...a),
};

module.exports = { log };
