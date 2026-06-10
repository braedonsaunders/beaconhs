# syntax=docker/dockerfile:1.7
# Multi-stage build for beaconhs Next.js app + worker.
# Single image, two entrypoints, selected via $APP_ROLE (web | worker).

ARG NODE_VERSION=20.18.0
FROM node:${NODE_VERSION}-bookworm-slim AS base
# Upgrade corepack first: the version bundled with node 20.18 ships stale pnpm
# signing keys and fails `pnpm install` with "Cannot find matching keyid".
RUN npm install -g corepack@latest && corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# --- Dependencies layer ---
FROM base AS deps
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages packages
COPY plugins plugins
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# --- Builder ---
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm turbo run build --filter=@beaconhs/web --filter=@beaconhs/worker

# --- Runtime ---
FROM base AS runner
ENV NODE_ENV=production

# Puppeteer / Chromium deps for PDF rendering (worker), plus LibreOffice +
# poppler for the LMS PowerPoint→slides import (soffice → pdf → pdftoppm).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation libnss3 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 ca-certificates curl \
    libreoffice-impress poppler-utils \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV APP_ROLE=web
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
