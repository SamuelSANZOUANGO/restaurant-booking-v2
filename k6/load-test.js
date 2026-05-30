/**
 * k6/load-test.js
 * ---------------
 * Comprehensive k6 load test for the Restaurant Booking Service.
 *
 * Run:
 *   k6 run k6/load-test.js
 *   k6 run --env BASE_URL=http://my-host:3000 k6/load-test.js
 *
 * Stages:
 *   0-1m   : ramp up to 20 VUs  (warm-up)
 *   1-4m   : hold at 50 VUs     (steady-state load)
 *   4-5m   : spike to 100 VUs   (peak load)
 *   5-6m   : drop to 20 VUs     (recovery)
 *   6-7m   : ramp down to 0     (cool-down)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';

// ── Custom metrics ────────────────────────────────────────────────────────────
const createLatency   = new Trend('booking_create_duration_ms', true);
const listLatency     = new Trend('booking_list_duration_ms', true);
const getLatency      = new Trend('booking_get_duration_ms', true);
const updateLatency   = new Trend('booking_update_duration_ms', true);
const deleteLatency   = new Trend('booking_delete_duration_ms', true);
const errorCount      = new Counter('http_5xx_total');
const errorRate       = new Rate('http_error_rate');

// ── Options ───────────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: '1m',  target: 20  },   // ramp-up
    { duration: '3m',  target: 50  },   // steady state
    { duration: '1m',  target: 100 },   // spike
    { duration: '1m',  target: 20  },   // recovery
    { duration: '1m',  target: 0   },   // cool-down
  ],
  thresholds: {
    http_req_duration:           ['p(95)<1000'],   // 95% of requests under 1s
    http_req_failed:             ['rate<0.20'],    // < 20% failure (accounts for injected errors)
    booking_create_duration_ms:  ['p(95)<800'],
    booking_list_duration_ms:    ['p(95)<500'],
  },
};

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const PARAMS = {
  headers: { 'Content-Type': 'application/json' },
  timeout: '10s',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function randomDate() {
  const today = new Date();
  today.setDate(today.getDate() + Math.floor(Math.random() * 30) + 1);
  return today.toISOString().slice(0, 10);
}

function randomTime() {
  const hours   = 12 + Math.floor(Math.random() * 9);   // 12:00 – 20:00
  const minutes = Math.random() > 0.5 ? '00' : '30';
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

function randomEmail() {
  return `test${Math.floor(Math.random() * 100000)}@loadtest.example`;
}

function checkResponse(res, tag) {
  const is5xx = res.status >= 500;
  if (is5xx) {
    errorCount.add(1);
    errorRate.add(1);
  } else {
    errorRate.add(0);
  }
  return is5xx;
}

// ── Default function (VU scenario) ───────────────────────────────────────────
export default function () {
  let createdId = null;

  // ── 1. List all bookings ──────────────────────────────────────────────────
  group('LIST bookings', () => {
    const res = http.get(`${BASE_URL}/api/bookings?limit=10`, PARAMS);
    listLatency.add(res.timings.duration);
    check(res, {
      'list: status 200 or 5xx': (r) => r.status === 200 || r.status >= 500,
    });
    checkResponse(res, 'list');
  });

  sleep(0.2);

  // ── 2. Check availability ─────────────────────────────────────────────────
  group('CHECK availability', () => {
    const date = randomDate();
    const time = randomTime();
    const res  = http.get(
      `${BASE_URL}/api/bookings/availability?date=${date}&time=${time}&party_size=2`,
      PARAMS
    );
    check(res, {
      'availability: status 200 or 5xx': (r) => r.status === 200 || r.status >= 500,
    });
    checkResponse(res, 'availability');
  });

  sleep(0.3);

  // ── 3. Create a booking ────────────────────────────────────────────────────
  group('CREATE booking', () => {
    const tableId   = Math.floor(Math.random() * 16) + 1;
    const payload   = JSON.stringify({
      table_id:       tableId,
      customer_name:  `Test User ${Math.floor(Math.random() * 10000)}`,
      customer_email: randomEmail(),
      customer_phone: '+1-555-0100',
      party_size:     Math.floor(Math.random() * 3) + 1,
      booking_date:   randomDate(),
      booking_time:   randomTime(),
      duration_min:   90,
      notes:          'Load test booking',
    });

    const res = http.post(`${BASE_URL}/api/bookings`, payload, PARAMS);
    createLatency.add(res.timings.duration);

    const ok = check(res, {
      'create: 201 or 4xx/5xx': (r) => r.status === 201 || r.status >= 400,
    });

    if (!checkResponse(res, 'create') && res.status === 201) {
      try {
        createdId = JSON.parse(res.body).data.id;
      } catch (_) {}
    }
  });

  sleep(0.5);

  // ── 4. Get the booking we just created ────────────────────────────────────
  if (createdId) {
    group('GET booking', () => {
      const res = http.get(`${BASE_URL}/api/bookings/${createdId}`, PARAMS);
      getLatency.add(res.timings.duration);
      check(res, {
        'get: 200 or 5xx': (r) => r.status === 200 || r.status >= 500,
      });
      checkResponse(res, 'get');
    });

    sleep(0.3);

    // ── 5. PATCH (update) the booking ───────────────────────────────────────
    group('PATCH booking', () => {
      const res = http.patch(
        `${BASE_URL}/api/bookings/${createdId}`,
        JSON.stringify({ notes: 'Updated by k6 load test' }),
        PARAMS
      );
      updateLatency.add(res.timings.duration);
      check(res, {
        'patch: 200 or 5xx': (r) => r.status === 200 || r.status >= 500,
      });
      checkResponse(res, 'patch');
    });

    sleep(0.3);

    // ── 6. DELETE (cancel) the booking ──────────────────────────────────────
    group('DELETE booking', () => {
      const res = http.del(`${BASE_URL}/api/bookings/${createdId}`, null, PARAMS);
      deleteLatency.add(res.timings.duration);
      check(res, {
        'delete: 200 or 5xx': (r) => r.status === 200 || r.status >= 500,
      });
      checkResponse(res, 'delete');
    });
  }

  sleep(Math.random() * 1 + 0.5);  // 0.5–1.5s think time
}

// ── Setup: verify service is up ───────────────────────────────────────────────
export function setup() {
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    throw new Error(`Service not healthy: ${res.status} ${res.body}`);
  }
  console.log(`✅ Service healthy at ${BASE_URL}`);
}
