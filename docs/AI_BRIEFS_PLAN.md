# AI Briefs — native AI-analysed reports

Status: shipped 2026-10-14 (all three phases). Decisions in §11 are final;
the user guide article is `/help/ai-briefs`.

## 1. Why now

AdminApp2 runs the **Company Journal Summary** every day at 07:05
(`SendDailyCompanyJournalSummary` → `DailyCompanyJournalSummaryService`). It
reads the legacy Beacon MSSQL `DAILYJOURNALS` table, sends the previous day's
journals to OpenAI (`gpt-5-mini`) with one hard-coded prompt, stores Markdown in
`daily_company_journal_summaries`, and emails a fixed recipient list from the
`SendEmailCompanyJournalSummary` setting.

**That report has been blind since cutover.** Legacy MSSQL went `READ_ONLY` on
2026-10-01. Since then 30–40 journals a day are written only in the new
BeaconHS (`journal_entries`), so AdminApp2 summarises nothing. Its
`ComputeJobWorkflow` job also reads the last 7 days of a project manager's
journals from the same dead table.

The goal is not a port. It is a native, tenant-customizable engine for
**scheduled AI analysis of BeaconHS data**, with the journal summary as its
first built-in.

## 2. What already exists (reuse, don't rebuild)

| Need                            | Existing piece                                                                                                            | Gap                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Cadence, timezone, next-run     | `report_schedules` + AppKit `computeNextRunAt`, 5-min `tick:reports` scan with `FOR UPDATE SKIP LOCKED`                   | none                                                  |
| Idempotent occurrences, retries | `report_runs` unique `(schedule_id, scheduled_for)`, `reports` queue (3 attempts, backoff), durable publish lease         | runs assume an AppKit query; no place for AI content  |
| Run-as authorization            | `run_as_tenant_user_id` / `run_as_role_id`, permissions re-checked in the worker                                          | none                                                  |
| Delivery + audit                | `report_run_deliveries` → `enqueueEmail` → `email_log`, tenant email transport, PDF attachment ≤10 MB else presigned link | recipients are users + raw emails only                |
| Groups                          | `person_groups` + `resolveGroupEmails` in `@beaconhs/events`                                                              | not wired into report schedules                       |
| AI in the worker                | `resolveTenantAiConfig` (worker), `ai` queue, `generateStructured` (zod, coercion, null-on-failure)                       | `AiJobData` hard-wired to one kind; no usage metering |
| Journal AI precedent            | `journal_analysis_runs` + `analyseJournals` + Insights widget                                                             | parallel system; includes drafts (bug)                |
| Ad-hoc AI over data             | Insights AI cards (`analyseDataset` over BHQL)                                                                            | dashboard-only, not schedulable                       |
| Artifacts                       | `attachments` + object storage, `report_runs.pdf_attachment_id`                                                           | no structured/HTML output stored                      |

## 3. Core idea

A **Brief** is a report definition whose body is produced by AI from typed
data sources, then delivered on a schedule like any other report.

```
Brief definition = Sources (what data) + Analysis spec (what to say) + Layout (how it looks)
Schedule         = Cadence + window + recipients + run-as   (existing report_schedules)
Run              = Evidence snapshot + structured result + rendered PDF/email + usage
```

One scheduling, run, delivery, permission and history spine serves both
tabular reports and Briefs. No second scheduler, no second delivery path.

### Design principles

1. **Facts by code, prose by AI.** Counts, department tallies, missing
   authors, trend deltas are computed deterministically. The model only writes
   narrative and must cite source records.
2. **Structured output, never raw Markdown.** The model returns JSON validated
   by zod; the server renders email, PDF and in-app views from it. No HTML or
   Markdown from the model reaches a recipient.
3. **Grounded or dropped.** Every bullet carries citations to source records;
   citations that do not resolve to the run's evidence set are stripped, and a
   bullet left with none is flagged in the run's quality report.
4. **Same visibility as the person it runs as.** Sources execute under the
   schedule's run-as `RequestContext`, so RLS and module visibility tiers
   (`*.read.all|site|self`) apply exactly as in the UI.
5. **Reproducible.** Each run snapshots the spec version, prompt, model,
   evidence record ids + content hash, and token usage. "Why did it say that?"
   is always answerable.
6. **Degrade, don't fail silently.** No AI configured → the Brief still
   delivers the deterministic sections with a clear "AI analysis unavailable"
   note, and owners are notified.

## 4. Data model

Extend the report tables rather than adding a parallel set.

**`report_definitions`**

- `kind` enum `query | brief` (default `query`); `query`/`layout` nullable when
  `kind = 'brief'` (check constraint).
- `brief_spec jsonb` (typed `BriefSpec`, versioned):
  - `sources[]`: `{ key: 'journals.entries', params }` (see §5)
  - `instructions`: tenant-editable guidance (audience, tone, focus)
  - `sections[]`: `{ key, title, guidance, maxBullets }` — ordered
  - `length`: target words; `modelTier`: `fast | smart`; optional `modelOverride`
  - `emptyPolicy`: `send_notice | skip`
