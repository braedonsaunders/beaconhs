# Gaps — legacy data with no home in the new schema

This is the **build list**: places where legacy data cannot be migrated as-is because the new
schema has no destination. Resolve these (build the module, or decide to drop) before the Phase 2
import covers the affected tables. Everything here is derived from the full disposition in
[`legacy-inventory.md`](./legacy-inventory.md) (`kind = gap` or `review`) and the column dump in
[`mapping.json`](./mapping.json).

Legend: 🟥 **hard gap** (new table/module needed) · 🟧 **soft gap** (extend an existing table) ·
🟦 **decision** (mapper can proceed once you choose).

---

## 🟥 Hard gaps — new modules/tables to build

### 1. Calendar / scheduling / events
- **Legacy:** `CALENDAR` — **18,628 rows, 46 columns**. A shared scheduling table used across
  `beaconHS` and `ExternalTraining` (identical row counts → one logical calendar).
- **New schema:** nothing. No `calendar_events` / `events` / `bookings` table exists. The nearest
  relatives (`training_classes`, `form_assignments`, `journal_assignments`) only cover their own niches.
- **Action:** build a `calendar_events` module (tenant-scoped: title, start/end, all-day, type,
  site/org-unit, person/crew assignees, recurrence, linked entity). OR decide which event categories
  fold into `training_classes` / `form_assignments` and drop the remainder. Until then `CALENDAR` is skipped.

### 2. Subcontractors
- **Legacy:** `SUBCONTRACTORS` (51) + `SUBCONTRACTORSCATEGORIES` (6).
- **New schema:** no subcontractor entity. `people` models employees only (no external-vendor concept).
- **Action (pick one):**
  - **a)** extend `people` with `is_external boolean`, `vendor_company text`, `subcontractor_category_id uuid` (+ a small `subcontractor_categories` lookup); or
  - **b)** a dedicated `subcontractors` table.
  Recommended: **(a)** — JSHA/incident/training records already reference people; keeping subs in `people` means existing FKs "just work".

### 3. First-Aid / Emergency Action Plan
- **Legacy:** `HAZIDFAEAP` — **598 rows, 54 columns** (per-site first-aid & emergency response plans).
- **New schema:** nothing. `incidents` captures *reactive* first-aid; there is no *proactive* EAP record.
- **Action:** build an `emergency_action_plans` module (site, muster points, first-aiders, contacts,
  procedures, review date, attached plan doc), OR model it as a canonical Form template. Skipped until built.

### 4. Training skill evaluations / records
- **Legacy:** `TRAININGSKILLRECORDS` (465) — competency sign-offs of a person against a skill.
- **New schema:** has `training_skill_types`, `training_skill_authorities`, `training_skill_assignments`
  — but **no per-person skill *record/evaluation*** table (these were dropped in a recent migration:
  `chore(db): drop superseded training tables`).
- **Action:** add a `training_skill_records` table (person × skill × evaluator × date × result), OR fold
  skill sign-offs into `training_records`. Decide before migrating the `TRAININGSKILL*` family.

---

## 🟧 Soft gaps — extend an existing table (no new module)

### 5. Equipment extended attributes
- **Legacy:** `toolCRIB.EQUIPMENT` has **67 columns** (NDT dates, oil-change intervals/hours, dimensions,
  gross/weight, rate id, condition, odometer, monthly-inspection tracking, atmospheric sensor slots…).
- **New schema:** `equipment_items` is intentionally lean.
- **Action:** most extras can land in `equipment_items.metadata` (jsonb) — **no schema change required** —
  but confirm which fields deserve first-class columns (e.g. `next_oil_change_on`, `next_ndt_on`) for
  scheduling/reporting. The mapper will default everything not first-class into `metadata`.

### 6. Work-at-Height option libraries
- **Legacy:** `WAHACCESS` (8) / `WAHCOMMUNICATION` (4) / `WAHEQUIPMENT` (8) — editable pick-lists feeding
  the JSHA Working-at-Heights section.
- **New schema:** WAH answers are stored inline on `hazid_assessments` as jsonb string arrays — the
  per-assessment *values* migrate fine, but there's **no editable option-library** table.
- **Action:** optional. If admins must edit WAH options in-app, add a small `wah_options` lookup (or a
  generic `tenant_pick_lists`). Otherwise these three tables are consumed during the HAZIDJSA transform and dropped.

### 7. People external/subcontractor flag
- Covered by gap #2 (recommended option (a) adds the needed `people` columns).

---

## 🟦 Decisions needed (mapper blocked until you choose) — the `review` items

