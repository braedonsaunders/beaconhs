# BeaconHS

> Greenfield rewrite of the legacy Laravel 5.8 BeaconHS Health & Safety platform onto a modern multi-tenant TypeScript stack.

**Get started:** [`docs/QUICKSTART.md`](docs/QUICKSTART.md)

**Plan:** This README is the consolidated implementation plan, written from a ~60-question discovery pass over the legacy codebase. Skim §1–2 for the elevator pitch; jump to §12 for phasing, §13 for risks, and **[§0 for live build status](#0-build-status)**.

---

## 0. Build status

Updated as work lands. `✅` = done, `🟡` = in progress / stub, `⬜` = not yet started.

### Phase 0 — Foundations
- ✅ Monorepo (Turbo + pnpm), Next.js 15 + React 19 + Tailwind, Docker compose (Postgres/Redis/MinIO/Mailpit), CI workflow
- ✅ Drizzle schema for every module + RLS policies installed on all tenant-scoped tables
- ✅ Tenants + Better-Auth (email/password + magic-link via Mailpit) + tenant memberships + 4 built-in roles
- ✅ Tenant resolution + view-as for super-admin + tenant-switcher UI + impersonation banner
- ✅ Sample data seed (10 people with formal names + emergency contacts, 5 courses, 4 incidents with one fully populated, 4 CAs, 3 documents with versions/acks/reviews, 8 equipment items with location history + work orders, 6 harnesses with 4 inspections + issue report each)
- ✅ List infrastructure: URL-driven search / sort / pagination / filter chips + reusable `Table` (sticky headers), `Pagination`, `SearchInput`, `SortableTh`, `FilterChips` primitives
- ✅ Detail-page infrastructure: `Section` (accordion), `TabNav` (URL-driven tabs), `DetailGrid`, `DetailHeader`, `CheckIndicator`, `SeverityRating`, `ActivityFeed`
- ✅ App-shell container layout: fixed sidebar + header, content scrolls internally (no body-level scroll); 6-group nav with bell + tenant switcher
- ✅ Audit log helper + first wiring on incidents (status changes + lock/unlock)
- ⬜ Audit log wired into every other mutation (CAs, PPE, equipment, etc.)
- ⬜ R2 file storage actually wired (signed PUT + image-optimization job)
- ⬜ Notifications worker wired into module events

### Phase 1 — Form builder
- ✅ Schema + Zod validation (`FormSchemaV1`, every field type, conditional logic, multi-step workflow)
- ✅ Field-type registry (40+ types), conditional-logic evaluator, scoring extractor, formula evaluator (with tests)
- ✅ Form template list + detail page (schema browser, version history, assignments, recent responses, raw-JSON debug)
- ✅ Form response detail page (renders any response against any version's schema, including repeating sections)
- ✅ Form responses list with filters / search / pagination
- ✅ **Form designer UI** — three-pane editor (palette / canvas / properties), section + field CRUD, reorder, choice-option editor, validation min/max, repeating sections, **visual logic-rule builder** (any/all combinator + per-clause field/op/value), preview pane, immutable-version publish flow
- ✅ **Form renderer UI** — section-by-section stepper with progress bar, conditional show/hide via showIf, validation per step, repeating-section rows, **real drawn-signature canvas**, **real photo/file/video/audio uploads via MinIO/R2**, person picker, pass/fail/N/A, yes/no+comment, traffic light, all standard inputs; submits via server action, extracts scores, audit-logs
- ✅ **File storage** — `@beaconhs/storage` (S3-compatible, MinIO in dev, R2 in prod), presigned PUT, attachment finalize, `FileUpload` client component, `PhotoGallery` lightbox
- 🟡 Auto-PDF renderer (Puppeteer pipeline exists; needs to fetch attachments + sign URLs for PDF embed)
- ⬜ Workflow step transitions (multi-step assignee handoff)
- ⬜ Assignment dispatcher (scheduled / event-triggered tick consumer)

### Phase 2 — Form-driven modules
Every list has search + sort + pagination + filter chips. Every row clicks through.

| Module | List | Detail | Edit / actions |
|---|---|---|---|
| Incidents | ✅ | ✅ Full legacy parity: 7 accordion sections + **Photos & Files section with uploader + lightbox gallery** + activity feed + status workflow + lock/unlock + critical alert | ✅ Report form (auto-ref); ⬜ Edit form |
| Corrective Actions | ✅ | ✅ General + Work form (audit-logged) + status workflow (audit-logged) + activity feed + source-link | ✅ New CA form (preserves source link via query) |
| Inspections | ✅ | ✅ Lists form-template-driven inspection responses + per-template "new" entry points | (uses Forms designer + renderer) |
| Toolbox talks | (uses Forms) | (uses Forms) | (uses Forms) |
| Forms — Templates | ✅ | ✅ Overview + schema browser + versions + assignments + recent responses + raw JSON | ✅ **Designer** (three-pane) + ✅ **Filler** (stepper) |
| Forms — Responses | ✅ | ✅ Schema-aware render with repeating sections + workflow steps | — |

### Phase 3 — Specialty modules
| Module | List | Detail | Notes |
|---|---|---|---|
| People | ✅ | ✅ 5-tab profile + sidebar profile card + emergency contact + notes; **Edit tab is now the embedded inline form** | ✅ Add + ✅ Edit (full form with audit-log; also at `/people/[id]/edit`) |
| Training — Courses | ✅ (within /training) | ✅ Course details + records list + classes | — |
| Training — Records | ✅ (within /training) | ✅ Record detail + cert verify info | ⬜ PDF generators wired |
| Equipment | ✅ | ✅ 4-tab detail (Maintenance / Work orders / Location / Edit) + sidebar asset card + report-missing/found | ✅ **Edit** (full form with audit-log); ⬜ QR label generator |
| PPE | ✅ | ✅ Inspection log + new-inspection form + issue-report form + issuance log + status changer | — |
| Documents | ✅ | ✅ 4-tab detail (Overview / Versions / Acknowledgments / Reviews) + publish/unpublish | ⬜ Acknowledge action wired; ⬜ Versioning editor |
| **Confined Space** | ✅ | ✅ Permit detail + atmospheric-readings table + new-reading form + out-of-spec alarm + activate/close actions | ✅ New-permit form (auto-ref + hours-based expiry) |
| **Lone Worker** | ✅ | ✅ Session detail + check-in log + manual check-in + end-session + overdue alert | ✅ Start-session form |

### Phase 4 — Dashboards + reports + plugin framework
- ✅ **Dashboard upgraded**: 8 KPI tiles with trend deltas, 4 list widgets (recent incidents, due CAs, expiring certs, inbox)
- ⬜ Drag-drop widget builder
- ⬜ Pre-built reports + custom report builder
- ⬜ Scheduled reports
- ⬜ Plugin SDK runtime + first-party plugins

### Phase 5 — Migration + cutover
- ⬜ ETL from beaconhs SQL Server
- ⬜ Validation harness
- ⬜ Dry runs + cutover

### Admin
- ✅ Admin landing page
- ✅ /admin/tenants list + "View as"
- ✅ /admin/users — every member with roles + status + joined date
- ✅ /admin/audit — full audit log viewer with filters
- ✅ **/admin/org** — org-units tree with add/delete per level + crews/departments/trades CRUD
- ✅ **/admin/settings** — identity, branding (logo URL + primary color + PDF letterhead + live preview), languages (enable + default), hierarchy depth toggles, risk matrix preview grid
- ✅ **/admin/api-keys** — generate (with one-time secret reveal in a 60s cookie), prefix-only listing, last-used, revoke
- ✅ **/admin/plugins** — first-party plugin catalogue (NetSuite, adminapp2-sync, webhook-out) with enable/disable per tenant, capability chips, version display

### Cross-cutting
- ✅ **Notifications inbox** at /notifications + bell-icon unread count in header + mark-read / mark-all-read actions
- ✅ App-shell sidebar grouped: Overview / Frontline / Programs / Assets & people / Insight / Settings
- ✅ `/verify/<token>` certificate verification page (handles valid / expired / revoked / not-found)
- ✅ `/manifest.webmanifest` + service worker for PWA install

---

## 1. Executive Summary

**What we're building:** A from-scratch, multi-tenant H&S SaaS platform that replicates the existing BeaconHS feature surface (Incidents, HazID/JSHA, Inspections, Training, Equipment, PPE, Documentation, Corrective Actions) and adds a powerful freeform form builder, configurable risk matrices, a tenant-aware plugin/integration framework, an in-app dashboard widget builder, and a public REST API.

**Strategy:** Hard cutover. 100% historical data migration. Rassaun Services Inc and Rassaun External Training become the first two tenants. The new platform is self-hosted (Docker Swarm continuity), Canada-only, sized for <50 tenants / <5k users / <1M records in year one with headroom to grow.

**Stack:** TypeScript / Node.js / Next.js (App Router) full-stack + React + PostgreSQL + BullMQ on Redis + Cloudflare R2 + Postgres full-text search.

**Form builder is the centerpiece.** It powers custom forms standalone *and* underpins most of the new module implementations (Inspections, JSHAs, toolbox talks, document acknowledgment, PPE inspections, equipment inspections all render through it). A small number of specialty modules (Incidents, Training, Equipment, Documentation, Confined Space) keep first-class data models because their workflows or data shape don't fit a pure form.

---

## 2. Decisions Locked In

| Area | Decision |
|---|---|
| **Tenancy** | Multi-tenant SaaS, every org is a tenant, no billing on day one |
| **Tenant routing** | Single domain, tenant resolved at login (no subdomains in v1) |
| **Tenant onboarding** | Admin-invite only (super-admin creates tenants) |
| **Stack** | Next.js (App Router) + React + TypeScript |
| **DB** | PostgreSQL with row-level security for tenant isolation |
| **Auth** | Email + password and magic-link; no MFA in v1 (architect for it) |
| **Worker login** | Email/magic link — every worker has email, no SMS/PIN flow |
| **Hosting** | Self-host on own infra (Docker Swarm continuity) |
| **Residency** | Canada-only |
| **Scale target** | < 50 tenants / < 5k users / < 1M records (year 1–2) |
| **File storage** | Cloudflare R2 (S3-compatible, no egress) |
| **Search** | Postgres full-text + trigram |
| **Queue** | BullMQ on Redis |
| **i18n** | Tenant-configurable language list, bilingual form/PDF content |
| **PWA** | Installable, online-only, with continuous form draft auto-save for spotty signal |
| **Conflict policy** | Last-write-wins with warning banner |
| **Native** | PWA only (no Capacitor in v1) |
| **Data migration** | Hard cutover, 100% historical |
| **Form builder authors** | Tenant admins / safety managers only |
| **Form versioning** | Immutable versions on publish |
| **Form drafts** | Continuous auto-save |
| **Form assignment** | On-demand + scheduled + event-triggered + manually-assigned |
| **Form workflows** | Multi-step with handoffs |
| **Form PDF** | Auto-rendered from schema, admin can customize CSS per template |
| **Photos** | Annotation + geotag + multi-photo per field |
| **Signatures** | Visual signature only (drawn) |
| **Attachments** | Documents, video, audio, voice-to-text |
| **Risk matrix** | Fully configurable per tenant (none, 3×3, 5×5, custom) |
| **JSHA module** | Implemented as a configured form template + risk matrix (no bespoke module) |
| **Confined Space** | First-class specialty module (atmospheric + permit lifecycle) |
| **Incidents** | First-class module with full taxonomy, simple linear investigation |
| **Training** | First-class module — instructor-led, self-paced, evaluator skills, external cert |
| **Cert expiry** | Reminders at 90/30/7/1 days + overdue flag, no auto-blocking |
| **Cert output** | PDF + QR-verifiable public page |
| **Equipment** | Asset registry + QR + location history + inspections + work orders. No financials. |
| **PPE** | Issue + return/replacement/discard + scheduled inspections |
| **Documentation** | Versioned library + acknowledgments + periodic review + management review books |
| **Corrective actions** | Standalone records, linkable to any source |
| **Permissions** | Built-in roles + custom roles per tenant |
| **Data scoping** | Site/project + crew + self-only + tenant-wide (configurable per tenant) |
| **Field-level perms** | Yes, configurable per form template |
| **Audit log** | Every write with before/after diffs |
| **Dashboard** | Drag-drop widget builder |
| **Reports** | Pre-built + simple custom builder |
| **Scheduled reports** | Subscriptions + admin-to-list + event-triggered |
| **Exports** | PDF + Excel |
| **Notification channels** | Email + in-app inbox + Web Push + SMS for critical only |
| **Notification prefs** | Per-channel + per-category, user-controlled |
| **Digest** | None — each notification immediate |
| **Critical alerts** | New incident |
| **Plugin framework** | First-party plugins, can sync in/out, render UI panels, define form-builder field types |
| **adminapp2** | Stays separate; new app reads internal master data from it |
| **External APIs** | Public REST API with per-tenant keys |
| **Calendar** | In-app calendar only (no Google/Outlook sync in v1) |
| **Starter content** | Curated starter library shipped to every new tenant |
| **Lone-worker** | Timer-based check-in with auto-escalation (first-class feature) |
| **Bulk import** | CSV for people/sites/equipment + UI for historical bulk upload |

---

## 3. Architecture

### 3.1 Repo / project layout

Monorepo with Turborepo. Single deploy target (Next.js) for v1.

```
/apps
  /web            Next.js App Router — UI + API routes + Server Actions
  /worker         BullMQ worker process (jobs, scheduled reports, etc.)
  /scheduler      Cron driver for scheduled jobs (or pg-cron / Inngest-style steps)
/packages
  /db             Drizzle schema + migrations + tenant-scoped query helpers
  /auth           Auth.js (or Better-Auth) config, sessions, magic-link
  /forms-core     Form schema, validators, renderer-agnostic logic
  /forms-pdf      Auto-PDF renderer (server-side)
  /plugin-sdk     Plugin interface contracts + helpers
  /tenant         Tenant context, RLS helpers, scoping middleware
  /audit          Activity-log helpers, diffing
  /ui             Shared React components (shadcn-style)
  /emails         React Email templates
  /api-types      Public REST API types (OpenAPI-emit)
  /jobs           Job definitions consumed by worker
  /seeds          Starter content packs
/plugins
  /netsuite-sync       First-party plugin
  /adminapp2-sync      First-party plugin
  /...
/migrations             ETL scripts (beaconhs → new app)
/docs
```

### 3.2 Tech choices (concrete)

- **ORM:** Drizzle. SQL-first, fast, plays well with Postgres RLS, generates types from schema.
- **Validation:** Zod everywhere. One schema, three uses (DB type inference, API contracts, form-builder field validators).
- **API style:** Server Actions for first-party UI calls. tRPC for typed client calls when Server Actions don't fit (e.g. complex forms). REST + OpenAPI for the public-facing API.
- **Auth:** Better-Auth or Auth.js v5. Email/password + magic link. Sessions in Postgres.
- **Real-time:** Postgres LISTEN/NOTIFY → SSE for in-app inbox. Skip WebSockets for v1.
- **Background jobs:** BullMQ on Redis. Repeatable jobs for scheduled reports / cert-expiry reminders.
- **File pipeline:** R2 + presigned PUT for direct browser uploads (chunked for big videos). Image optimization in a job (sharp). Video transcoding deferred (just store the original for v1; transcode later).
- **Search:** Postgres `tsvector` generated columns + pg_trgm for fuzzy. One central `search_index` table with `(tenant_id, entity_type, entity_id, tsv)`. Add Meilisearch later if needed.
- **PDF:** Puppeteer in a dedicated worker container, rendering a React component tree to PDF. One renderer for everything (forms, reports, certificates) — branded with the tenant's logo + colors.
- **Email:** Resend (or self-hosted Postal). React Email for templates.
- **Push:** Web Push via VAPID; service worker registers subscriptions; queue worker fans out.
- **SMS:** Twilio, gated to a "critical" channel. Off by default.
- **Observability:** OpenTelemetry → self-host Grafana stack (Loki + Tempo + Mimir) or paid (Axiom / Highlight). Sentry for errors stays.
- **CI/CD:** GitHub Actions or GitLab CI (matches your existing GitLab usage) → build → push to your registry → swarm-deploy via SSH.

### 3.3 Multi-tenancy

- Single Postgres database, **row-level security (RLS) on every tenant-owned table**.
- Every tenant-owned table has `tenant_id uuid NOT NULL` and an RLS policy: `tenant_id = current_setting('app.tenant_id')::uuid`.
- Application sets `SET LOCAL app.tenant_id = '...'` on each request after auth resolution.
- Belt-and-braces: ORM-level scoping helpers (`db.tenant(t).select(...)`) so RLS is the last line of defense, not the only one.
- `users` and `tenants` and `tenant_users` (membership) are *cross-tenant* tables, but `tenant_users` rows are filtered by the requesting user's identity.
- Super-admin bypass: a `super_admin` session flag toggles a different RLS policy. Heavily logged.

### 3.4 Configurable org hierarchy

Single self-referential `org_units` table (`id`, `parent_id`, `level`, `name`, `tenant_id`). Tenant settings define which levels are enabled (`customer`, `project`, `site`, plus tenant-defined like `area`). Records that need an org-unit FK store the leaf-most enabled unit for that tenant.

Sites carry lat/long + geofence radius for the GPS auto-suggest feature.

---

## 4. Data Model — High Level

### 4.1 Cross-tenant tables
- `tenants` — id, name, slug, region, language_default, languages_enabled, settings (JSONB), branding (JSONB)
- `users` — id, email, password_hash, name, locale, mfa_secret (later), created_at
- `tenant_users` — tenant_id, user_id, status (active/invited/suspended), display_name
- `sessions` — by Auth library

### 4.2 Tenant-scoped core
- `roles` — built-in + custom (id, tenant_id, name, permissions JSONB)
- `role_assignments` — tenant_user_id, role_id, scope (JSONB: sites/crews/self)
- `org_units` — id, tenant_id, parent_id, level, name, geometry
- `people` — workers/contractors (id, tenant_id, employee_no, name, dob, hire_date, contact, …)
- `people_assignments` — person_id, org_unit_id, valid_from/to
- `departments`, `roles_trades` — people grouping
- `crews` — current-day team unit
- `audit_log` — tenant_id, actor, entity_type, entity_id, action, before JSONB, after JSONB, ts
- `attachments` — id, tenant_id, kind (image/doc/video/audio), r2_key, mime, size, exif JSONB, geo POINT, captured_at

### 4.3 Form builder
- `form_templates` — id, tenant_id, key (slug, stable across versions), name, category, status
- `form_template_versions` — template_id, version, schema JSONB (sections, fields, logic, layout), published_at, published_by
- `form_assignments` — template_id, scope (people/role/site/all), schedule (cron-ish), trigger_event (nullable), due_offset
- `form_responses` — id, tenant_id, template_version_id, status (draft/in_progress/submitted/in_review/closed), current_step, assigned_to, submitted_by, submitted_at, site_id, data JSONB
- `form_response_steps` — response_id, step_key, assignee, signed_at, signature_attachment_id, comment
- `form_response_search` — tsvector index on response.data + key fields

JSONB for response data (flexible across template versions). Selected indexed columns extracted for hot queries (`site_id`, `submitted_by`, `submitted_at`, `status`). Numeric scores from compliance fields stored in a separate `form_response_scores` table for analytic roll-ups (avoid querying JSONB for those).

### 4.4 Specialty modules (first-class data, beyond pure forms)

- **Incidents** — `incidents` + `incident_classifications`, `incident_injuries`, `incident_lost_time_events`, `incident_investigations`. Investigation is itself a form-template instance but the parent Incident record carries the structured taxonomy.
- **Training** — `training_courses`, `training_classes`, `training_class_attendees`, `training_assignments` (role/trade matrix), `training_records` (a person earned a course), `training_certificates` (PDF + verification token + expiry), `training_skills`, `training_skill_evaluations`.
- **Equipment** — `equipment_items`, `equipment_types`, `equipment_location_history`, `equipment_work_orders`. Inspections are form responses with FK to `equipment_id`.
- **PPE** — `ppe_items` (sub-type of equipment OR separate, lean toward separate to keep lifecycle distinct), `ppe_issues`, `ppe_returns`, `ppe_inspections` (form responses).
- **Documentation** — `documents`, `document_versions`, `document_acknowledgments`, `document_reviews`, `document_books`, `document_book_acknowledgments`.
- **Corrective Actions** — `corrective_actions` (tenant_id, source_type, source_id, owner, due, severity, status, root_cause, verification).
- **Confined Space Permits** — `cs_permits`, `cs_atmospheric_readings`, `cs_rescue_plans`. Atmospheric readings tied to sensor IDs and timestamped.
- **Lone Worker** — `lw_sessions`, `lw_checkins`, escalation policy per tenant.

### 4.5 Plugin / integration
- `plugins` — id, key, name, version, manifest JSONB
- `tenant_plugins` — tenant_id, plugin_id, enabled, config JSONB (encrypted), secrets (separate row in `tenant_plugin_secrets` with envelope encryption)
- `plugin_events` — outbound event log (audit + retry)

---

## 5. The Form Builder

The form builder is the largest single piece of the system. Treat it as a sub-product.

### 5.1 Schema model
A form template version's schema is a JSON document:
```jsonc
{
  "version": 3,
  "title": { "en": "Daily Toolbox Talk", "fr": "..." },
  "sections": [
    {
      "id": "sec1",
      "title": { "en": "Attendees" },
      "showIf": null,
      "fields": [
        { "id": "f1", "type": "person_picker", "multi": true, "required": true, "label": {...} },
        { "id": "f2", "type": "signature", "required": true }
      ]
    },
    {
      "id": "sec2",
      "repeating": true,
      "title": { "en": "Hazards Discussed" },
      "fields": [
        { "id": "h1", "type": "text", "required": true },
        { "id": "h2", "type": "select", "options": ["High","Med","Low"] },
        { "id": "h3", "type": "formula", "expr": "severity * probability" }
      ]
    }
  ],
  "workflow": {
    "steps": [
      { "key": "submit", "assignee": "$submitter" },
      { "key": "foreman_review", "assignee": "$foreman_of_site", "signatureRequired": true },
      { "key": "safety_signoff", "assignee": "role:safety_manager", "signatureRequired": true }
    ]
  },
  "permissions": {
    "field_visibility": { "f1": ["admin","foreman","worker"], "h1": ["admin","foreman"] }
  },
  "pdf": {
    "css": "...optional custom...",
    "header": "...html...",
    "footer": "..."
  }
}
```

### 5.2 Field types (v1)
**Standard:** text, textarea, number, date, datetime, time, email, phone, url
**Choice:** radio, checkbox-group, select (single/multi), button-group, dropdown with "Other (specify)"
**Compliance scoring:** Pass/Fail/N/A, rating-1-to-N, Yes/No+comment, traffic-light
**Domain pickers:** person, site, equipment, ppe, document, training-course
**Media:** photo (with annotation, multi, captions, geotag), file (PDF/doc/xlsx), video clip, audio note
**Identity:** signature (drawn), typed-attestation
**Structure:** section, repeating section / table, page-break
**Computed:** formula (simple expression — `+ - * /`, `min/max/sum`, `if`), risk-matrix (severity × likelihood lookup)
**Display-only:** heading, paragraph, image, divider

Each field has: `id`, `type`, `label` (i18n), `helpText` (i18n), `required`, `validation`, `showIf`, `permissions`, type-specific config.

### 5.3 Conditional logic (v1)
- Field-level `showIf` rules: `{ "field": "f1", "op": "equals", "value": "Yes" }` and AND/OR composition.
- Section-level `showIf` (same rule shape).
- Validate showIf rules at design-time (no cycles, references valid).
- v2: section-level "required if", cross-field validators.

### 5.4 Form designer UX (admin)
- Split-pane: palette of field types ↔ canvas ↔ properties.
- Per-field i18n editor (one tab per enabled language for the tenant).
- Logic builder: visual "if this then show that".
- Preview pane shows mobile + desktop renderings.
- "Save draft" continuously. "Publish" creates a new immutable version, prompts for changelog note.
- Version diff view (what changed since v2).

### 5.5 Form renderer (worker)
- Mobile-first single-page. One section visible at a time on mobile; full layout on desktop.
- Continuous auto-save (every field change → debounced server write of the response draft).
- Voice-to-text button on every text field (Web Speech API).
- Photo capture inline; opens camera; supports annotation immediately.
- Signature opens full-screen drawing pad.
- Domain pickers (Person, Site, etc.) open a typeahead modal scoped to the user's visibility.
- Geotag stamped at capture time + visible on PDF.

### 5.6 PDF auto-render
- Server-side React-to-PDF using Puppeteer.
- One generic template renders any form: tenant branding header, form title, metadata (submitter, site, timestamps), sections, field-type-specific renderers (photo gallery, signature image, attendees grid, table for repeating sections), signature block.
- Admin can supply custom CSS / custom header HTML / footer HTML per template.
- PDF generation is a queued job (BullMQ) — returns a presigned R2 URL.

### 5.7 Assignment & workflow
- Assignment shapes:
  - **On-demand:** worker browses "Available forms" list, scoped to their role and site.
  - **Scheduled:** repeats on a cadence (daily / weekly / monthly / cron). Creates an assignment row that's "due" today, surfaces in the worker's inbox, generates overdue notification if missed.
  - **Event-triggered:** an event (e.g. `incident.created`) generates an assignment to a specific role/person.
  - **Manual:** admin assigns a template instance to specific people/sites with a due date.
- Workflow steps: each step has an assignee (literal user, role, or expression like `$foreman_of_site`), optional signature required, optional fields visible at that step only. Until the final step's submission, the response is "in_progress".
- Step transitions emit events (consumed by notifications + plugin framework).

---

## 6. Module-by-Module Specs

### 6.1 Incidents
- First-class data model (classification, severity/recordability, body part + injury type, lost-time events).
- Investigation = a form template assigned to the investigator. Linked to the parent Incident.
- Reporting from mobile is one-tap from any screen ("Report Incident"). GPS-stamped, photos in-line.
- KPIs: TRIR, LTIFR, incident counts by type/site/period, rolling 30/90/365 day windows.

### 6.2 HazID / JSHA
- A configured form template (no special module beyond the matrix engine).
- Tenant configures their risk matrix (none / 3×3 / 5×5 / custom labels + colors) in settings.
- Form designer can drop a `risk-matrix` field which references the tenant's configured matrix.
- Repeating section for tasks → for each task, repeating section for hazards → for each hazard, controls + residual risk.
- Goal: today's BeaconHS JSHA reproducible by template configuration alone.

### 6.3 Confined Space (specialty)
- First-class because of permit lifecycle + atmospheric readings (live data ingestion future).
- `cs_permits` with open/closed/expired states + max duration.
- Atmospheric readings (manual entry for v1; sensor ingestion later as a plugin).
- Out-of-spec readings trigger critical-channel notification.
- Rescue plan as a sub-document.

### 6.4 Training
- Course catalogue (per-tenant; later: shared catalogue across tenants is a v2 question).
- Classroom classes (scheduling, attendance roster, instructor sign-off).
- Self-paced courses (slides/video/PDF + post-quiz).
- Skill evaluations (evaluator observes, signs off).
- Certificate-only (worker uploads cert PDF + expiry).
- Training matrix: courses required per Role/Trade (and optionally per Site). Worker × Course status grid.
- Expiry reminders at 90 / 30 / 7 / 1 days; overdue flag. No auto-blocking in v1.
- Issued certificates: PDF with QR linking to a public verify URL (`/verify/<token>` → valid/expired/revoked).

### 6.5 Equipment
- Asset registry with QR code labels (printable label sheets).
- Location history (current site + holder + history rows).
- Inspections: pre-use (worker scans QR → form opens) + scheduled inspections.
- Work orders: defect → WO opened → assigned → repaired → verified → closed.
- **Out of scope:** rental rates, financials. Belongs in adminapp2 or equivalent.

### 6.6 PPE
- Separate from Equipment to preserve issue/return/discard lifecycle as first-class.
- `ppe_items` with serial + size + type.
- Issue to person (worker signs receipt); return when role/site changes or item is damaged; replacement issuance; discard with reason.
- Scheduled inspections for items that need them (harness, lifeline, gas detector — configurable per PPE type).

### 6.7 Documentation
- Versioned document library (SDS, policies, procedures).
- Full-text search via Postgres tsvector.
- Read-and-acknowledge workflow: required reading per role; worker's inbox shows unacknowledged; one click + signature acknowledges.
- Periodic review: each doc has a review-by date. Owner notified 60/30/0 days out.
- Management review books: curated bundles of documents; one signoff applies to the bundle.

### 6.8 Corrective Actions
- Standalone, optionally linked to a source (incident / inspection / audit finding / form response).
- Owner, due date, severity, status (open/in_progress/verified/closed).
- "My CA inbox" view per user.
- Verification step: a CA isn't closed until a verifier (different from the owner) confirms.

### 6.9 Lone Worker
- Worker starts a session: site, expected end, check-in interval (15 / 30 / 60 min).
- App prompts at interval; missed check-in escalates after grace period (push + SMS to supervisor + 911-back-up phone tree if tenant enables).
- Background Web Push wakes the PWA on Android; iOS PWA limitations documented.
- Out of v1 if user wants to defer; but they asked for this as a first-class feature.

---

## 7. Notifications

- Provider abstraction with channels: `email`, `inApp`, `webPush`, `sms`.
- Notification types are registered in code with metadata: category, default channels, critical flag.
- User prefs table: `(user_id, tenant_id, category, channel, enabled)` with defaults.
- Critical events (new incident in v1) bypass per-channel opt-out for the in-app channel; opt-out still respected for email/push/SMS.
- Real-time only — no digest.
- In-app inbox: `notifications` table + SSE push to connected clients (LISTEN/NOTIFY).
- Web Push: VAPID, subscription stored per device, service worker fans to OS-level.
- SMS via Twilio gated to critical channel, off by default per tenant.

---

## 8. Dashboards & Reports

### 8.1 Dashboards
- Drag-drop widget builder.
- Widget types: KPI tile, line/bar/pie chart, list, calendar, heatmap, map.
- Each widget = a saved report + viz config.
- Tenants can save multiple dashboards and share with roles.
- Mobile rendering: stack widgets vertically; only "essential" widgets shown by tenant config.

### 8.2 Reports
- Pre-built canned reports per module (Incident summary, Inspection compliance, Training matrix, CA aging, PPE coverage).
- Custom report builder: pick entity → pick fields → filters → group-bys → export.
- Backed by Postgres views + tenant_id-scoped queries.
- Exports: PDF (via Puppeteer) and Excel (via ExcelJS).

### 8.3 Scheduled reports
- User-initiated subscription: save report → schedule (daily / weekly / monthly / cron) → channel (email or in-app).
- Admin-defined distribution: admin schedules a report to a fixed list (role or specific emails).
- Event-triggered: hook a report to an event (e.g. `incident.closed` → send a summary report to a defined audience).
- All powered by BullMQ repeatable jobs + a `report_runs` log.

---

## 9. Plugin / Integration Framework

### 9.1 Goals
- First-party plugins only on day one (your team ships them).
- Capabilities: sync data in, sync data out, render UI panels, contribute new form-builder field types or report types.
- Architected so third-party plugins are *possible* later (manifest + permission scopes + sandbox).

### 9.2 Plugin SDK (TypeScript package)
```ts
import { definePlugin } from '@beaconhs/plugin-sdk'

export default definePlugin({
  key: 'netsuite-sync',
  version: '1.0.0',
  capabilities: ['sync.in', 'sync.out', 'ui.panel'],
  config: z.object({
    accountId: z.string(),
    consumerKey: z.string(),
  }),
  secrets: z.object({
    consumerSecret: z.string(),
    tokenSecret: z.string(),
  }),
  hooks: {
    'cron.daily': async (ctx) => { /* pull employees */ },
    'incident.created': async (ctx, evt) => { /* push to ticketing */ },
  },
  fieldTypes: [
    { type: 'netsuite_customer', renderer: ..., validator: ... },
  ],
  uiPanels: [
    { slot: 'incident.detail.sidebar', component: ... },
  ],
})
```

### 9.3 Runtime
- v1: plugins ship as packages in the monorepo. Loaded in-process at boot. No sandbox.
- v2: third-party plugins run in a separate worker process with capability gates (Realm-style or Deno-sandbox).
- Plugin config + secrets stored per tenant (`tenant_plugins`, `tenant_plugin_secrets` with envelope encryption — KMS-backed).

### 9.4 Day-one first-party plugins
- `netsuite-sync` — pull employees, customers, projects.
- `adminapp2-sync` — read internal master data from your existing adminapp2.
- `webhook-out` — generic outbound webhooks for any event.

### 9.5 Public REST API
- Separate from the plugin framework. Per-tenant API keys.
- OpenAPI spec generated from Zod schemas.
- Rate-limited (Redis token bucket).
- Versioned at the URL: `/api/v1/...`.
- Audit-logged like UI actions.

---

## 10. Permissions Model

### 10.1 Roles
- Built-in roles: `worker`, `foreman`, `safety_manager`, `tenant_admin`, `super_admin`.
- Each has a permission set encoded in `roles.permissions` (JSONB, action keys).
- Tenant admins can create custom roles by toggling permission flags.

### 10.2 Permission shape
- `module.action[.qualifier]` keys, e.g. `incidents.create`, `incidents.read.all`, `incidents.read.site`, `forms.publish`.
- Permission grants resolved at request time. Cached per session.

### 10.3 Scoping
- Each role assignment carries a *scope* (sites / crews / "self" / tenant-wide).
- A user can have multiple role assignments (e.g. Foreman on Site A, Worker on Site B).
- Queries filter by scope after RLS. Helpers wrap this so app code says `db.forUser(u).incidents.findMany(...)`.

### 10.4 Field-level visibility
- Form templates declare per-field role visibility.
- Renderer hides fields the current user shouldn't see; server enforces on read/write.

### 10.5 Audit log
- Every create/update/delete writes to `audit_log` with before/after diff.
- Diffs computed by Drizzle middleware.
- Searchable in admin UI by actor / entity / date.
- Retain for tenant-configured period (default 7 years).

---

## 11. Migration Plan

### 11.1 Source systems
- `beaconhs` SQL Server (primary)
- `peopleapp` SQL Server (HR — replaced by adminapp2 sync + initial seed)
- `toolcrib` SQL Server (folded into Equipment)
- `externaltraining` SQL Server (folded into Training; becomes its own tenant)
- `adminapp2` (kept; new app reads from it ongoing)

### 11.2 ETL architecture
- Standalone Node migration project (`/migrations` in the monorepo, but doesn't ship in the app image).
- Reads from SQL Server via `mssql` driver.
- Writes to the new Postgres via Drizzle.
- Per-entity migrators, idempotent, can be run repeatedly during dry runs.
- Map all comma-separated-IDs antipatterns into proper join tables on the way through.
- Each migrator writes a `migration_report` row (source_id, new_id, status, warnings).

### 11.3 Tenant split at migration time
- `Rassaun Services Inc` tenant gets all internal beaconhs records.
- `Rassaun External Training` tenant gets the externaltraining records.
- Personnel split by source database with optional manual reconciliation for shared individuals (their answer was "isolated tenants, no sharing" — confirm at migration time).

### 11.4 Migration order (each must succeed before the next runs)
1. Tenants + super-admin users
2. Org units (Customer/Project/Site)
3. People + departments + roles/trades
4. Users (issue invites / set placeholder passwords + force-reset on first login)
5. Equipment + PPE
6. Documents + document books
7. Training courses + classes + records + certificates (compute current expiry)
8. Form templates — convert each legacy fixed form (Inspection types, Hazard assessment types, etc.) into a form_template + initial version
9. Form responses — historical inspections, JSHAs, toolbox talks, PPE inspections, equipment inspections all become form_responses against their corresponding templates
10. Incidents (with investigations as form_responses)
11. Corrective actions
12. Confined space records (atmospheric readings preserved)
13. Audit log seeded with cutover summary

### 11.5 Validation harness
- Per-entity counts comparison (beaconhs row count vs new app).
- Random-sample diffing — pick N records from beaconhs, render them in both systems, eyeball match.
- Critical-path smoke tests: a sample worker can log in, see their training, see assigned forms, submit one; admin can run a key report and match it to the legacy report.
- Dry runs scheduled twice before cutover (T-21, T-7).

### 11.6 Cutover plan
- Communicate cutover date to all users.
- Cutover window (weekend):
  - Freeze beaconhs writes (read-only banner).
  - Final ETL run.
  - Validation harness.
  - Switch DNS / app to new system.
  - Smoke test golden paths in production.
  - Decision: GO or rollback to beaconhs (kept writable behind a flag for 24h).
- Keep beaconhs running read-only for 90 days as an archive.

---

## 12. Phasing & Timeline

A realistic phasing assuming a small focused team (1–3 engineers). Each phase is "demoable" — you can run real workflows at the end of each.

### Phase 0 — Foundations (4–6 weeks)
- Monorepo scaffold, Next.js app, Drizzle schema starter, BullMQ worker, R2 storage, email sending.
- Tenants + users + memberships + sessions + magic-link login.
- Tenant-scoped RLS + middleware + super-admin bypass.
- Org units + people + departments + roles/trades + crews.
- Audit log scaffold.
- Activity log + permissions model + built-in roles.
- File upload pipeline (presigned PUT).
- CI/CD to Docker Swarm.
- Observability scaffolded.

### Phase 1 — Form Builder (6–8 weeks)
- Schema model + version table.
- Form designer UI (palette, canvas, properties, logic builder, i18n editor).
- Form renderer UI (mobile + desktop, auto-save).
- All v1 field types.
- Assignment + scheduling + manual assign + event-triggered scaffolding.
- Multi-step workflows + handoffs + per-step signatures.
- PDF auto-render.
- Field-level visibility.

### Phase 2 — Form-driven modules (6–8 weeks)
- Inspections (uses form builder, type-aware listing).
- HazID / JSHA (configurable risk matrix + template).
- Toolbox talks / journals (uses form builder, attendee picker).
- Documentation library + acknowledgment workflow.
- Corrective Actions module.
- Notifications system (all channels) + user prefs UI.
- Photo capture pipeline with annotation + geotag.

### Phase 3 — Specialty modules (6–8 weeks)
- Incidents (first-class taxonomy + investigation form).
- Training (courses, classes, assessments, skills, certs, matrix).
- Equipment registry + work orders + QR labels.
- PPE issue/inspection lifecycle.
- Confined Space permit + atmospheric readings.
- Lone Worker check-in.

### Phase 4 — Dashboards + Reports + Plugin Framework (4–6 weeks)
- Dashboard widget builder.
- Pre-built reports + custom report builder.
- Scheduled reports (subscriptions + admin lists + event-triggered).
- Plugin SDK + first-party plugins (NetSuite, adminapp2-sync, webhook-out).
- Public REST API + per-tenant API keys + rate limiting.

### Phase 5 — Migration + Cutover (4–6 weeks of overlap)
- ETL build + dry runs.
- Validation harness.
- Beta with internal Rassaun tenant on staging.
- Cutover weekend.

**Total: ~30–40 weeks (7–10 months) end-to-end for a small team.** Compresses with more engineers but the form builder + module work is hard to parallelize cleanly.

---

## 13. Risks & Open Questions

### High-risk items
1. **Form builder ambition vs delivery time.** Versioned, multi-step, repeating sections, formulas, conditional logic, custom PDF — this is a product on its own. If a phase slips, this is the one. Consider feature-flagging formula fields + multi-step for v1.1 if time gets tight.
2. **Auto-PDF rendering quality.** The 48 hand-built Blade templates exist because each had bespoke formatting needs. Auto-rendering will look generic by default. Tenant admins must be able to tune CSS, otherwise compliance teams will reject the output. Build a strong custom-CSS escape hatch from day one.
3. **Plugin framework scope creep.** First-party in-process plugins are fine. The capability to "define new form-builder field types" via plugin is the riskiest part — adds a public interface to the form-builder internals. Lock that interface early or defer.
4. **Migration completeness.** "100% historical" + comma-separated-ID antipatterns + multiple SQL Server source DBs means the ETL is substantial. Budget time accordingly; do dry runs early.
5. **Confined Space depth.** Atmospheric sensor integration is currently manual entry. If any tenant needs live sensor feeds, that's a plugin to build.
6. **Self-hosted ops on Docker Swarm.** Modern Postgres + Redis + R2-egress + worker fleet is more moving parts than the current setup. Document the runbook from day one or operations becomes brittle.

### Open questions to resolve before/during build
1. **Should the externaltraining tenant and Rassaun internal tenant be able to share a course catalogue?** You answered "fully isolated"; revisit if it bites at launch.
2. **What exactly lives in adminapp2 today vs what the new app should own?** Need a working session with whoever owns adminapp2 to draw the line. Particularly: customers, projects, employees — which is canonical where?
3. **How is the existing externaltraining codebase implemented?** I couldn't see it in this worktree. Need to scan it before finalizing the Training module's feature set. Likely surfaces some training workflow we'd miss otherwise.
4. **How do you want to handle the existing field-worker user base re: passwords on cutover day?** Magic-link first-login is the friendliest path; let me know if you want a different choice.
5. **Lone Worker — is SMS escalation built day-one or later?** SMS is the only critical-channel use case for v1; either way you need a Twilio account if you want it.
6. **Risk matrix configuration UX.** The "configurable per tenant — none / 3×3 / 5×5 / custom" requirement is broad. Recommend shipping with three built-in presets and a custom editor in v1.1.
7. **Plugin field-types in the form designer.** Need to decide whether plugins can add their own field types to the palette in v1 or whether that's v2.
8. **MFA timing.** You said no MFA for v1; recommend at minimum a hidden toggle so super-admins can MFA themselves before opening up to customers.

---

## 14. What This Plan Does Not Cover (Yet)

- Detailed UI mockups / design system specifics. Recommend shadcn-style component library + a small design pass per phase.
- Per-feature acceptance criteria. Each module will need its own spec when its phase begins.
- Pricing / billing — explicitly out of scope.
- Mobile app store presence — PWA only.
- Field equipment maintenance/financial features — out of scope.
- Disaster recovery / backup-restore procedures — needed before production, separate runbook.
- Tenant offboarding / data export — needed before any external tenant launches.

---

## 15. Immediate Next Steps

1. Validate this plan with key stakeholders (you + anyone else who'll use the system).
2. Inspect the `externaltraining` codebase to confirm Training module scope.
3. Sit down with whoever owns `adminapp2` to draw the master-data boundary.
4. Decide team size + start date — that determines whether the timeline is 7 or 10 months.
5. Set up the monorepo scaffold + tenant primitives + auth (Phase 0, weeks 1–4) as the proving ground for the rest.