- `brief_spec_version int` — bumped on every save.

**`report_schedules`**

- `recipient_group_ids jsonb` (People groups) — benefits tabular reports too.
- `window` jsonb for Briefs: `previous_day | previous_business_day |
since_last_run | last_n_days`, evaluated in the schedule timezone.

**`report_runs`**

- `kind` (copied from definition), `window_start`/`window_end`.
- `brief_result jsonb`: `{ headline, metrics[], sections[{ key, bullets[{ text,
citations[] }] }], followUps[{ action, ownerHint, priority, citations[] }] }`.
- `evidence jsonb`: per-source record ids, counts, content hash, truncation
  notes, late-arrival ids.
- `ai_meta jsonb`: provider, model, spec version, prompt hash, tokens in/out,
  latency, map-reduce chunk count, citation-drop count.

**`ai_usage_events`** (new, tenant-scoped, RLS): `feature`, `ref_type/ref_id`,
provider, model, tokens, latency, outcome. Written by every AI call site through
one `@beaconhs/ai` wrapper — Briefs first; the assistant, journals and Insights
move onto it in the same change. Feeds an admin usage view and optional tenant
budgets.

## 5. Sources — the extensible part

A code-defined registry in a new package `@beaconhs/briefs` (usable by the
worker). Each source:

```ts
defineBriefSource({
  key: 'journals.entries',
  label: 'Journal entries',
  permission: 'journals.read.self',            // minimum to select it
  params: z.object({ statuses, definitions, siteIds, departmentIds, includeLate }),
  collect(ctx, window, params) → { records[], facts{}, citationKey }
})
```

- `records` are normalised, text-bounded (e.g. 1,500 chars each, HTML →
  text), with a stable citation key (`journal:JRN-2026-…`).
- `facts` are deterministic metrics rendered without AI.
- Visibility helpers (`journalScopeWhere`, `moduleScopeWhere`) move from
  `apps/web` into a package so the worker enforces the same rules.

**Launch sources:** `journals.entries`.
**Next:** `incidents`, `corrective_actions` (open, overdue, closed),
`inspections` (failures), `hazard_assessments`, `equipment_work_orders`,
`ppe_inspections` (failures, incl. other PPE), `compliance.gaps`,
`training.expiring`. **Advanced:** `bhql` (an Insights query) for anything not
covered.

### Journal source specifics (parity + better)

- Author name, job title (`primaryPersonTitleName`), department, supervisor,
  site, weather, tags, entry date.
- Submitted entries for the window. **Late arrivals:** entries for earlier
  dates submitted since the last run are included and labelled, so
  next-morning drafts (≈15% of entries) are not lost.
- Facts: entry count, author count, by-department counts, sites active, and
  **who didn't journal** (from journal assignments/compliance) — something the
  legacy report could not do.

### Scale

A normal day is ~35 entries × ~700 chars ≈ 6k tokens — one call. Above a
token budget the engine map-reduces: one structured pass per department
chunk, then a synthesis pass that keeps citations (needed for days like the
2026-10-01 cutover import of 366 entries).

## 6. Analysis pipeline (worker)

`processReportRun` branches on `kind`:

1. Build the run-as context; resolve window in the schedule timezone.
2. Run sources → evidence + facts; persist `evidence` before any AI call.
3. Empty? Apply `emptyPolicy`.
4. Resolve tenant AI config; build the system prompt from org context + spec
   instructions + sections; build the dynamic zod schema from `sections`.
5. `generateStructured` (single or map-reduce); validate; resolve citations;
   strip unresolvable ones; record quality stats.
6. Render: in-app view, email HTML (stats tiles, department chips, sections,
   "Open in BeaconHS" link), PDF via a `brief` PDF template subject so tenants
   can restyle it in `/admin/pdf-templates`.
7. Deliver via existing `report_run_deliveries` (users + groups + emails) and
   an in-app notification to recipients with app accounts.
8. Write `ai_usage_events`, audit.

Failures: retries via the queue; final failure marks the run failed, keeps
the evidence, and notifies the schedule owner. "Regenerate" creates a new run
for the same occurrence window without re-sending unless asked.

## 7. Product surface

**Reports → Briefs tab** (alongside Reports and Schedules).

- **Library:** built-in templates + tenant Briefs; search, filters, pagination.
- **Brief studio** (1/3–2/3 like the PPE/inspection builders): left = sources
  and filters, instructions, sections (drag to order), length, model tier;
  right = **Preview** against a chosen date (runs, not delivered) with
  citations clickable to the source record.
- **Schedules:** the existing schedule form, plus window, groups, empty policy.
- **Run archive:** every run rendered natively; citations link to records;
  evidence + model + usage panel for admins; PDF; delivery status per
  recipient (the UI shows no delivery rows today — add them for both kinds).
- **Ask about this brief:** opens the assistant with the run's evidence as
  context (phase 3).

**Built-in templates (seeded per tenant):**

