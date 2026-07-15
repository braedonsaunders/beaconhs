<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/beaconhs-logo-dark.svg" />
    <img src=".github/assets/beaconhs-logo.svg" alt="beaconHS" width="520" />
  </picture>
</p>

<p align="center">
  <img src=".github/codeflow-card.svg" alt="CodeFlow card — codebase scale and structure snapshot" width="100%" />
</p>

<p align="center">
  <strong>The open-source Health, Safety &amp; Environment platform for industrial construction.</strong><br />
  Incidents, inspections, training, equipment, permits — and a form engine powerful
  enough to model your entire safety program.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="#the-builder">The Builder</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="docs/QUICKSTART.md">Docs</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/License-AGPL--3.0-1B2B4A" /></a>
  <a href="https://github.com/braedonsaunders/beaconhs/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/braedonsaunders/beaconhs/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000?logo=next.js&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" />
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind-4-38BDF8?logo=tailwindcss&logoColor=white" />
  <img alt="PostgreSQL RLS" src="https://img.shields.io/badge/PostgreSQL-RLS-4169E1?logo=postgresql&logoColor=white" />
  <a href="https://github.com/braedonsaunders/beaconhs/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/braedonsaunders/beaconhs?style=flat&color=F5A623" /></a>
</p>

---

## What is BeaconHS?

BeaconHS is a multi-tenant HSE platform built for the realities of industrial
construction — crews spread across sites, equipment that moves, certifications
that expire, permits that have to be signed before anyone enters a space, and an
auditor who will eventually ask for the paper trail.

BeaconHS is open source — **self-host it, extend it, or run it as the backbone of
your safety program.**

## Why BeaconHS is different

- **A form engine that replaces modules.** Most safety apps bolt a rigid form
  tool onto hard-coded screens. BeaconHS inverts that. A single serious
  **Builder** — conditional logic, formulas, repeating sections, entity lookups,
  scoring, drawn signatures, multi-step workflows, and a visual automation canvas
  — is powerful enough that job-specific paperwork like lift plans, JSAs,
  confined-space permits, and toolbox talks are _just templates_. Native modules
  are reserved for what every HSE program needs.
- **Multi-tenant from the first line.** PostgreSQL row-level security guards
  every tenant-scoped table. Isolation is enforced at the database, not just the
  app.
- **Self-serve BI, built in.** A native analytics engine (BHQL query builder,
  visualization suite, shareable dashboards) ships in-app — no third-party
  Metabase to bolt on.
- **An audit trail by default.** Every mutation writes a before/after diff.
- **Field-first.** Mobile-first UI for crews on site. The app is online-only;
  continuous autosave and resumable drafts protect work through intermittent
  connections, alongside QR-driven equipment and kiosk flows.

## Features

Every module is permission-aware, audited, and tenant-isolated. The sidebar is
itself editable per tenant — modules are registered, not hard-coded.

### Frontline

- **Inspections** — reusable criteria banks, inspection types, per-criterion
  severity / non-compliance reason / action-taken / corrected-date, customer
  signature, and assignment compliance roll-ups.
- **Hazard Assessments** — task → hazard → control risk assessments with pre- and
  post-control likelihood × severity ratings on a configurable risk matrix, PPE
  requirements, signatures by role, and one-click _copy assessment_.
- **Incidents** — full taxonomy plus a real investigation workflow (event
  timeline, contributing factors, 5-whys root cause, preventative steps),
  lost-time tracking, and TRIR / DART / OSHA-300A reporting.
- **Corrective Actions (CAPA)** — standalone or linked to any source, a
  verification step before close, aging reports, photo evidence, and bulk
  reassignment.
- **Journals** — structured daily logs for crews and supervisors.
- **Tools** — a registry of native safety calculators alongside Builder-app
  tools (e.g. safe-distance pressure-test calc).

### Programs

- **Training** — courses, scheduled classes with a calendar view, QR-verifiable
  PDF certificates, skills & certifying authorities, a person × course compliance
  matrix, transcripts, and course file attachments.
- **Documents** — a Word-class rich-text editor with version control, comments
  and track-changes, or uploaded PDF/DOCX sources; acknowledgment tracking,
  periodic reviews, document books, and DOCX import/export.
- **Lone Worker** — timed check-in sessions with overdue escalation, built on a
  reusable monitored-session engine.

### Assets & people

