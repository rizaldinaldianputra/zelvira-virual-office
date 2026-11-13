# Multi-stage Dockerfile for Zelvira / Hermes Virtual Office
# Node >=22 required for built-in node:sqlite (DatabaseSync)

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV OFFICE_DB_PATH=/app/data/office.db
ENV HERMES_HOME=/root/.hermes
ENV HERMES_BIN=/usr/local/bin/hermes

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/scripts ./scripts

RUN mkdir -p /app/data /root/.hermes

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e 'require("http").get("http://127.0.0.1:3000", (r) => { process.exit(r.statusCode === 200 || r.statusCode === 304 ? 0 : 1); })'

CMD ["npm", "run", "start"]