1. **Daily company journal brief** — parity with AdminApp2: sections
   Executive Summary, Department Highlights, Key Wins, Risks and Blockers,
   plus the structured follow-ups every brief carries (owner and priority);
   ~750 words; previous business day; 07:05 America/Toronto.
2. Weekly safety pulse — incidents, CAs, inspection and PPE failures.
3. Department daily journal brief — fan-out, one per department to its
   manager.
4. Monthly leadership HSE brief.
5. Journal pulse 7/30/90 days — replaces `journal_analysis_runs`.

**Permissions:** `reports.builder` edits Brief definitions; `reports.schedule`
manages schedules; `reports.read` views runs; a Brief source is only
selectable if the editor holds that source's permission.

## 8. Unification (clean cutover)

- `journal_analysis_runs`, `scanJournalAnalysis`, `analyseJournals` and the
  `journal_analysis_run` AI job become the "Journal pulse" built-in on the
  Brief engine; the Insights widget reads the latest pulse run. The old table
  and job are removed.
- Insights AI cards keep their dashboard role but share the `@beaconhs/briefs`
  analysis core (the `bhql` source).
- AdminApp2's journal summary job, service, table views and setting are
  removed from AdminApp2 once BeaconHS delivers.

## 9. Delivery plan

**Phase 0 — confirm and contain (½ day)**

- Confirm AdminApp2's `daily_company_journal_summaries` show zero journals
  since 2026-10-02 and tell recipients.
- Decide on `ComputeJobWorkflow`: expose `journal_entries` through `/api/v1`
  (new reports entity + read permission) and repoint AdminApp2 with an API key.

**Phase 1 — parity, natively (core)**

- Schema: `kind`, `brief_spec`, run columns, `recipient_group_ids`, window,
  `ai_usage_events` + RLS + migration.
- `@beaconhs/briefs`: registry, `journals.entries` source, visibility helpers
  moved to a package, prompt/schema builder, citation resolver, renderers.
- Worker branch in `processReportRun`; `AiJobData` widened if analysis runs on
  the `ai` queue.
- Seed the Daily company journal brief; create the schedule with the
  AdminApp2 recipients mapped to a People group.
- Run archive view + PDF template subject + email.
- Backfill: run the brief for 2026-10-01 → go-live; optionally import AdminApp2's
  historical summaries as archived runs.
- Switch off AdminApp2's job and remove its code.

**Phase 2 — customizable**

- Brief studio with preview; template library; more sources; department
  fan-out; empty and late-arrival policies in the UI; delivery status UI.

**Phase 3 — intelligence**

- Trend memory ("new since yesterday", recurring blockers across runs);
  ask-about-this-brief in the assistant; fold in Journal pulse; AI usage
  dashboard and tenant budgets; evaluation harness (fixture evidence sets,
  schema + grounding assertions, run on prompt/spec changes in CI with a
  mocked model).

Every phase ships with tests, manual articles (`/help`), audit, and passes the
CI gate set.

## 10. Risks

- **Model quality.** Rassaun's AI is OpenRouter with non-OpenAI models; a
  leadership brief needs a strong model. Provide a per-Brief model override
  and test the parity template on real days before switching off AdminApp2.
- **Sensitive content.** Journals can contain personnel or customer detail.
  Recipients see what the run-as user can see; emails leave the app. The
  studio shows the run-as identity and source permissions plainly.
- **Prompt injection from journal text.** Journal text is data, not
  instructions: delimited, never concatenated into the system prompt, and the
  output is schema-bound and citation-checked.
- **Cost.** Metered per run; map-reduce keeps large days bounded.

## 11. Decisions (final)

1. Briefs live under **Reports → Briefs**, and appear as widgets — one per
   brief in Insights, plus the **AI briefs** home-dashboard widget — for
   anyone with `briefs.read`.
2. Runs read data as the schedule owner (run-as member + role), like
   scheduled reports.
3. `previous_business_day`: Monday's brief covers Friday–Sunday.
4. Journal briefs include drafts.
5. AdminApp2's history is not imported.
6. A general Briefs API (`/api/v1/briefs…`) replaces exposing journals to
   AdminApp2's `ComputeJobWorkflow`; it can generate a brief for any window
   with per-source parameter overrides (e.g. one person's journals).
7. The tenant's configured AI provider and models (Admin → AI) are used — no
   pinned model. Rassaun runs OpenRouter `~z-ai/glm-latest` as its smart tier.

## 12. Issues found while planning (fixed)

- Journal analysis included drafts — the journal-analysis subsystem was
  replaced by briefs, which include drafts by decision.
- The `journal` notification category is now in `NOTIFICATION_CATEGORIES`
  (**Journal emails**, email-only), so its audience is configurable.
- Report and brief runs show per-recipient delivery status.
- Found during build: `/api/v1` discovery and `/api/v1/openapi.json` returned
  500 because the `compliance` and `apps` report entities had no API read
  permission. Compliance status now needs `compliance.read`; monitored
  sessions stay behind Builder app grants and are not served as an entity.
