# Field-level mapping guide (legacy MSSQL → BeaconHS Postgres)

Companion to the machine-readable [`mapping.json`](./mapping.json) (every in-scope table + its columns
+ disposition) and [`legacy-inventory.md`](./legacy-inventory.md) (per-table disposition). This file
documents the **cross-cutting transform conventions** every mapper follows, then the **exact column maps
for the core entities**. The long tail of `map` tables follows the same conventions; their columns are in
`mapping.json` and each is finalised in its mapper (`packages/etl/src/mappers/*`).

## Cross-cutting conventions

1. **Identity crosswalk.** Legacy PKs are `int IDENTITY`; new PKs are `uuid`. Every row's
   `(source_db, source_table, source_pk) → new uuid` is recorded in **`etl.id_map`**. Foreign keys
   (always integer `*ID` columns, e.g. `UserID`, `LocationID`, `SupervisorID`) are remapped by looking
   up the referenced row's new uuid in the crosswalk. Load order is dependency-first (see plan).
2. **Tenant.** Every row gets an explicit `tenant_id`: `beaconHS`/`toolCRIB`/`peopleApp` → **`rassaun`**,
   `ExternalTraining` → **`external-training`**. Inserts run under `withSuperAdmin` (RLS bypass).
3. **Booleans-as-varchar.** Legacy stores flags as `varchar(50)` (`'Yes'/'No'`, `'1'/'0'`, `'true'`,
   `'Active'`, `''`). Coerce via a shared `toBool()` (`/^(1|y|yes|true|active|t)$/i`).
4. **Photos → attachments.** Two legacy patterns, both → an `attachments` row + the entity's junction:
   - **Inline columns** (`Picture1..5`/`Caption1..5` on `INCIDENTLOG`; `Pic1URL..3`/`Caption1..3` on
     `DAILYJOURNALS`): each non-null URL → one attachment.
   - **Child tables** (`INCIDENTPHOTOS`, `DAILYJOURNALSPHOTOS`, `HAZIDJSAPHOTOS`, …): one row → one attachment.
   The URL value is an **Azure Blob** path (container `beaconhs-rassaun`); the attachments sub-phase streams
   the blob → `putObject` (R2/MinIO) and writes the `attachments` row (`r2_key`, `content_type`, `size_bytes`).
5. **`base64`/data-URL signatures** (`users.signature`, `HAZIDJSASIGNATURES`, `HAZIDJSA.ConfinedSpaceBase64`):
   decode → store as a `signature`-kind attachment; keep `signature_data_url` where the target has it.
6. **Delimited / list strings → jsonb arrays.** WAH/CS/ArcFlash fields (`WAHCommunication`, `WAHAccess`,
   `ConfinedSpaceRescue`, `ArcFlashEquipment`, …) are `varchar(max)` holding comma/newline/JSON lists →
   parse to `string[]` for the jsonb columns on `hazid_assessments`.
7. **Datetimes.** Legacy `datetime`/`date` are naive (no tz). Treat as **America/Toronto** and store as
   `timestamptz`. Split `*Date`+`*Time` varchar pairs (e.g. `IncidentDate`+`IncidentTime`) into one timestamp.
8. **Denormalised name+id pairs.** Legacy keeps both (`AssignedBy varchar` + `AssignedByID int`). Use the
   **`*ID`** for the FK (via crosswalk); keep the name string only as a fallback when the id is null/0.
9. **Provenance.** `created_at`/`updated_at` exist on almost every legacy table — carry them across verbatim
   (don't reset to import time). `id_map.row_hash` drives incremental change-detection.
10. **Unmapped-but-wanted columns** land in the target's `metadata` jsonb (e.g. equipment's 30+ niche fields)
    rather than being dropped silently. Truly-dropped columns (e.g. `SIN`) are listed per-entity below.

---

## Core entity maps

### `beaconHS.users` → `user` + `account` + `tenant_users` + `people`
| legacy | → | target | transform |
|---|---|---|---|
| `email` | → | `user.email` | unique; lowercased |
| `name` | → | `user.name` | |
| `password` | → | `account.password` (provider `credential`) | ⚠ legacy **bcrypt**; Better-Auth uses scrypt → **decision**: force password-reset on first login, or add a bcrypt verify shim |
| `formalname`,`initials` | → | `people.formal_name` (+ initials in metadata) | |
| `signature` | → | `people.signature_attachment_id` | base64 → attachment (conv. 5) |
| `empid` | → | link `people` via crosswalk `peopleApp.EMPLOYEESHR.id` | |
| `active` | → | `tenant_users.status` (`active`/`suspended`) | conv. 3 |

