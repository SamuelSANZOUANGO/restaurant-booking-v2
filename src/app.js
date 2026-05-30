const express = require('express');
const { v4: uuidv4 } = require('uuid');
const promClient = require('prom-client');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const config = require('./config');
const db = require('./database');
const metricsMiddleware = require('./middleware/metrics');
const errorInjectionMiddleware = require('./middleware/errorInjection');
const bookingRoutes = require('./routes/bookings');

const app = express();

// ── Prometheus metrics setup ──────────────────────────────────────────────────
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const httpRequestTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const activeBookings = new promClient.Gauge({
  name: 'restaurant_active_bookings',
  help: 'Number of active (non-cancelled) bookings',
  registers: [register],
});

const errorInjectionRate = new promClient.Gauge({
  name: 'error_injection_rate_percent',
  help: 'Configured error injection rate in percent',
  registers: [register],
});

// Set static gauge from config
errorInjectionRate.set(config.errorInjectionRate);

// Expose metrics & config to app locals so routes can use them
app.locals.register = register;
app.locals.metrics = { httpRequestDuration, httpRequestTotal, activeBookings };
app.locals.db = db;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(metricsMiddleware(httpRequestDuration, httpRequestTotal));

// Swagger docs
try {
  const swaggerDocument = YAML.load(`${__dirname}/../docs/openapi.yaml`);
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
} catch (e) {
  console.warn('Swagger docs not loaded:', e.message);
}

// ── Routes ────────────────────────────────────────────────────────────────────
// Health check (no error injection)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', uptime: process.uptime() });
});

// Metrics endpoint (no error injection)
app.get('/metrics', async (req, res) => {
  // Refresh active bookings gauge
  try {
    const rows = db.prepare(
      `SELECT COUNT(*) as count FROM bookings WHERE status != 'cancelled'`
    ).all();
    activeBookings.set(rows[0]?.count ?? 0);
  } catch (_) {}

  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Error injection applies only to booking API routes
app.use('/api', errorInjectionMiddleware(config.errorInjectionRate));
app.use('/api/bookings', bookingRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`🍽️  Restaurant Booking Service running on port ${PORT}`);
  console.log(`📊  Metrics available at http://localhost:${PORT}/metrics`);
  console.log(`📚  API Docs at http://localhost:${PORT}/docs`);
  console.log(`⚠️   Error injection rate: ${config.errorInjectionRate}%`);
});

module.exports = app;