| Legacy table | Rows | Question |
|---|--:|---|
| `beaconHS.HAZIDJSABASE` | 133 | Is this the assessment "base/header" (→ part of `hazid_assessments`) or a template? |
| `beaconHS.HAZIDTASKSEQUENCE` | 17 | Task-sequence template for an assessment type — confirm target. |
| `beaconHS.HAZIDJSATASKS2` | 3 | Superseded variant of `HAZIDJSATASKS`? safe to drop? |
| `beaconHS.INSPECTIONSTYPESRECORDS` | 220 | Type↔record link table — confirm shape. |
| `beaconHS.INSPECTIONSQUESTIONS` | 41,560 | Per-record answers vs question bank — `inspection_record_criteria` or `inspection_bank_criteria`? |
| `beaconHS.PEOPLEVIEWABLE` / `ExternalTraining.PEOPLEVIEWABLE` | 175 | Per-person visibility scoping → map to role scopes, or drop? |
| `beaconHS.SETTINGSADDITIONALFORMS` | 2 | "Additional forms" config → `tenant_settings` or Forms? |
| `beaconHS.model_has_permissionsV2` | 37 | Direct user→permission grants → synthesise a role, or drop? |
| `beaconHS.TRAININGEVALUATORS` / ExternalTraining | 7/5 | No evaluators table — store on `training_records.evaluator_person_id` or `people`? |
| `toolCRIB.EQUIPMENTWORKORDERS` | 340 | Confirm `equipment_work_orders` columns cover legacy fields. |
| `toolCRIB.EQUIPMENTRATESCATEGORIES` | 7 | No rate-category table — flatten to `equipment_rates.category`? |
| `toolCRIB.EQUIPMENTCRST` | 38 | Purpose unclear (12 cols) — identify before mapping. |
| `ExternalTraining.CUSTOMERSCONTACTS` | 3 | → `customer_contacts` (resolved to map) — confirm. |

---

## Intentionally **not** migrated (scope/PII), for the record
- **HR module** (`peopleApp.EMPLOYEES{COMPENSATION,BONUS,WSIB*,DISCIPLINE*,PERFORMANCE,REWARDS*,TIMEOFF,REIMBURSEMENT*,AUDIT}`)
  — out of H&S scope (you chose "H&S core only").
- **`EMPLOYEESHR.SIN`** (Social Insurance Number) and similar PII — **dropped on purpose**; it does not
  belong in the H&S platform.
- **ERP/finance** (`AdminApp`, `AdminApp2`), **`OmniWin*`**, **`self_service_*`** — out of scope.
- **Framework internals** (`migrations`, `password_resets`, `*_failed_jobs`, legacy `permissions*`/`roles*`
  catalog rows) — replaced by Better-Auth + code-defined IAM.

See [`legacy-inventory.md`](./legacy-inventory.md) for the per-table disposition of all 228 in-scope tables.

---

## Import-time data-shape mismatches (running log)

Concrete "old data doesn't fit" cases found while building & running the loaders. Each notes how the
ETL currently copes and what (if anything) you may want to change in the app/schema.

| # | Module | Mismatch | ETL workaround | Suggested app change |
|---|---|---|---|---|
| M1 | Equipment | `equipment_items` enforces **unique `(tenant_id, asset_tag)`**, but legacy `EQUIPMENT` has **duplicate** AssetNumber/TagNumber values (116 rows) — incl. blanks and tags like "DELET"×6. | Suffix the legacy id on any repeat → `"DELET (#1234)"` (deterministic, pk-ordered). Blank tags → `EQ-<id>`. | Either accept suffixed tags, drop the unique constraint, or clean the source asset numbers. |
| M2 | Equipment | `EQUIPMENT.Type`/`Category` are **free-text** (not FKs); 10 items have a Type that matches no `equipment_types` row. | Resolve `type_id` by name; unmatched → `type_id` null (name kept in `metadata.type`). | Optional: reconcile the ~10 stray type names. |
| M3 | Equipment | ~30 legacy columns (NDT dates, dims, weight, odometer, atmospheric sensor ids, condition, year, current hours) have **no first-class column**. | Stored in `equipment_items.metadata` (jsonb) — *not lost*. | Promote any you want to query/report on (e.g. NDT due dates) to real columns. |
| M4 | Incidents / Journals / CAs | Person & tenant-user FKs (`reported_by`, `created_by`, `assigned_by`, `owner`) reference `tenant_users`, but the **users loader isn't built yet**. | Currently left **null**; legacy names preserved in `metadata`. | None — pending the `beaconhs.users → user + tenant_users` loader (then these backfill on re-import). |
| M5 | Org units | `org_units` are created only for customer/site ids **referenced by the fact tables loaded so far**; CA `Jobsite` (and future modules) reference customers not yet created → some null `site_org_unit_id` (incidents 544/549, CAs 6661/7030). | Acceptable; resolves as more fact loaders run. | None — the org loader will scan all site-referencing tables in a later pass. |
| M6 | Incidents | Legacy `INCIDENTLOG` has no clean `type` (injury/near-miss/etc.); only an injury-classification id. | Defaulted `type='injury'`; severity derived from LostTime/FirstAid/Medical flags. | Optional: map `InjuryClassificationID` → the new `incident_classifications` / `type` properly. |
| M7 | Training | 882 / 7,789 `TRAININGRECORDS` (11%) reference an `EmpID`/`CourseID` not in the migrated roster/courses — mostly `EmpID=0` (generic records) or terminated employees / deleted courses. `training_records.person_id` + `course_id` are NOT NULL. | **6,907** imported with valid FKs; the 882 orphans skipped. | Optional: create a placeholder "Former/unknown employee" + "Legacy course" to retain the orphans — otherwise the current-roster 6,907 are the meaningful (compliance-relevant) ones. |

_(Resolved since the initial analysis: `equipment_items` **does** have a `metadata` jsonb + oil-change/purchase
columns — so the earlier "equipment extras" soft-gap (🟧 #5) is largely covered; only M3's promote-to-column
question remains.)_
