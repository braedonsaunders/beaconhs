# Quick start

```bash
# 1. Prereqs
nvm use 20            # Node 20 LTS (see .nvmrc)
corepack enable       # pnpm via corepack

# 2. Install dependencies
pnpm install

# 3. Bring up local infra
docker compose up -d  # postgres:5432, redis:6379, minio:9000/9001, mailpit:8025

# 4. Configure env
cp .env.example .env
# (the defaults work against the docker-compose services above)

# 5. Set up the database
pnpm db:generate      # generate SQL from Drizzle schema
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
> other local instances. `.env.example` already uses those ports. If you start
> the web app outside `pnpm dev`, symlink the env: `ln -sfn ../../.env apps/web/.env.local`.

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
| Auto-PDF renderer via Puppeteer                              | ✅ (call-site stub)             |
| BullMQ queues (emails, pdfs, notifications, scheduled ticks) | ✅                              |
| Worker process with handlers                                 | ✅                              |
| Plugin SDK + manifest shape                                  | ✅                              |
| Web app shell + login + module list pages                    | ✅                              |
| **Form designer UI**                                         | 🟡 stub — Phase 1 build         |
| **Form renderer UI**                                         | 🟡 stub — Phase 1 build         |
| **Module CRUD screens (incidents, training, etc.)**          | 🟡 stubs — Phase 2–3            |
| Dashboard widget builder                                     | 🟡 default tiles only — Phase 4 |
| Report builder                                               | 🟡 — Phase 4                    |
| First-party plugins (NetSuite, adminapp2-sync)               | 🟡 — Phase 5                    |
| Migration ETL from beaconhs SQL Server                       | 🟡 — Phase 5                    |

See [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) for the full phased plan.
