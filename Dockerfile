# syntax=docker/dockerfile:1.7
# Multi-stage build for beaconhs Next.js app + worker.
# Single image, two entrypoints, selected via $APP_ROLE (web | worker).

# Node 24 LTS matches local/CI runtime metadata and keeps the image on the
# supported production line.
ARG NODE_VERSION=24.18.0
FROM node:${NODE_VERSION}-bookworm-slim AS base
# Upgrade corepack first: bundled versions can ship stale pnpm signing keys and
# fail `pnpm install` with "Cannot find matching keyid".
RUN npm install -g corepack@latest && corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

# --- Builder ---
# Self-contained: install in place so pnpm's per-package node_modules + .bin
# symlinks (e.g. apps/web/.bin/next) exist. The previous split-stage approach
# copied only the ROOT node_modules, so workspace bins went missing → "next:
# not found". .dockerignore keeps node_modules/.next out of the context.
FROM base AS builder
COPY . .
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@beaconhs/web --filter=@beaconhs/worker
# `pnpm build` bundles the worker's first-party + @beaconhs/* code via esbuild,
# leaving only real npm deps as external imports. Emit a prod-only deployment
# with a HOISTED (flat) node_modules so those externals — including transitive
# deps of the bundled workspace packages, e.g. `postgres` via @beaconhs/db —
# all resolve from the top-level node_modules (pnpm's default isolated layout
# nests them and the bundle can't find them).
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    npm_config_node_linker=hoisted \
    pnpm --filter=@beaconhs/worker deploy --prod --legacy /prod/worker

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
COPY --from=builder /prod/worker ./apps/worker
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV APP_ROLE=web
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
