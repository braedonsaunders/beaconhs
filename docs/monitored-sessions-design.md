# Monitored Sessions — Builder capability

Status: FINALIZED design for autonomous build. 2026-06.

## Goal

Provide a **reusable Builder capability**: any published app can run a live
**monitored session** — recurring worker check-ins, a per-session next-due timer, automatic
overdue detection, and escalation — all configured via Builder UI controls. The same primitive
powers worker check-ins, permit-to-work timers, periodic equipment or atmospheric checks,
confined-space watch, and similar tenant-built workflows.

## Principles

- **Reusable primitive, not a product-specific module.** No workflow-specific logic in the engine.
- **Builder-owned experience.** Session configuration and runtime UI belong to tenant apps.
- **Reuse escalation infrastructure.** Dispatch through the standard notification and email queues.
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
2. Execution — worker scan `form_session_overdue_scan` (every minute):
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
   shared by every monitored app; plus an active-sessions dashboard.
4. **End/cancel** — set `monitorStatus='completed'|'cancelled'`, stamp `endedAt`.

## Example worker check-in app

A tenant can create a Builder app with worker, supervisor, site, task, interval, grace, and
duration fields; monitor configuration bound to those fields; required geolocation; and a
`session_overdue` flow that notifies configured roles and the supervisor. Check-ins can capture
GPS and a note.

## Phases (each: typecheck + lint + dev-server tested)

- **A. Schema + config + Builder UI** — monitor columns + checkins table + RLS; forms-core
  `monitor` block + `session_overdue` trigger (+ unit tests); designer Monitoring panel + flow node.
- **B. Scheduled execution + escalation** — generic overdue scan in the worker; dispatch flows on
  `session_overdue`; default critical escalation; generalize the notify/email emitter. Integration-test the scan against the dev DB.
- **C. Runtime** — start-session→live response; `recordSessionCheckin` + GPS button; session
  monitor view + active-sessions dashboard; end/cancel.
- **D. App examples + navigation** — create monitored-session apps in Builder and expose them
  through the standard app navigation.
- **E. Verification** — LIVE-VERIFY escalation end-to-end (short interval → overdue →
  notify+email → check-in resets).

## Testing (guaranteed tested)

- Unit: forms-core monitor-config + trigger validation; the due/escalation predicate.
- Integration: seed a monitored response with a past due-time, run the scan, assert it escalates +
  enqueues notification/email; check-in resets the timer.
- Live (dev server on :3000): drive a monitored app — start (short interval), let it go overdue,
  confirm the scan escalates (worker/queue logs), check-in re-activates, end completes.
- Per phase: `pnpm --filter @beaconhs/web typecheck`, forms-core/db typecheck, vitest, prettier.
- Schema is pushed to the dev DB (`db:push`) before live tests.
