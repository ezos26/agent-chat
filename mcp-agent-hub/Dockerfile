FROM node:22-slim AS base
WORKDIR /app

# Install deps
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy source
COPY src/ src/
COPY log-commit.js ./
COPY healthcheck.js ./

# Run migration on start, then start server
ENV PORT=3100
EXPOSE 3100

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD node healthcheck.js || exit 1

CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
