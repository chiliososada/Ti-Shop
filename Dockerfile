# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:24.18.0-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5 AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Prisma's CLI detects the system OpenSSL version during client generation.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

FROM dependencies AS migrator

ENV NODE_ENV=production

COPY prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src/lib/postgres-connection-url.ts ./src/lib/postgres-connection-url.ts
COPY scripts/grant-admin.ts scripts/verify-user-email.ts ./scripts/
COPY scripts/lib/admin-identity-cli.ts scripts/lib/admin-identity-operations.ts ./scripts/lib/
RUN npm run db:generate

USER node

CMD ["npm", "run", "db:deploy"]

FROM dependencies AS operations

ENV NODE_ENV=production

COPY . .
RUN npm run db:generate

USER node

CMD ["npm", "run", "payments:reconcile:nowpayments"]

FROM base AS builder

COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/ready`).then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