### `peopleApp.EMPLOYEESHR` (+`HR2`) → `people`
| legacy | → | target | transform |
|---|---|---|---|
| `FullName`/`PayrollName` | → | `first_name`,`last_name`,`formal_name` | split on last space |
| `EmployeeNumber` | → | `employee_no` | |
| `HireDate`/`DOB` | → | `hire_date`/`date_of_birth` | |
| `Division` | → | `department_id` | crosswalk `EMPLOYEESDIVISIONS` |
| `Trade` | → | `trade_id` | crosswalk `EMPLOYEESTRADES` |
| `JobTitle` | → | `job_title` (+ `person_titles` link) | |
| `Email`/`Phone` | → | `email`/`phone` | |
| `EmergencyContactName`/`Number` | → | `emergency_contact_name`/`_phone` | |
| `Photo` | → | `photo_attachment_id` | conv. 4 |
| `EmployeeActive` | → | `status` (`active`/`terminated`) | conv. 3 |
| `Address`,`HomeLocation`,`WSIBRateGroup`,`NAICSCode`,`StampNumber` | → | `metadata` | conv. 10 |
| **`SIN`** | → | **DROP** | PII, out of scope |

### `beaconHS.SETTINGSLOCATION` → `org_units(level='site')`  *(EAV pivot — `transform`)*
Legacy is a key/value table: `(LocationID, MetaKey, Value)`. **Pivot** by `LocationID` → one `org_units`
row; map `MetaKey`s (`name`,`address`,`lat`,`lng`,`code`,…) to columns; unknown keys → `metadata`.
*The mapper must first `SELECT DISTINCT MetaKey` to enumerate the key set.* Parent `customer`/`project`
levels: synthesise one root `customer` per tenant (legacy H&S has no separate customer master in scope).

### `beaconHS.INCIDENTLOG` → `incidents` (+ `incident_attachments`, `incident_injuries`, `incident_hours_periods`)
| legacy | → | target | transform |
|---|---|---|---|
| `IncidentDate`+`IncidentTime` | → | `occurred_at` | conv. 7 |
| `ReportedDate`+`ReportedTime` | → | `reported_at` | conv. 7 |
| `Name`,`Result` | → | `title`,`description` | |
| `Location` (int) | → | `site_org_unit_id` | crosswalk → SETTINGSLOCATION |
| `LocationOnSite` | → | `location` | |
| `Division` (int) | → | `department_id` | crosswalk |
| `InjuryClassificationID`,`Classification` | → | `classification_id` (+`incident_injury_types`) | crosswalk |
| `Cause`,`Events`,`PPEWorn` | → | `root_cause`,`events_leading_up`,`ppe_worn` | |
| `CriticalInjury`,`MOL`,`EMS`,`FirstAid`,`MedicalAttention` | → | `critical_injury`,`ministry_of_labour_notified`,`ems_notified`,`first_aid_received`,`medical_attention_received` | conv. 3 |
| `Hospital`,`City`,`Transport` | → | `hospital_name`,`treated_in_city`,`transportation` | |
| `KMSeverity`,`KMPotentialSeverity` | → | `actual_severity`,`potential_severity` | int 1-5 |
| `LostTime*`,`ModifiedDuty*` | → | `lost_time*`,`modified_duty*` | conv. 3/7 |
| `RootCause`,`PreventativeSteps` | → | `root_cause` + `incident_preventative_steps` | |
| `Foreman`,`SupervisorID`,`UserID` | → | `foreman_text`,`supervisor_person_id`,`reported_by_tenant_user_id` | crosswalk |
| `Picture1..5`+`Caption1..5` | → | `incident_attachments` | conv. 4 |
| `InProgress`,`ReviewComplete` | → | `in_progress`,`status` | conv. 3 |

