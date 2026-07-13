# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
# Multi-stage build for beaconhs Next.js app + worker.
# Single image, role-specific entrypoints selected by $APP_ROLE
# (web | worker | scheduler | storage-init).

# Node 24 LTS matches local/CI runtime metadata and keeps the image on the
# supported production line.
ARG NODE_VERSION=24.18.0
ARG NODE_IMAGE_DIGEST=sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5
FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS base
# Upgrade corepack first: bundled versions can ship stale pnpm signing keys and
# fail `pnpm install` with "Cannot find matching keyid".
RUN npm install -g corepack@0.35.0 && corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

# --- Builder ---
# Self-contained: install in place so pnpm's per-package node_modules + .bin
# symlinks (e.g. apps/web/.bin/next) exist. The previous split-stage approach
# copied only the ROOT node_modules, so workspace bins went missing → "next:
# not found". .dockerignore keeps node_modules/.next out of the context.
FROM base AS builder
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN}
# The production type-analysis graph now exceeds V8's container default heap
# on clean BuildKit workers. Keep the larger ceiling in the builder only; the
# runtime image retains Node's normal memory policy.
ENV NODE_OPTIONS=--max-old-space-size=4096
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
ARG TARGETARCH
RUN test "$TARGETARCH" = amd64 || { echo "BeaconHS runtime requires linux/amd64" >&2; exit 1; }
ENV NODE_ENV=production

# Headless-browser shared libs for PDF rendering (worker), plus LibreOffice
# (Impress for the slides import, Writer for document version renders) +
# poppler (pdftoppm page images, pdfunite book concatenation).
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-liberation libnss3 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 ca-certificates curl unzip \
    libreoffice-impress libreoffice-writer poppler-utils \
    && rm -rf /var/lib/apt/lists/*
# PDF rendering uses a PINNED chrome-headless-shell (Chrome for Testing), not
# the distro chromium package: Debian's chromium floats with security updates
# and its 150.x build crashes (SIGTRAP) on headless launch in containers, which
# silently broke every PDF render. The pinned shell build is version-locked,
# print-oriented (no dbus/profile/signin subsystems), and puppeteer-tested.
ARG HEADLESS_SHELL_VERSION=140.0.7339.207
RUN npx --yes @puppeteer/browsers@3.0.6 install chrome-headless-shell@${HEADLESS_SHELL_VERSION} --path /opt/chrome \
    && shell_path="$(find /opt/chrome/chrome-headless-shell -type f -name chrome-headless-shell -perm -111 -print -quit)" \
    && test -n "$shell_path" \
    && ln -s "$shell_path" /usr/local/bin/chrome-headless-shell
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chrome-headless-shell

COPY --chown=node:node --from=builder /app/apps/web/.next/standalone ./
COPY --chown=node:node --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=node:node --from=builder /app/apps/web/public ./apps/web/public
COPY --chown=node:node --from=builder /prod/worker ./apps/worker
COPY --chown=node:node docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV APP_ROLE=web
ENV HOME=/home/node
EXPOSE 3000
USER node
ENTRYPOINT ["/entrypoint.sh"]
