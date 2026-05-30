#🍽️ Restaurant Booking Service
### Author : SANZOUANGO NOAH Israel Samuel

A production-grade **Node.js microservice** implementing a CRUD REST API for restaurant table bookings, with:

- **Configurable 5xx error injection** (simulates real-world failures)
- **Prometheus metrics** exposed at `/metrics`
- **Grafana dashboard** provisioned automatically
- **k6 load tests** for stress simulation
- **Kubernetes manifests** + **ArgoCD Application** for GitOps deployment
- **Swagger / OpenAPI 3.0** documentation at `/docs`

---

## Architecture

```
┌─────────────┐     REST     ┌──────────────────────┐     SQLite
│  k6 / curl  │────────────▶│  booking-service:3000 │◀──────────────▶ /data/bookings.db
└─────────────┘             └──────────┬───────────┘
                                       │ /metrics
                            ┌──────────▼──────────┐
                            │   Prometheus:9090    │
                            └──────────┬──────────┘
                                       │
                            ┌──────────▼──────────┐
                            │   Grafana:3001       │
                            └─────────────────────┘
```

---

## Quick Start (Docker Compose)

```bash
# 1. Clone
git clone https://github.com/SamuelSANZOUANGO/restaurant-booking-v2.git
cd restaurant-booking-service

# 2. Start everything
docker compose up -d

# 3. Open
#   API:      http://localhost:3000/api/bookings
#   Swagger:  http://localhost:3000/docs
#   Metrics:  http://localhost:3000/metrics
#   Grafana:  http://localhost:3001  (admin / admin)
#   Prom:     http://localhost:9090
```

### Change the error injection rate

Edit `docker-compose.yml` → `booking-service.environment.ERROR_INJECTION_RATE`, or:

```bash
ERROR_INJECTION_RATE=25 docker compose up -d booking-service
```

---

## Configuration

All settings live in `.env` (or Kubernetes `ConfigMap`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `development` | Environment label |
| `DB_PATH` | `./data/bookings.db` | SQLite file path |
| `ERROR_INJECTION_RATE` | `10` | **% of `/api/*` requests that return a random 5xx** |

---

## REST API

Base URL: `http://localhost:3000/api`

### Bookings

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/bookings` | List all bookings (supports `?status=`, `?date=`, `?email=`, `?limit=`, `?offset=`) |
| `POST` | `/bookings` | Create a booking |
| `GET` | `/bookings/:id` | Get a single booking |
| `PUT` | `/bookings/:id` | Full replace |
| `PATCH` | `/bookings/:id` | Partial update (status, notes, etc.) |
| `DELETE` | `/bookings/:id` | Cancel a booking |

### Tables & Availability

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/bookings/tables` | List all restaurant tables |
| `GET` | `/bookings/availability?date=YYYY-MM-DD&time=HH:MM` | Available tables |

### System

| Path | Description |
|------|-------------|
| `/health` | Liveness check |
| `/metrics` | Prometheus exposition |
| `/docs` | Swagger UI |

### Example: Create a booking

```bash
curl -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "table_id": 3,
    "customer_name": "Alice Martin",
    "customer_email": "alice@example.com",
    "party_size": 2,
    "booking_date": "2025-08-15",
    "booking_time": "19:30",
    "notes": "Anniversary dinner"
  }'
```

---

## Error Injection

The middleware at `src/middleware/errorInjection.js` intercepts every `/api/*` request and,
with probability `ERROR_INJECTION_RATE / 100`, returns one of:

| Code | Message |
|------|---------|
| `500` | Internal Server Error – simulated fault |
| `502` | Bad Gateway – upstream connection failed |
| `503` | Service Unavailable – temporarily overloaded |
| `504` | Gateway Timeout – upstream did not respond |

The injected response always includes `"injected": true` so you can distinguish it from real errors.

---

## Prometheus Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `http_requests_total` | Counter | Total requests, labelled `method`, `route`, `status_code` |
| `http_request_duration_seconds` | Histogram | Request latency distribution |
| `restaurant_active_bookings` | Gauge | Non-cancelled bookings in DB |
| `error_injection_rate_percent` | Gauge | Configured injection rate |
| `process_*`, `nodejs_*` | Built-in | Node.js default metrics |

---

## Grafana Dashboard

Auto-provisioned at `http://localhost:3001` → folder **Restaurant**.

Panels:
- **Request Rate** (req/s)
- **5xx Error Rate** (%)
- **P95 Latency**
- **Active Bookings** count
- **Error Injection Rate** config gauge
- Time-series: requests by status code, latency percentiles, error rate vs expected
- Table: per-route/method breakdown

---

## k6 Load Tests

```bash
# Install k6
brew install k6   # macOS
# or: https://k6.io/docs/getting-started/installation/

# Smoke test (1 VU, 30s)
k6 run k6/smoke-test.js

# Full load test (ramp up → 100 VUs → cool-down, ~7 min)
k6 run k6/load-test.js

# Override base URL
ifconfig : print etho address IP

k6 run --env BASE_URL=http://AddressIP_PC k6/load-test.js

or

k6 run --env BASE_URL=http://staging.example.com k6/load-test.js
```

Load test stages:

| Stage | Duration | VUs |
|-------|----------|-----|
| Ramp-up | 1m | 0 → 20 |
| Steady state | 3m | 50 |
| Spike | 1m | 100 |
| Recovery | 1m | 20 |
| Cool-down | 1m | 0 |

---

## Kubernetes Deployment

### Manifests (apply in order)

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/service-monitor.yaml  # requires Prometheus Operator
```

### Verify

```bash
# Pod running?
kubectl get pods -n restaurant

# Metrics accessible?
kubectl port-forward -n restaurant svc/booking-service 3000:80
curl http://localhost:3000/metrics

# Prometheus target visible?
# Open http://localhost:9090/targets  →  look for  booking-service
```

### Tune error rate

```bash
kubectl edit configmap booking-service-config -n restaurant
# Change ERROR_INJECTION_RATE value, then restart deployment:
kubectl rollout restart deployment/booking-service -n restaurant
```

---

## ArgoCD

```bash
# Apply the Application (ArgoCD watches k8s/ folder in this repo)
kubectl apply -f k8s/argocd-application.yaml -n argocd

# Sync manually
argocd app sync restaurant-booking
```

---

## Development

```bash
npm install
npm run dev     # nodemon hot-reload
npm test        # jest
```

---

## Project Structure

```
restaurant-booking-service/
├── src/
│   ├── app.js                   # Express entry point
│   ├── config.js                # All configuration (reads .env)
│   ├── database.js              # SQLite setup + seed
│   ├── middleware/
│   │   ├── errorInjection.js    # 5xx injection middleware
│   │   └── metrics.js           # Prometheus request tracking
│   └── routes/
│       └── bookings.js          # CRUD endpoints
├── k8s/
│   ├── namespace.yaml
│   ├── configmap.yaml           # ERROR_INJECTION_RATE lives here
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── service-monitor.yaml     # Prometheus Operator ServiceMonitor
│   └── argocd-application.yaml
├── k6/
│   ├── smoke-test.js
│   └── load-test.js
├── prometheus/
│   └── prometheus.yml
├── grafana/
│   └── provisioning/
│       ├── datasources/prometheus.yaml
│       └── dashboards/
│           ├── dashboard.yaml
│           └── restaurant-booking.json
├── docs/
│   └── openapi.yaml             # Swagger / OpenAPI 3.0 spec
├── .env                         # Local config (not committed)
├── .github/workflows/ci.yml     # GitHub Actions CI
├── docker-compose.yml
├── Dockerfile
└── package.json
```
