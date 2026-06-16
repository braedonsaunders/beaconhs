# Monitored Sessions — design + plan (Lone Worker → Builder app)

Status: FINALIZED design for autonomous build. 2026-06.

## Goal

Abstract Lone Worker into a **reusable Builder capability**: any published app can run a live
**monitored session** — recurring worker check-ins, a per-session next-due timer, automatic
overdue detection, and escalation — all configured via Builder UI controls. Lone Worker becomes
the first seeded app on it. The same primitive later powers permit-to-work timers, periodic
equipment/atmospheric checks, confined-space watch, etc.

## Principles

- **Reusable primitive, not a Lone-Worker special case.** No LW-specific logic in the engine.
- **Safety-first cutover.** The native `/lone-worker` module stays fully operational until the
  Builder version is built AND live-verified end-to-end (escalation proven), then retire it.
- **Reuse escalation infra.** Generalize the existing `emitLoneWorkerOverdue` → notify/email
  queues rather than reinventing.
- **Everything UI-configurable** in the Builder (interval/grace/duration, GPS, escalation flow).

## Data model

Extend `form_responses` (packages/db/src/schema/forms.ts) with NULLABLE monitoring columns
(null ⇒ an ordinary response, unchanged behavior):

- `monitorStatus` — pgEnum `form_monitor_status` [active, completed, missed, escalated, cancelled], nullable
- `checkinIntervalMinutes` int, `gracePeriodMinutes` int
- `expectedEndAt` timestamptz, `nextCheckinDueAt` timestamptz, `lastCheckinAt` timestamptz, `escalatedAt` timestamptz

New table `form_response_checkins` (generic check-in log; mirrors lw_checkins):

- id, tenantId, responseId (fk form_responses cascade), kind enum
  [manual, auto_prompted, missed, escalation_acknowledged], recordedAt, geoLat, geoLng, note,
  byTenantUserId. Indexes: (responseId, recordedAt), tenant.
- RLS: add `form_response_checkins` to TENANT_SCOPED_TABLES.

Template monitor config — optional `monitor` block on FormSchemaV1 (forms-core schema.ts):

```
monitor?: {
  enabled: true
  intervalMinutes: number; intervalFieldKey?: string   // literal or bind to a fill field
  graceMinutes: number;    graceFieldKey?: string
  durationMinutes?: number; durationFieldKey?: string
  requireGeo?: boolean
  // escalation = a flow with trigger 'session_overdue' (configured in the Flows canvas)
}
```

## Flow engine extension (forms-core automation + execution)

1. New trigger `{ trigger: 'session_overdue' }` in automation.ts (type + zod). Fires when a
   monitored session passes `nextCheckinDueAt + grace`.
2. Execution — worker scan `form_session_overdue_scan` (every minute), parallel to the existing
   `lone_worker_overdue_scan`:
   - find `form_responses` where `monitorStatus='active' AND nextCheckinDueAt + grace <= now`
   - set `monitorStatus='escalated'`, stamp `escalatedAt`, write a `missed` check-in row
   - run the template's flows with trigger `session_overdue` via `planAutomation` → dispatch
     actions (notify_role / send_email / create_capa …) on the existing queues
   - **Default critical escalation** if the template has no `session_overdue` flow — so safety is
     never silently dropped (notify safety_manager/tenant_admin + the response's supervisor field).
3. Re-uses `runStatusChangeAutomations` / `planAutomation` dispatch plumbing.

## Builder UI controls

- Designer gets a **Monitoring** panel: enable toggle; interval / grace / duration (literal or
  bind-to-field); require-GPS; a hint that escalation lives in Flows.
- Flows canvas gains the `session_overdue` **trigger node**.

## Runtime surfaces

1. **Start session** — submitting a monitored app creates a response with `monitorStatus='active'`,
   `nextCheckinDueAt = now + interval`, `expectedEndAt`.
2. **Check-in** — `recordSessionCheckin(responseId,{geo,note})`: insert a check-in + reset
   `nextCheckinDueAt`, clear escalation (re-activate). One-tap, mobile, GPS "I'm OK" button.
3. **Live monitor** — a response session view (countdown, check-ins, map, status, end/cancel),
   generalized from the LW `[id]` page; plus an active-sessions dashboard.
4. **End/cancel** — set `monitorStatus='completed'|'cancelled'`, stamp `endedAt`.

## Lone Worker app (seed)

Canonical Builder app: moduleBinding `lone_worker`; fields worker/supervisor/site/task +
interval/grace/duration; monitor config bound to those fields, requireGeo; a `session_overdue`
flow → notify_role(safety_manager, tenant_admin) + email(supervisor), critical. Check-in GPS+note.

## Phases (each: typecheck + lint + dev-server tested)

- **A. Schema + config + Builder UI** — monitor columns + checkins table + RLS; forms-core
  `monitor` block + `session_overdue` trigger (+ unit tests); designer Monitoring panel + flow node.
- **B. Scheduled execution + escalation** — generic overdue scan in the worker; dispatch flows on
  `session_overdue`; default critical escalation; generalize the notify/email emitter. Integration-test the scan against the dev DB.
- **C. Runtime** — start-session→live response; `recordSessionCheckin` + GPS button; session
  monitor view + active-sessions dashboard; end/cancel.
- **D. Lone Worker app seed + nav** — seed the LW app; bind `/lone-worker` launcher.
- **E. Cutover** — LIVE-VERIFY escalation end-to-end (short interval → overdue → notify+email →
  check-in resets); migrate `lw_sessions`/`lw_checkins` → responses+checkins; flip nav; replace the
  native `lone_worker_overdue_scan` with the generic scan; retire the native LW module.

## Testing (guaranteed tested)

- Unit: forms-core monitor-config + trigger validation; the due/escalation predicate.
- Integration: seed a monitored response with a past due-time, run the scan, assert it escalates +
  enqueues notification/email; check-in resets the timer.
- Live (dev server on :3000): drive the LW app — start (short interval), let it go overdue, confirm
  the scan escalates (worker/queue logs), check-in re-activates, end completes.
- Per phase: `pnpm --filter @beaconhs/web typecheck`, forms-core/db typecheck, vitest, prettier.
- Schema is pushed to the dev DB (`db:push`) before live tests; native LW stays until Phase E proves the replacement.
