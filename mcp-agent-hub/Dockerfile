FROM node:22-slim AS base
WORKDIR /app

# Install deps
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy source
COPY src/ src/
COPY log-commit.js ./

# Run migration on start, then start server
ENV PORT=3100
EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:3100/health || exit 1

CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
