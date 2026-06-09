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
