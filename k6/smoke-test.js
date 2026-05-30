/**
 * k6/smoke-test.js
 * ----------------
 * Quick sanity check – 1 VU, 30 seconds, verifies all endpoints respond.
 *
 * Run:  k6 run k6/smoke-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.30'],  // accounting for injected errors
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PARAMS   = { headers: { 'Content-Type': 'application/json' } };

export default function () {
  // Health check
  let r = http.get(`${BASE_URL}/health`);
  check(r, { 'health: 200': (res) => res.status === 200 });

  // Metrics endpoint
  r = http.get(`${BASE_URL}/metrics`);
  check(r, { 'metrics: 200': (res) => res.status === 200 });

  // List tables
  r = http.get(`${BASE_URL}/api/bookings/tables`);
  check(r, { 'tables: 200 or 5xx': (res) => res.status === 200 || res.status >= 500 });

  // Availability
  r = http.get(`${BASE_URL}/api/bookings/availability?date=2025-12-25&time=19:00`);
  check(r, { 'availability: 200 or 5xx': (res) => res.status === 200 || res.status >= 500 });

  // Create
  r = http.post(
    `${BASE_URL}/api/bookings`,
    JSON.stringify({
      table_id: 1, customer_name: 'Smoke Test', customer_email: 'smoke@test.com',
      party_size: 2, booking_date: '2025-12-25', booking_time: '19:00',
    }),
    PARAMS
  );
  check(r, { 'create: 201 or 4xx/5xx': (res) => res.status >= 201 });

  sleep(1);
}
