# Quick start

## Prerequisites

- **Node 24 LTS** — any 24.x from 24.18 up (`node -v`). `.nvmrc` pins the
  exact version CI uses; with nvm, `nvm install` picks it up. nvm is optional.
- **pnpm 10** through Corepack: `corepack enable`. When Node is installed
  system-wide (apt, NodeSource, the official installer) that command needs root
  and fails with `EACCES … symlink … /usr/bin/pnpm`. Install the shim into your
  user instead, and make sure that folder is on your `PATH`:

  ```bash
  corepack enable --install-directory ~/.local/bin
  ```

- **Docker with Compose v2** — `docker compose version` must print a version.
  Ubuntu's `docker.io` package ships without it; add `docker-compose-v2`
  (`sudo apt install docker-compose-v2`).
- **Chrome, Chromium or Edge** for PDF export (incidents, certificates,
  reports). BeaconHS finds them in their standard install locations on Linux,
  macOS and Windows. Without one, install a headless Chrome and point
  `PUPPETEER_EXECUTABLE_PATH` in `.env` at the path it prints:

  ```bash
  npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/chrome-headless-shell
  ```

## One-click launchers

From the repo root:

- macOS: double-click `scripts/launchers/dev.command`
- Windows: double-click `scripts/launchers/dev.bat`
- Linux: run `scripts/launchers/install-linux-desktop.sh`, then launch
  **BeaconHS Dev** from your application menu

The launchers install dependencies when needed, start Docker services, run
`pnpm dev`, and clean up launcher-started processes on exit. They default to
`BEACONHS_DB_MODE=auto`: existing `.env` files with a remote `DATABASE_URL` keep
using the remote PG cluster, while fresh local clones use Docker Postgres. They
also start the Collabora editor when `COLLABORA_URL` in `.env` is local (the
`.env.example` default).

## Manual local setup

```bash
# 1. Prereqs (see above)
corepack enable       # pnpm via Corepack

# 2. Install dependencies
pnpm install

# 3. Configure env
cp .env.example .env
# (the local defaults work against the docker-compose services below)

# 4. Bring up local infra
docker compose --profile local-db up -d  # postgres:5433, redis:6380, minio:9000/9001, mailpit:8025

# 5. Set up the database
pnpm db:migrate       # apply migrations + install RLS policies
pnpm db:seed          # creates a super-admin + a 'demo' tenant with built-in roles

# 6. Run the app
pnpm dev              # registers scheduled jobs, then runs web (3000) + worker
```

Then open:

- App: <http://localhost:3000>
- Mailpit (catches outbound email): <http://localhost:8025>
- MinIO console: <http://localhost:9001> (login `beaconhs` / `beaconhs-dev-secret`)

`pnpm dev` loads the root `.env`, then registers repeating jobs (such as
compliance scans, digests, and scheduled reports) in Redis before starting the
web app and worker in watch mode. `pnpm db:migrate` and `pnpm db:seed` also load
the root `.env`. Shell-exported variables take precedence.

> Postgres is on **5433** and Redis on **6380** so they don't collide with
> common local services. `.env.example` already uses those ports. Maintainers
> with an existing `.env` that points at an external Postgres cluster can run
> `docker compose up -d` without the `local-db` profile and keep using that
> database.
>
> Fresh local Postgres volumes provision four separate roles automatically:
> the DML-only app login, the BYPASSRLS maintenance login, a migration-only
> login, and a NOLOGIN object owner. If your `postgres-data` volume predates
> this role split, back it up and run `scripts/cluster/provision.sql` as that
> volume's existing PostgreSQL superuser before using the current `.env`.

Maintainers using the shared dev PG cluster should keep their real `.env`
`DATABASE_URL` pointed at that cluster and start only the supporting services:

```bash
docker compose up -d
pnpm dev
```

Containers are named after the Compose project (the checkout folder by default),
so several checkouts can share a machine. Only one of them can publish the
ports above at a time; pass `-p <name>` to keep their containers and volumes
apart.

## Optional: in-browser Word and PowerPoint editor

Editing documents and building or playing slideshow lessons runs in Collabora
Online, a separate ~1.9 GB image that is not started by default. Start it with
its profile; `.env.example` already points the app at it:

```bash
docker compose --profile local-db --profile collabora up -d
```

Without it, those editors show as unavailable and the rest of the app works
normally.

## Default super-admin

After `pnpm db:seed`, sign in as `admin@beaconhs.local`. Use the **Magic link**
tab on the login form — the link will arrive in Mailpit at
<http://localhost:8025>.

## What is included

The workspace contains the complete web app, worker, scheduler, database
schema/migrations/RLS, authentication and tenant permissions, Builder form
designer and runtime, compliance engine, Insights dashboards, printable report
studio, document and training editors, storage, notifications, and integration
sync/outbound automation. The old plugin system is retired; use
**Integrations**. Company-specific migration adapters belong in the ignored
private ETL package and are not part of the public repository.

[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) is historical design context.
Verify any old phase/status note against current code before relying on it.
