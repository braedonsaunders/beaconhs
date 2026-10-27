# Optional employee work-day integration

Journal obligations can require one journal per weekday, per calendar day, or per worked day. Weekdays and calendar days need no integration. Worked-day mode is optional and provider-neutral; no particular HR system, payroll product or tenant is built into the public engine.

Use an API key with `compliance.manage` to POST `/api/v1/person_work_days`:

```json
{ "personId": "employee-uuid", "workDate": "2026-10-20", "worked": true, "source": "time-system" }
```

The date is the employee's calendar work date in the compliance timezone. `personId` is the BeaconHS tenant person ID; the integration owns external identity mapping. The key cannot target another tenant. `source` is an audit label, not an authorization boundary. The last authorized decision for a person/date wins. A repeated POST updates the same row; standard API `Idempotency-Key` support also applies.

Send `worked:false` for a confirmed day off. Absence means unknown: the engine falls back to weekdays and reports missing work-day data. It never infers time off from a missing or failed feed. Explicit `true` on a weekend requires a journal on that date. Future-dated journals do not count before their work date. Multiple journals on one date count once; extras cannot cover another date.

GET `/api/v1/person_work_days` requires `compliance.read` and supports the shared API filters, sorting and pagination, for example `?person_id=UUID&work_date__gte=2026-10-01&limit=50&offset=0`. GET by ID is available. DELETE by ID requires `compliance.manage`, audits the removal and restores the unknown-day weekday fallback. No PATCH endpoint is needed: POST is the person/date upsert.

Work-day changes refresh active worked-day journal obligations in the same tenant transaction. They do not send reminders; reminder delivery remains controlled separately. Historical evaluation uses original journal rules and reads corrected work-day decisions and journal evidence again, so an authorized time correction can change a historical result. Missing historical decisions receive the same explicit weekday fallback.

The generated OpenAPI schema at `/api/v1/openapi.json` documents the endpoints. Reports also expose **Employee work days** for reviewing imported decisions with standard filters and pagination.
