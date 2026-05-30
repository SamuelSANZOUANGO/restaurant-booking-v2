/**
 * middleware/errorInjection.js
 * ----------------------------
 * Randomly returns a 5xx response for N% of requests.
 * N is read from config (ERROR_INJECTION_RATE env var, default 10).
 *
 * The injected status code is chosen uniformly from:
 *   500 Internal Server Error
 *   502 Bad Gateway
 *   503 Service Unavailable
 *   504 Gateway Timeout
 */

const config = require('../config');

const ERROR_CODES = config.errorInjectionCodes;

const ERROR_MESSAGES = {
  500: 'Internal Server Error – simulated fault',
  502: 'Bad Gateway – upstream connection failed (simulated)',
  503: 'Service Unavailable – temporarily overloaded (simulated)',
  504: 'Gateway Timeout – upstream did not respond in time (simulated)',
};

/**
 * @param {number} rate  0-100 percentage of requests to fail
 */
module.exports = function errorInjectionMiddleware(rate) {
  if (rate <= 0) {
    // Short-circuit: injection disabled, just pass through
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    const roll = Math.random() * 100; // [0, 100)
    if (roll < rate) {
      const code = ERROR_CODES[Math.floor(Math.random() * ERROR_CODES.length)];
      return res.status(code).json({
        error: ERROR_MESSAGES[code] ?? 'Server Error',
        injected: true,
        configured_rate_pct: rate,
      });
    }
    next();
  };
};