- **Equipment** — asset registry, QR labels (single + bulk), check-in/out,
  location history, work orders, expenses & rates, truck logs, fleet summary and
  ROI reports, and report-missing/found.
- **PPE** — issue / return / inspect lifecycle, per-type criteria, annual
  third-party recertification, and expiry & due reports.
- **People & org** — divisions, groups, job titles with task-acknowledgment
  matrices, an org chart, CSV bulk import, personal file uploads, and user
  signatures.
- **Locations** — sites, projects, and contacts with full activity history.

### Assurance

- **Compliance** — one unified obligations hub that rolls up assignments and
  compliance across every module by entity, person, and site.
- **Insights** — a native business-intelligence platform: a query engine, a
  visualization suite (tables, charts, pivots), drag-resize dashboards, and
  role-based sharing.
- **Reports** — a built-in report library, a custom report builder, and
  scheduled email delivery as HTML/PDF.

### Platform & overview

- **Dashboard** — a drag-resize widget grid with per-role defaults
  (super-admin / tenant-admin / safety-manager / foreman / worker) that each user
  can customize from a widget palette.
- **Feed** — a cross-module activity timeline (journals, incidents, corrective
  actions, forms, and more).
- **Notifications** — in-app inbox, email, and Web Push with per-category /
  per-channel preferences.
- **Admin** — multi-tenant management, users & roles, editable navigation,
  per-tenant **AI providers** (Anthropic / OpenAI / Google / OpenRouter / Groq /
  xAI / DeepSeek / Mistral / custom), **inbound data sync** connectors
  (database / NetSuite / CSV / Nango), API keys, audit log, email log, and a
  plugin registry.

## The Builder

The Builder is the heart of BeaconHS — the reason job-specific paperwork doesn't
require a new module.

- **Design visually.** Drag-and-drop layout with a rich field library: text,
  choice, date, calculated/formula fields, entity-attribute lookups (pick an
  equipment item → pull its live status), file/photo/video uploads, drawn
  signatures, and repeating sections.
- **Add logic.** Conditional `show-when` rules, per-field validation, default
  values, formula evaluation, compliance scoring with automatic flagging, and
  multi-step workflows with progress.
- **Automate.** A visual flow canvas wires gates and actions: email on submit,
  **spawn a corrective action or incident from a non-compliant response**,
  schedule recurring assignments, and escalate overdue check-ins.
- **Generate with AI.** Describe a form in plain language and have the configured
  per-tenant model scaffold it.
- **Fill anywhere.** A mobile-first filler with save-and-resume drafts that
  survive a dropped connection, plus kiosk and QR entry points for the field.

Forms can be surfaced as standalone **Apps** and even registered as **Tools** —
the same engine powers lift plans, JSAs, confined-space permits, and toolbox
talks as fully editable, per-tenant templates.

## Tech stack

| Layer     | Choice                                                   |
| --------- | -------------------------------------------------------- |
| Framework | Next.js 16 (App Router, Turbopack) + React 19            |
| Language  | TypeScript 6 (strict, `noUncheckedIndexedAccess`)        |
| Database  | PostgreSQL 16 with row-level security                    |
| ORM       | Drizzle                                                  |
| Auth      | Better-Auth (email/password + magic link)                |
| Styling   | Tailwind CSS 4 + a shared component library              |
| Jobs      | BullMQ on Redis (worker + scheduler)                     |
| Storage   | S3-compatible (MinIO in dev, Cloudflare R2 in prod)      |
| PDF       | Puppeteer render pipeline (forms, reports, certificates) |
| Monorepo  | Turborepo + pnpm workspaces                              |

## Architecture

BeaconHS is a Turborepo monorepo: two apps over a set of focused packages.
Tenant-scoped data is always accessed through a request-scoped DB executor that
sets the PostgreSQL RLS context, so isolation holds even if application code has
a bug.

