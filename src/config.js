/**
 * config.js
 * ---------
 * All runtime configuration is read here.
 * Override values via environment variables or the .env file.
 *
 * Key tunables:
 *   ERROR_INJECTION_RATE  – percentage (0-100) of API requests that will
 *                           receive a synthetic 5xx response.  Default: 10
 *   PORT                  – HTTP port.  Default: 3000
 *   DB_PATH               – SQLite database file path.
 */

require('dotenv').config();

const config = {
  // ── Server ──────────────────────────────────────────────────────────────
  port: parseInt(process.env.PORT || '3000', 10),

  // ── Database ─────────────────────────────────────────────────────────────
  dbPath: process.env.DB_PATH || './data/bookings.db',

  // ── Error Injection ───────────────────────────────────────────────────────
  // Percentage of /api/* requests that will be answered with a random 5xx code.
  // Range: 0 (disabled) – 100 (every request fails)
  errorInjectionRate: parseFloat(process.env.ERROR_INJECTION_RATE ?? '10'),

  // Which 5xx status codes can be injected (chosen at random)
  errorInjectionCodes: [500, 502, 503, 504],

  // ── Misc ──────────────────────────────────────────────────────────────────
  nodeEnv: process.env.NODE_ENV || 'development',
};

// Validate
if (config.errorInjectionRate < 0 || config.errorInjectionRate > 100) {
  console.warn(
    `⚠️  ERROR_INJECTION_RATE="${config.errorInjectionRate}" is out of range [0-100]. Clamping to 10.`
  );
  config.errorInjectionRate = 10;
}

module.exports = config;
