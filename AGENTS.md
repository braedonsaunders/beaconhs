# AGENTS.md

## Mission

BeaconHS is a pre-launch, multi-tenant Health, Safety & Environment platform for
industrial construction. Treat the repository as a greenfield production system
headed for a hard cutover, not as a prototype. Agents should leave the app more
coherent than they found it.

## Non-Negotiable Engineering Rules

1. All code is to be clean cutover -> leave no legacy code. The app has not launched yet, so do not preserve old paths, compatibility shims, deprecated APIs, or duplicate flows unless the user explicitly asks for a temporary migration step.
2. All features shipped should be complete production-grade code, no stubs, placeholders, mock implementations, TODO-driven behavior, fake data paths, or "wire it later" branches.
3. If you see a bug or issue when doing something, stop and fix it even if unrelated. If it is too large to fix safely in the current pass, clearly flag it before continuing.
4. Ensure that before you build something new, there is no duplicate thing already built. Search first, inspect nearby modules, and reuse the existing system where it fits.
5. Always unify existing systems and abstract shared behavior when it reduces real duplication or reconciles competing implementations.
6. No dead code, duplicate implementations, abandoned files, unused exports, stale routes, or shadow systems. Always immediately flag and clean up dead or duplicate code.
7. Keep the in-app user guide truthful. Whenever you add, change, remove, or rename a user-facing feature, route, button, or flow, update the matching manual article(s) in `apps/web/src/lib/manual/content/*` (and add a new article for a new module) in the same change. If the change moves or renames anything a guided tour points at, update the walkthrough steps in `apps/web/src/lib/walkthroughs/registry.ts` too. See "In-app user guide & walkthroughs" below.
8. ALWAYS ensure CI is green before you consider work done — never push code that fails a gate. Before committing/pushing, run the full CI gate set locally and make every one pass: `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. Formatting (`prettier`), linting, typecheck, and tests are non-negotiable — a red pipeline blocks the hard cutover. If you push and CI goes red, drop everything and fix it immediately in a follow-up commit. Do not disable, `--no-verify`, skip, or `eslint-disable`/`ts-ignore` your way around a failing gate to make it pass; fix the underlying issue. Capture each gate's own exit code (don't pipe to `tail` and read `$?`).

## Quick Start

- Runtime: Node 24 LTS (`.nvmrc`), pnpm 10.30.3, Docker.
- Install: `corepack enable` then `pnpm install`.
- Env: copy `.env.example` to `.env`.
- Local infra: `docker compose --profile local-db up -d` starts Postgres on 5433, Redis on 6380, MinIO on 9000/9001, and Mailpit on 8025.
- DB setup: `pnpm db:migrate` then `pnpm db:seed`.
- Dev app: `pnpm dev` starts the web app, worker, and scheduler through Turbo.
- App: `http://localhost:3000`.
- Mailpit: `http://localhost:8025`.
- Seeded super-admin: `admin@beaconhs.local`; use the Magic link tab and open the link from Mailpit.

Useful launchers also live in `scripts/launchers/`.

## Validation Commands