### `beaconHS.HAZIDJSA` → `hazid_assessments` (children: tasks/hazards/ppe/questions/signatures/photos/cs_*)
The new `hazid_assessments` table was clearly modelled on this — near 1:1.
| legacy | → | target | transform |
|---|---|---|---|
| `DateTime` | → | `occurred_at` | conv. 7 |
| `LocationID`/`LocationOnSite`/`ProjectID` | → | `site_org_unit_id`/`location_on_site`/`project_org_unit_id` | crosswalk |
| `UserID`/`SupervisorID` | → | `reported_by_tenant_user_id`/`supervisor_*` | crosswalk |
| `JobScope`,`AssessmentTypeID` | → | `job_scope`,`assessment_type_id` | crosswalk |
| `WAH` / `WAHType` / `WAHRescue` / `WAHPermitNumber` | → | `wah`/`wah_type`/`wah_rescue`/`wah_permit_number` | conv. 3 |
| `WAHCommunication`/`WAHAccess`/`WAHEquipment` | → | `wah_communication`/`wah_access`/`wah_equipment` (jsonb[]) | conv. 6 |
| `ConfinedSpace*` (12 cols) | → | `confined_space`,`cs_type`,`cs_description`,`cs_communication`,`cs_rescue`,… | conv. 3/6; `ConfinedSpaceBase64`→attachment |
| `ArcFlash*` (6 cols) | → | `arc_flash`,`arc_flash_level`,`arc_flash_boundary`,`arc_flash_equipment`,… | conv. 6 |
| `InProgress` | → | `in_progress` / `locked` | conv. 3 |
| children | → | `HAZIDJSAHAZARDS`→`hazid_assessment_hazards` (pre/post likelihood+severity), `HAZIDJSAPPE`→`_ppe`, `HAZIDJSAQUESTIONS`→`_questions`, `HAZIDJSASIGNATURES`→`_signatures`, `HAZIDJSATASKS`→`_tasks`, `HAZIDJSACONFINEDSPACE*`→`_cs_atmospheric`/`_cs_entries` | |

### `beaconHS.DAILYJOURNALS` → `journal_entries` (+ `journal_entry_photos`)
| legacy | → | target | transform |
|---|---|---|---|
| `Date` | → | `entry_date` | |
| `Definition` | → | `definition` (`worker`/`supervisor`) | |
| `Details` | → | `body` | |
| `Customer` (int) | → | `site_org_unit_id` | crosswalk |
| `EmpID`/`SupervisorID` | → | `person_id`/`supervisor_person_id` | crosswalk |
| `Username` | → | `created_by_tenant_user_id` | crosswalk users |
| `Pic1..3URL`+`Caption` | → | `journal_entry_photos` | conv. 4 |
| `InProgress` | → | `status` (`draft`/`submitted`) | conv. 3 |

### `beaconHS.CORRECTIVEACTIONS` → `corrective_actions`
| legacy | → | target | transform |
|---|---|---|---|
| `AssignedByID`/`AssignedToID` | → | `assigned_by_tenant_user_id`/`owner_tenant_user_id` | crosswalk (name fallback conv. 8) |
| `Description`,`ActionTaken` | → | `description`,`action_taken` | |
| `DateAssigned`/`DateDue`/`DateClosed` | → | `assigned_on`/`due_on`/`closed_at` | |
| `Severity`,`Status` | → | `severity`,`status` | normalise enums |
| `Jobsite` (int) | → | `site_org_unit_id` | crosswalk |
| `Source`+`InspectionID` | → | `source` + `source_entity_type`/`source_entity_id` | polymorphic |

### `toolCRIB.EQUIPMENT` → `equipment_items` (+ `equipment_types`, `equipment_categories`) *(`transform`)*
| legacy | → | target | transform |
|---|---|---|---|
| `Name`,`Description` | → | `name`,`description` | |
| `Category`/`Type` (text) | → | `type_id` | upsert `equipment_types`/`equipment_categories` by name |
| `SerialNumber`,`AssetNumber`/`TagNumber` | → | `serial_number`,`asset_tag` | |
| `InService`,`Scrapped`,`ReportedMissing` | → | `status` enum | conv. 3 |
| `Image` | → | photo attachment | conv. 4 |
| `LastInspection`/`NextInspectionDue`/`LastOilChange`/`NextOilChange`/`NDTLast`/`NDTNext`/`OilChangeIntervalMonths`/dims/`Weight`/`RateID`/`Sensor1..4ID`/… (≈40 cols) | → | `metadata` (+ promote scheduling dates if desired — gap #5) | conv. 10 |

### Quizzes → training assessments
`QUIZ`→`training_assessment_types`, `QUIZQUESTIONS`→`training_assessment_type_questions`,
`QUIZRESULTS`→`training_assessments` (attempt; `passed`/`score`), `QUIZRESULTSQUESTIONS`→`training_assessment_results`.
`TRAININGRECORDS`→`training_records` (`source='migrated'`).

---

*The remaining `map` tables (documents, ppe, inspections children, equipment logs, people lookups,
email/audit logs, etc.) follow conventions 1–10; their full column lists are in `mapping.json` and each is
pinned down in its mapper. `transform` tables (Safety Talks/SWP/SJP/Lift Plans → Forms; EAV pivots) and the
`gap`/`review` items are detailed in [`gaps.md`](./gaps.md).*
