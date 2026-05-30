# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools needed by better-sqlite3 (native addon)
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine

LABEL maintainer="samuelsanzou"
LABEL org.opencontainers.image.title="restaurant-booking-service"
LABEL org.opencontainers.image.description="Restaurant table booking microservice"

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy from builder (node_modules already pruned to prod-only)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src         ./src
COPY --from=builder /app/docs        ./docs
COPY --from=builder /app/package.json .

# Ensure data dir is writable by app user
RUN mkdir -p /app/data && chown -R appuser:appgroup /app

USER appuser

ENV PORT=3000 \
    NODE_ENV=production \
    DB_PATH=/app/data/bookings.db \
    ERROR_INJECTION_RATE=10

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/app.js"]
