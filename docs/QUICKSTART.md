# Quick start

## One-click launchers

From the repo root:

- macOS: double-click `scripts/launchers/dev.command`
- Windows: double-click `scripts/launchers/dev.bat`
- Linux: run `scripts/launchers/install-linux-desktop.sh`, then launch
  **BeaconHS Dev** from your application menu

The launchers install dependencies when needed, start Docker services, run
`pnpm dev`, and clean up launcher-started processes on exit. They default to
`BEACONHS_DB_MODE=auto`: existing `.env` files with a remote `DATABASE_URL` keep
using the remote PG cluster, while fresh local clones use Docker Postgres.

## Manual local setup

```bash
# 1. Prereqs
nvm use              # Node 24 LTS (see .nvmrc)
corepack enable       # pnpm via corepack

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
pnpm dev              # starts web (3000) + worker + scheduler in parallel
```

Then open:

- App: <http://localhost:3000>
- Mailpit (catches outbound email): <http://localhost:8025>
- MinIO console: <http://localhost:9001> (login `beaconhs` / `beaconhs-dev-secret`)

> Postgres is on **5433** and Redis on **6380** so they don't collide with
> common local services. `.env.example` already uses those ports. Maintainers
> with an existing `.env` that points at an external Postgres cluster can run
> `docker compose up -d` without the `local-db` profile and keep using that
> database.

Maintainers using the shared dev PG cluster should keep their real `.env`
`DATABASE_URL` pointed at that cluster and start only the supporting services:

```bash
docker compose up -d
pnpm dev
```

## Default super-admin

After `pnpm db:seed`, sign in as `admin@beaconhs.local`. Use the **Magic link**
tab on the login form — the link will arrive in Mailpit at
<http://localhost:8025>.

## What's wired vs scaffolded

| Area                                                         | State                           |
| ------------------------------------------------------------ | ------------------------------- |
| Monorepo + Turbo + pnpm workspaces                           | ✅                              |
| Postgres + Drizzle schema for every module                   | ✅                              |
| Row-level security policies                                  | ✅ (applied by `db:migrate`)    |
| Better-Auth (email/password + magic link)                    | ✅                              |
| Tenant context + permission catalogue + built-in roles       | ✅                              |
| Forms core (schema, validators, scoring, formula evaluator)  | ✅                              |
| Auto-PDF renderer via Puppeteer                              | ✅                              |
| BullMQ queues (emails, pdfs, notifications, scheduled ticks) | ✅                              |
| Worker process with handlers                                 | ✅                              |
| Integrations hub (sync in + outbound automations)            | ✅                              |
| Web app shell + login + module list pages                    | ✅                              |
| **Form designer UI**                                         | 🟡 stub — Phase 1 build         |
| **Form renderer UI**                                         | 🟡 stub — Phase 1 build         |
| **Module CRUD screens (incidents, training, etc.)**          | 🟡 stubs — Phase 2–3            |
| Dashboard widget builder                                     | 🟡 default tiles only — Phase 4 |
| Report builder                                               | 🟡 — Phase 4                    |
| Plugin SDK / first-party plugins                             | Retired; use Integrations       |
| External migration adapters                                  | 🟡 project-specific             |

See [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) for the full phased plan.
