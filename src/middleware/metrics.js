/**
 * middleware/metrics.js
 * ---------------------
 * Records per-request duration and total count into Prometheus histograms/counters.
 * Normalises dynamic path segments (:id) so cardinality stays low.
 */

/**
 * Map a raw Express URL to a canonical route label.
 * e.g.  /api/bookings/abc-123  →  /api/bookings/:id
 */
function normaliseRoute(path) {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d+/g, '/:id')
    .replace(/\?.*$/, '');
}

/**
 * @param {import('prom-client').Histogram} histogram
 * @param {import('prom-client').Counter} counter
 */
module.exports = function metricsMiddleware(histogram, counter) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      const route = normaliseRoute(req.path);
      const labels = {
        method: req.method,
        route,
        status_code: String(res.statusCode),
      };

      histogram.observe(labels, durationSec);
      counter.inc(labels);
    });

    next();
  };
};