- Full build: `pnpm build`.
- Full typecheck: `pnpm typecheck`.
- Full lint: `pnpm lint`.
- Full tests: `pnpm test`.
- Format check: `pnpm format:check`.
- Targeted package checks: `pnpm --filter @beaconhs/web typecheck`, `pnpm --filter @beaconhs/forms-core test`, etc.
- Database: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:studio`.

Run the narrowest meaningful checks while iterating, then broaden when touching
shared packages, database schema, auth, tenant scoping, workers, or UI primitives.

CI runs `format:check`, `typecheck`, `lint`, `test`, and `build` on every push to
`main`. Before you commit and push, run all of them locally and confirm each
passes — CI must stay green (see Non-Negotiable rule 8). A common miss is
formatting: always run `pnpm format:check` (or `pnpm exec prettier --write` on the
files you touched) before pushing, since editors and codegen frequently leave
Prettier violations that fail CI.

## Repo Map

- `apps/web`: Next.js 16 App Router app. UI, route handlers, server actions,
  authenticated app shell, public login/kiosk/verification pages.
- `apps/worker`: BullMQ worker and scheduler for PDFs, email, notifications,
  scheduled reports, compliance scans, plugin cron work, and imports.
- `packages/db`: Drizzle schema, migrations, RLS policy installer, seed data,
  canonical templates, DB client helpers.
- `packages/tenant`: request context, tenant-scoped DB executor, permission and
  scope helpers.
- `packages/auth`: Better-Auth server/client configuration.
- `packages/forms-core`: form schema, field registry, validation, formula,
  conditional logic, scoring, automation primitives.
- `packages/forms-pdf`: server-side PDF rendering helpers.
- `packages/ui`: shared React components and styling primitives.
- `packages/compliance`: unified compliance evaluation/materialization.
- `packages/reports`: built-in reports, custom query/run/filter/cadence logic.
- `packages/jobs`: BullMQ queue definitions and Redis connection.
- `packages/events`: module event fan-out into notifications/jobs.
- `packages/storage`: S3-compatible storage client for MinIO/R2.
- `packages/ai`, `packages/audit`, `packages/emails`, `packages/sync`,
  `packages/integrations`: supporting platform packages.
- `packages/etl`: optional company-specific package in authorized local
  checkouts only. It is Git-ignored and excluded from the public workspace and
  lockfile; install and run it independently.
- `docs/QUICKSTART.md`: local setup details.
- `docs/IMPLEMENTATION_PLAN.md`: product history and implementation context;
  verify against current code before trusting old status notes.

## Architecture Rules

- This is a pnpm/Turbo workspace. Prefer workspace packages over local copies.
- Use TypeScript strictly. The base config enables `strict`,
  `noUncheckedIndexedAccess`, `noImplicitOverride`, and related checks.
- Use Drizzle for database access. Do not add ad hoc SQL unless it is the right
  tool for a migration, policy, or query Drizzle cannot express cleanly.
- Tenant-scoped app data must run through `ctx.db(...)` from
  `requireRequestContext()` / `getRequestContext()` so Postgres RLS is applied.
- Only use root `db` with an explicit `withSuperAdmin`, `withTenant`, or
  transaction that sets the needed RLS config, and only when that scope is
  intentional.
- Every tenant table needs `tenant_id`, RLS coverage in `TENANT_SCOPED_TABLES`,
  and an idempotent migration path.
- Use schema helpers in `packages/db/src/schema/_helpers.ts` for IDs,
  timestamps, soft deletes, tenant FKs, and typed JSON conventions.
- Server mutations should check permissions with `assertCan`, write audit
  records with `recordAudit`, and revalidate affected paths.
- Keep module-specific business logic near its module until there is a proven
  shared abstraction. When multiple modules do the same thing, unify them in a
  package or shared component.
- Prefer existing queue/event/storage/report/compliance/form primitives over
  inventing new parallel systems.

## Web App Conventions

- Authenticated pages live under `apps/web/src/app/(app)`.
- Public pages live outside that group: `login`, `kiosk`, `verify`, API auth
  routes, manifest, etc.
- The authenticated layout forces dynamic rendering, resolves tenant context,
  gets unread notifications, resolves sidebar navigation, and renders
  `AppShell`.
- Navigation comes from `apps/web/src/lib/nav/registry.ts` plus tenant saved
  overrides. Add modules there instead of hardcoding sidebar entries.
- Use the existing page shells from `apps/web/src/components/page-layout.tsx`:
  `PageContainer`, `ListPageLayout`, `DetailPageLayout`, and `WizardLayout`.
- Use `@beaconhs/ui` for buttons, inputs, cards, tables, badges, drawers,
  popovers, rich text, uploaders, signatures, skeletons, and page headers.
- Use `lucide-react` icons; keep operational UI dense, calm, and scannable.
- Styling is Tailwind with class-based dark mode via `.dark`. Preserve light and
  dark states when changing UI.
- NON-NEGOTIABLE: every table or list of records — module list pages,
  detail-page sub-tables, dashboards, cockpit work lists, admin tables —
  ships with search, relevant filters, and pagination. URL-driven via the
  shared primitives (`parseListParams`, `SearchInput`, `FilterChips`,
  `SortableTh`, `Pagination`, or the prefixed sub-table param pattern on
  multi-table pages). Never render an unbounded or unsearchable table.
- CSV/PDF/export routes should audit exports and respect tenant context.

## Data, Auth, and Permissions

- `getRequestContext()` in `apps/web/src/lib/auth.ts` is the main request entry.
  It resolves the active tenant, membership, super-admin state, permissions,
  and provides the tenant-bound DB helper.
- `RequestContext` and permission helpers live in `packages/tenant`.
- Super-admin can view tenants, but app data should still be intentionally
  tenant-bounded unless the feature is truly cross-tenant admin.
- Permissions use strings with wildcard support, e.g. `incidents.*`.
- Mutations should be explicit about the permission they require.
- Better-Auth tables are global; most BeaconHS module tables are tenant-scoped.

## Database and Migrations

- Drizzle schema files live in `packages/db/src/schema` and are re-exported from
  `packages/db/src/schema/index.ts`.
- Migrations live in `packages/db/drizzle`.
- After adding or changing tenant-scoped tables, update
  `packages/db/src/rls.ts` so RLS policies are installed.
- Keep migrations idempotent where the existing migration style allows.
- Seed data lives in `packages/db/src/seed.ts` and related seed helpers.
- Never bypass RLS to "make it work"; fix the context, schema, or policy.

## Workers and Background Jobs

- Worker entrypoints are in `apps/worker/src/index.ts` and
  `apps/worker/src/scheduler.ts`.
- Queue definitions live in `packages/jobs`; do not create one-off queue names.
- Worker handlers live under `apps/worker/src/workers`.
- Shared worker logic belongs in `apps/worker/src/lib` or a package when used by
  web and worker code.
- Jobs that mutate tenant data must establish the correct tenant/RLS context.

## Forms, Compliance, Reports, and Modules

- The form engine is central: schema and logic are in `packages/forms-core`;
  designer/filler UI lives in the web app.
- Compliance is unified through `compliance_obligations`, `compliance_audience`,
  `compliance_dispatches`, and `compliance_status`; use
  `@beaconhs/compliance` instead of per-module compliance copies.
- Reports are unified through `packages/reports` and the `/reports` web module.
- Before adding a native module, verify it cannot be a configuration of forms,
  compliance, reports, data sources, or an existing module.
- If two routes or packages solve the same product concept, consolidate them.

## In-app User Guide & Walkthroughs

- The platform ships a built-in, permission-aware user manual at `/help`,
  written in plain language for non-technical construction trades workers.
- Articles are code: `apps/web/src/lib/manual/content/*` (typed by
  `apps/web/src/lib/manual/types.ts`, assembled in
  `apps/web/src/lib/manual/registry.ts`). Visibility gates mirror the nav
  registry's permissions so people only see help for features they can open.
- The AI assistant reads the same registry via the `search_user_guide` /
  `read_user_guide` tools — a stale article means the assistant gives wrong
  instructions, not just a stale page.
- Guided tours (spotlight walkthroughs) are defined in
  `apps/web/src/lib/walkthroughs/registry.ts`; per-tenant role/auto-start
  config lives in `walkthrough_settings` and is edited at
  `/admin/walkthroughs` (with Preview). Steps target
  `data-walkthrough="..."` attributes and stable `a[href="..."]` selectors —
  keep those attributes when refactoring the components they sit on.
- MANDATORY: any change to user-facing UI or flows updates the affected
  manual articles and walkthrough steps in the same commit. New module =
  new article (+ tour if it's a frontline task). Removed/renamed feature =
  article and steps updated. Manual style: short sentences, numbered steps,
  bold the exact button labels, no jargon.

## Quality Bar

- Production-grade means permissions, validation, empty/loading/error states,
  audit logs, tenant isolation, persistence, revalidation, and tests or focused
  verification where the risk justifies it.
- No fake success paths. If an external service is missing, surface a real
  configuration error or graceful disabled state.
- No silent data corruption. Validate inputs with existing schemas/utilities or
  add a shared validator.
- No unreachable UI. Add navigation, permissions, and route handling together.
- No orphaned schema. UI, actions, seed/migration/RLS, and worker/report hooks
  should land as one complete change when the feature requires them.
- Keep accessibility and responsive behavior intact. The app is used in the
  field, often on tablets and small screens.

## Search First Checklist

Before implementing a new feature or helper:

- Search route names, table names, package exports, and UI labels with `rg`.
- Check `apps/web/src/components`, `packages/ui`, and nearby module folders.
- Check `packages/forms-core`, `packages/compliance`, `packages/reports`,
  `packages/events`, and `packages/jobs` for existing primitives.
- Check `packages/db/src/schema` for existing tables or JSON shapes.
- Check `apps/web/src/lib/nav/registry.ts` before adding navigation.
- If you find duplication, clean it up as part of the change instead of adding
  another layer.

## Git and Worktree Safety

- The worktree may contain user changes. Do not revert, overwrite, or
  "clean up" files you did not intentionally edit.
- Inspect `git status --short` before broad edits.
- Keep changes scoped. Avoid formatting unrelated files.
- Commit your changes atomically to local `main` as you work: make a focused,
  self-contained commit for each logical change instead of batching everything
  into one commit at the end. Stage only the files you intentionally touched
  (never sweep in unrelated working-tree changes), and keep each commit small
  and reviewable.

## Agent Handoff Notes

- When returning completed work, always end with a condensed checklist the user
  can use to check and test every change you made.
- State what you changed, what you verified, and what remains risky.
- Mention any bug you discovered and fixed while working.
- If a required verification could not run, say why.
- Keep documentation honest. If code and docs disagree, fix the stale docs or
  call out the discrepancy.