```
apps/
  web/        Next.js app — UI, server actions, route handlers, kiosk/verify pages
  worker/     BullMQ worker + scheduler — PDFs, email, notifications, scans, imports
packages/
  db/         Drizzle schema, migrations, RLS policy installer, seeds, templates
  tenant/     Request context + RLS-scoped DB executor + permission/scope helpers
  auth/       Better-Auth server/client configuration
  events/     Module event bus → notifications & jobs
  jobs/       BullMQ queue definitions + Redis connection
  storage/    S3/R2 client + presigned uploads
  audit/      Before/after audit-record writer
  forms-core/ Form schema, field registry, validation, logic, formula, automations
  forms-pdf/  Server-side form/report/certificate PDF rendering
  design-studio/ Builder design-time tooling
  compliance/ Unified compliance evaluation + materialization
  reports/    Report library, custom query/run/filter/cadence engine
  analytics/  Insights BI engine (BHQL) + server split
  ai/         Per-tenant AI provider configuration + clients
  sync/       Inbound data-sync engine + connectors (database/NetSuite/CSV/Nango)
  integrations/ Outbound automation triggers + destinations
  ui/         Shared React component library
  emails/     Transactional email templates
```

Company-specific migration tooling is private, ignored, and excluded from the
public pnpm workspace. See [`docs/migration/README.md`](docs/migration/README.md)
for the maintainer-only boundary.

See [`AGENTS.md`](AGENTS.md) for the full repo map and engineering conventions.

## Quick start

You'll need **Node 24 LTS**, **pnpm 10+**, and **Docker**.

One-click launchers live in [`scripts/launchers`](scripts/launchers):

- **macOS** — double-click `scripts/launchers/dev.command`
- **Windows** — double-click `scripts/launchers/dev.bat`
- **Linux** — run `scripts/launchers/install-linux-desktop.sh`, then launch
  **BeaconHS Dev** from your application menu

Or set it up manually:

```bash
# 1. Install dependencies
corepack enable
pnpm install

# 2. Configure env (local defaults target the docker-compose services)
cp .env.example .env

# 3. Bring up local infra (Postgres, Redis, MinIO, Mailpit)
docker compose --profile local-db up -d

# 4. Set up the local database (schema + RLS policies + seed data)
pnpm db:migrate
pnpm db:seed

# 5. Run the app, worker, and scheduler
pnpm dev
```

Then open:

| Service                          | URL                   |
| -------------------------------- | --------------------- |
| App                              | http://localhost:3000 |
| Mailpit (catches outbound email) | http://localhost:8025 |
| MinIO console                    | http://localhost:9001 |

Sign in as the seeded super-admin `admin@beaconhs.local` via the **Magic link**
tab — the link arrives in Mailpit.

Full details, ports, and gotchas: **[`docs/QUICKSTART.md`](docs/QUICKSTART.md)**.
Production backup, restore, deployment, and incident procedures:
**[`docs/PRODUCTION_RUNBOOK.md`](docs/PRODUCTION_RUNBOOK.md)**.

> [!TIP]
> AI providers, model, and API key are configured **per tenant** in
> Admin → AI and encrypted at rest — nothing AI-related belongs in `.env`.

## Roadmap

The module surface is built; the focus now is hardening, depth, and migration
tooling. The phased plan and architectural decisions live in
**[`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)** — verify status
against current code, as it doubles as product history.

## Contributing

Contributions are welcome — issues, discussions, and PRs all help.

1. Fork the repo and create a feature branch.
2. `pnpm install` and follow the [Quick start](#quick-start).
3. Keep changes type-safe (`pnpm typecheck`), linted (`pnpm lint`), formatted
   (`pnpm format:check`), and migrations idempotent.
4. Open a PR describing the change and the workflow it improves.

If you run an HSE program and something here doesn't match how your crews
actually work, that feedback is gold — [open an issue](https://github.com/braedonsaunders/beaconhs/issues).

## Security

Tenant isolation is enforced at the database with PostgreSQL row-level security,
and every mutation is audited. If you discover a vulnerability, please report it
privately via a [GitHub security advisory](https://github.com/braedonsaunders/beaconhs/security/advisories/new)
rather than opening a public issue.

## License

BeaconHS is licensed under the
**[GNU Affero General Public License v3.0](LICENSE)**.

In plain terms: you're free to use, modify, and self-host it — but if you run a
modified version as a network service, you must make your modified source
available to its users. See [`LICENSE`](LICENSE) for the full terms.

Copyright © 2026 the BeaconHS contributors.

---

<p align="center">
  <a href="https://star-history.com/#braedonsaunders/beaconhs&Date">
    <img alt="Star history" src="https://api.star-history.com/svg?repos=braedonsaunders/beaconhs&type=Date" width="600" />
  </a>
</p>

<p align="center">
  <em>Built by the community. For the community.</em><br />
  If BeaconHS is useful to you, consider giving it a ⭐.
</p>
