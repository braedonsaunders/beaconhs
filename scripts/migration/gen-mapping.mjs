// Generates docs/migration/legacy-inventory.md and docs/migration/mapping.json
// from docs/migration/legacy-schema.json (the MSSQL introspection dump).
//
// DISPOSITIONS is the hand-authored source of truth: every in-scope legacy table
// gets a disposition. kinds:
//   map       -> 1:1-ish load into a target Postgres table
//   transform -> reshaped (e.g. exploded into Forms, or an EAV table pivoted)
//   drop      -> not migrated (framework internals or out-of-H&S-scope)
//   gap       -> no target exists; a new module must be built first
//   review    -> needs a decision before a mapper is written
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname
const schema = JSON.parse(readFileSync(ROOT + 'docs/migration/legacy-schema.json', 'utf8'))

// tenant is derived from the source DB unless overridden per-row
const TENANT_BY_DB = { beaconHS: 'rassaun', toolCRIB: 'rassaun', peopleApp: 'rassaun', ExternalTraining: 'external-training' }

/** @type {Record<string,{kind:string,target?:string,note?:string,tenant?:string}>} */
const D = {
  // ---------------- beaconHS: identity / framework ----------------
  'beaconHS.users': { kind: 'map', target: 'user + account + tenant_users + people(link via empid)', note: 'Better-Auth user (email/password→account.credential), formalname/initials/signature→people; active→status' },
  'beaconHS.rolesV2': { kind: 'map', target: 'roles', note: 'tenant roles; reconcile against BUILTIN_ROLES' },
  'beaconHS.permissionsV2': { kind: 'drop', note: 'permission catalogue is code-defined (iam.ts); legacy perms re-mapped to new keys' },
  'beaconHS.model_has_rolesV2': { kind: 'map', target: 'role_assignments', note: 'user→role membership' },
  'beaconHS.model_has_permissionsV2': { kind: 'review', note: 'direct user→permission grants; map to role_assignments or drop' },
  'beaconHS.role_has_permissionsV2': { kind: 'map', target: 'roles.permissions', note: 'fold into roles.permissions jsonb' },
  'beaconHS.migrations': { kind: 'drop', note: 'Laravel migration ledger' },
  'beaconHS.password_resets': { kind: 'drop', note: 'transient' },
  'beaconHS.QUEUEFAILEDJOBS': { kind: 'drop', note: 'Laravel queue internals' },

  // ---------------- beaconHS: incidents ----------------
  'beaconHS.INCIDENTLOG': { kind: 'map', target: 'incidents', note: 'Picture1..5/Caption→incident_attachments; *ID→crosswalk; varchar Yes/No→bool; KM*→severity ints' },
  'beaconHS.INCIDENTPHOTOS': { kind: 'map', target: 'incident_attachments (+attachments)', note: 'Azure blob→R2' },
  'beaconHS.INCIDENTINJURIES': { kind: 'map', target: 'incident_injuries', note: '' },
  'beaconHS.INCIDENTHOURSWORKED': { kind: 'map', target: 'incident_hours_worked? (verify target)', note: 'man-hours for TRIR; confirm target table' },
  'beaconHS.INCIDENTCLASSIFICATIONS': { kind: 'map', target: 'incident_classifications', note: 'lookup' },

  // ---------------- beaconHS: HazID / JSHA ----------------
  'beaconHS.HAZIDJSA': { kind: 'map', target: 'hazid_assessments', note: 'WAH*/ConfinedSpace*/ArcFlash* map directly; varchar-list→jsonb string[]' },
  'beaconHS.HAZIDJSABASE': { kind: 'review', note: '133 rows/30 cols — assessment "base"? confirm vs HAZIDJSA' },
  'beaconHS.HAZIDJSATASKS': { kind: 'map', target: 'hazid_assessment_tasks', note: '' },
  'beaconHS.HAZIDJSATASKS2': { kind: 'review', note: '3 rows — superseded variant of HAZIDJSATASKS?' },
  'beaconHS.HAZIDJSAHAZARDS': { kind: 'map', target: 'hazid_assessment_hazards', note: '395k rows; pre/post likelihood+severity' },
  'beaconHS.HAZIDJSAPPE': { kind: 'map', target: 'hazid_assessment_ppe', note: '' },
  'beaconHS.HAZIDJSAQUESTIONS': { kind: 'map', target: 'hazid_assessment_questions', note: '' },
  'beaconHS.HAZIDJSASIGNATURES': { kind: 'map', target: 'hazid_assessment_signatures', note: 'signature base64→attachment or data_url' },
  'beaconHS.HAZIDJSAPHOTOS': { kind: 'map', target: 'hazid_assessment_photos (+attachments)', note: '' },
  'beaconHS.HAZIDJSAEMPLOYEES': { kind: 'map', target: 'hazid_assessment_signatures(internal) / participants', note: 'employees on the JSA' },
  'beaconHS.HAZIDJSACONFINEDSPACEATMOSPHERIC': { kind: 'map', target: 'hazid_assessment_cs_atmospheric', note: '' },
  'beaconHS.HAZIDJSACONFINEDSPACEENTRY': { kind: 'map', target: 'hazid_assessment_cs_entries', note: '' },
  'beaconHS.HAZIDJSATYPES': { kind: 'map', target: 'hazid_assessment_types', note: 'section toggles has_tasks/has_wah/has_cs…' },
  'beaconHS.HAZIDJSATYPESPPE': { kind: 'map', target: 'hazid_assessment_type_ppe', note: '' },
  'beaconHS.HAZIDJSATYPESQUESTIONS': { kind: 'map', target: 'hazid_assessment_type_questions', note: '' },
  'beaconHS.HAZIDHAZARDBANK': { kind: 'map', target: 'hazid_hazards', note: 'library' },
  'beaconHS.HAZIDHAZARDSET': { kind: 'map', target: 'hazid_hazard_sets', note: 'hazard_ids jsonb' },
  'beaconHS.HAZIDHAZARDTYPE': { kind: 'map', target: 'hazid_hazard_types', note: '' },
  'beaconHS.HAZIDTASKBANK': { kind: 'map', target: 'hazid_tasks', note: 'library; swp/sjp doc links' },
  'beaconHS.HAZIDTASKSEQUENCE': { kind: 'review', note: '17 rows/28 cols — task sequence/template? confirm target' },
  'beaconHS.HAZIDLOCATIONTASKS': { kind: 'map', target: 'hazid_location_tasks', note: 'per-site task suggestions' },
  'beaconHS.HAZIDATMOSPHERICSENSORS': { kind: 'map', target: 'atmospheric_sensors', note: '' },
  'beaconHS.HAZIDATMOSPHERICCALIBRATIONS': { kind: 'map', target: 'atmospheric_calibrations', note: '' },
  'beaconHS.HAZIDATMOSPHERICEQUIPMENT': { kind: 'transform', target: 'atmospheric_sensors (merge)', note: 'equipment merged into sensor row in new schema' },
  'beaconHS.HAZIDFAEAP': { kind: 'gap', note: 'First-Aid / Emergency Action Plan (54 cols) — NO target module' },

  // ---------------- beaconHS: inspections ----------------
  'beaconHS.JOBSITEINSPECTIONS': { kind: 'map', target: 'inspection_records', note: '' },
  'beaconHS.JOBSITEINSPECTIONSCRITERIA': { kind: 'map', target: 'inspection_record_criteria', note: '393k rows' },
  'beaconHS.INSPECTIONSTYPES': { kind: 'map', target: 'inspection_types', note: '' },
  'beaconHS.INSPECTIONSTYPESQUESTIONS': { kind: 'map', target: 'inspection_types (criteria)', note: '' },
  'beaconHS.INSPECTIONSTYPESRECORDS': { kind: 'review', note: '220 rows — type↔record link? confirm' },
  'beaconHS.INSPECTIONSQUESTIONS': { kind: 'map', target: 'inspection_record_criteria / inspection_bank', note: '41k; confirm vs CRITERIA' },
  'beaconHS.INSPECTIONSPHOTOS': { kind: 'map', target: 'inspection photos (+attachments)', note: '' },
  'beaconHS.INSPECTIONSASSIGNMENT': { kind: 'map', target: 'inspection_assignments', note: '' },
  'beaconHS.INSPECTIONSASSIGNMENTRECORD': { kind: 'map', target: 'inspection_assignments (record)', note: '' },

  // ---------------- beaconHS: PPE ----------------
  'beaconHS.PPETYPES': { kind: 'map', target: 'ppe_types', note: '' },
  'beaconHS.PPETYPESRECORDS': { kind: 'map', target: 'ppe_types_criteria', note: '' },
  'beaconHS.PPEASSIGNED': { kind: 'transform', target: 'ppe_items + ppe_issues', note: 'current holder + issue history' },
  'beaconHS.PPEISSUES': { kind: 'map', target: 'ppe_issues', note: '' },
  'beaconHS.PPEISSUESPHOTOS': { kind: 'map', target: 'attachments (ppe issue)', note: '' },
  'beaconHS.PPEINSPECTIONS': { kind: 'map', target: 'ppe_inspections', note: 'pre_use/annual' },
  'beaconHS.PPEINSPECTIONSCRITERIA': { kind: 'map', target: 'ppe inspection criteria (+annual records)', note: '104k' },
  'beaconHS.PPEINSPECTIONSPHOTOS': { kind: 'map', target: 'attachments (ppe inspection)', note: '' },

  // ---------------- beaconHS: journals ----------------
  'beaconHS.DAILYJOURNALS': { kind: 'map', target: 'journal_entries', note: 'Pic1-3URL inline + Definition(worker/supervisor)' },
  'beaconHS.DAILYJOURNALSPHOTOS': { kind: 'map', target: 'journal_entry_photos (+attachments)', note: '' },
  'beaconHS.DAILYJOURNALSASSIGNMENT': { kind: 'map', target: 'journal_assignments', note: '' },
  'beaconHS.DAILYJOURNALSASSIGNMENTRECORD': { kind: 'map', target: 'journal_assignments (record)', note: '' },

  // ---------------- beaconHS: corrective actions ----------------
  'beaconHS.CORRECTIVEACTIONS': { kind: 'map', target: 'corrective_actions', note: 'Source/InspectionID→polymorphic source_entity' },
  'beaconHS.CORRECTIVEACTIONSPHOTOS': { kind: 'map', target: 'attachments (corrective action)', note: '' },

  // ---------------- beaconHS: documents ----------------
  'beaconHS.DOCUMENTATION': { kind: 'map', target: 'documents', note: '' },
  'beaconHS.DOCUMENTATIONDATA': { kind: 'map', target: 'document_versions', note: 'content/markdown or attachment' },
  'beaconHS.DOCUMENTATIONTYPE': { kind: 'map', target: 'document_types', note: '' },
  'beaconHS.DOCUMENTATIONCATEGORY': { kind: 'review', target: 'documents.category', note: 'flatten to category text or a lookup?' },
  'beaconHS.DOCUMENTATIONBOOK': { kind: 'map', target: 'document_books', note: '' },
  'beaconHS.DOCUMENTATIONBOOKRECORD': { kind: 'map', target: 'document_books (record)', note: '' },
  'beaconHS.DOCUMENTATIONREFERENCE': { kind: 'map', target: 'document_references', note: '' },
  'beaconHS.DOCUMENTATIONREFERENCECATEGORY': { kind: 'review', target: 'document_reference_types', note: 'category vs type reconcile' },
  'beaconHS.DOCUMENTATIONREFERENCETYPE': { kind: 'map', target: 'document_reference_types', note: '' },
  'beaconHS.DOCUMENTATIONASSIGNMENT': { kind: 'map', target: 'document_assignments', note: '' },
  'beaconHS.DOCUMENTATIONASSIGNMENTRECORD': { kind: 'map', target: 'document_acknowledgments', note: 'who acknowledged' },
  'beaconHS.DOCUMENTATIONREVIEW': { kind: 'map', target: 'document_management_reviews', note: '' },
  'beaconHS.DOCUMENTATIONREVIEWRECORD': { kind: 'map', target: 'document_management_reviews (record)', note: '8k' },
  'beaconHS.DOCUMENTATIONMANAGEMENTREVIEW': { kind: 'map', target: 'document_management_reviews', note: '' },

  // ---------------- beaconHS: training & quiz ----------------
  'beaconHS.TRAININGCOURSE': { kind: 'map', target: 'training_courses', note: '' },
  'beaconHS.TRAININGCOURSEFILE': { kind: 'map', target: 'attachments (course material)', note: '' },
  'beaconHS.TRAININGCLASSES': { kind: 'map', target: 'training_classes', note: '' },
  'beaconHS.TRAININGATTENDEES': { kind: 'map', target: 'training_class_attendees', note: '' },
  'beaconHS.TRAININGRECORDS': { kind: 'map', target: 'training_records', note: 'source=migrated' },
  'beaconHS.TRAININGEVALUATORS': { kind: 'map', target: 'training (extras/evaluators)', note: 'verify target' },
  'beaconHS.TRAININGASSIGNMENT': { kind: 'map', target: 'training_assignments', note: '' },
  'beaconHS.TRAININGASSIGNMENTRECORD': { kind: 'map', target: 'training_assignments (record)', note: '' },
  'beaconHS.TRAININGSKILLTYPE': { kind: 'review', target: 'training_skills?', note: 'training-skills tables were partly dropped (see git); verify targets' },
  'beaconHS.TRAININGSKILLTYPEADDITIONAL': { kind: 'review', target: 'training_skills?', note: '' },
  'beaconHS.TRAININGSKILLADDITIONAL': { kind: 'review', target: 'training_skills?', note: '' },
  'beaconHS.TRAININGSKILLAUTHORITY': { kind: 'review', target: 'training_skills?', note: '' },
  'beaconHS.TRAININGSKILLAUTHORITYADDITIONAL': { kind: 'review', target: 'training_skills?', note: '' },
  'beaconHS.TRAININGSKILLASSIGNMENT': { kind: 'review', target: 'training_skills?', note: '' },
  'beaconHS.TRAININGSKILLASSIGNMENTRECORD': { kind: 'review', target: 'training_skills?', note: '' },
  'beaconHS.TRAININGSKILLRECORDS': { kind: 'review', target: 'training_skills?', note: '465 rows' },
  'beaconHS.QUIZ': { kind: 'map', target: 'training_assessment_types', note: '' },
  'beaconHS.QUIZQUESTIONS': { kind: 'map', target: 'training_assessment_type_questions', note: '' },
  'beaconHS.QUIZRESULTS': { kind: 'map', target: 'training_assessments', note: 'attempt; 21k' },
  'beaconHS.QUIZRESULTSQUESTIONS': { kind: 'map', target: 'training_assessment_results', note: '160k' },
  'beaconHS.QUIZASSIGNMENT': { kind: 'map', target: 'training_assignments (assessment)', note: '' },
  'beaconHS.QUIZASSIGNMENTRECORD': { kind: 'map', target: 'training_assignments (record)', note: '' },

  // ---------------- beaconHS: toolbox-style → Forms ----------------
  'beaconHS.SAFETYTALKS': { kind: 'transform', target: 'form_templates (toolbox_talk)', note: 'talk library' },
  'beaconHS.SAFETYTALKSCATEGORY': { kind: 'transform', target: 'form_template category', note: '' },
  'beaconHS.SAFETYTALKSESSIONS': { kind: 'transform', target: 'form_responses', note: 'delivered talk' },
  'beaconHS.SAFETYTALKSCOMPLETED': { kind: 'transform', target: 'form_response_participants', note: 'attendees (9.7k)' },
  'beaconHS.SAFEWORKPRACTICES': { kind: 'transform', target: 'form_templates / documents', note: 'SWP library' },
  'beaconHS.SAFEWORKPRACTICESSESSIONS': { kind: 'transform', target: 'form_responses', note: '' },
  'beaconHS.SAFEWORKPRACTICESCOMPLETED': { kind: 'transform', target: 'form_response_participants', note: '' },
  'beaconHS.SAFEJOBPROCEDURES': { kind: 'transform', target: 'form_templates / documents', note: 'SJP library (42 cols)' },
  'beaconHS.SAFEJOBPROCEDURESSESSIONS': { kind: 'transform', target: 'form_responses', note: '' },
  'beaconHS.SAFEJOBPROCEDURESCOMPLETED': { kind: 'transform', target: 'form_response_participants', note: '' },
  'beaconHS.LIFTPLANS': { kind: 'transform', target: 'form_responses (lift_plan template)', note: '25 cols → canonical lift-plan form' },

  // ---------------- beaconHS: safe distance ----------------
  'beaconHS.SAFEDISTANCE': { kind: 'map', target: 'safe_distance_records', note: '' },
  'beaconHS.SAFEDISTANCEROW': { kind: 'map', target: 'safe_distance_records (rows)', note: '' },

  // ---------------- beaconHS: people / org master ----------------
  'beaconHS.PEOPLEDIVISION': { kind: 'map', target: 'people_divisions', note: '' },
  'beaconHS.PEOPLEGROUP': { kind: 'map', target: 'people_groups', note: '' },
  'beaconHS.PEOPLEGROUPRECORD': { kind: 'map', target: 'people_groups (membership)', note: '' },
  'beaconHS.PEOPLEJOBTITLE': { kind: 'map', target: 'people_titles', note: '' },
  'beaconHS.PEOPLEJOBTITLETASKS': { kind: 'map', target: 'job_title_tasks', note: '' },
  'beaconHS.PEOPLEVIEWABLE': { kind: 'review', note: 'per-person visibility scoping — map to role scopes or drop' },
  'beaconHS.SUBCONTRACTORS': { kind: 'gap', note: 'no subcontractor entity (51 rows) — extend people or new table' },
  'beaconHS.SUBCONTRACTORSCATEGORIES': { kind: 'gap', note: 'subcontractor categories (6 rows)' },

  // ---------------- beaconHS: settings / calendar / logs / reports ----------------
  'beaconHS.SETTINGS': { kind: 'transform', target: 'tenant_settings (EAV→jsonb)', note: 'pivot MetaKey/Value' },
  'beaconHS.SETTINGSLOCATION': { kind: 'transform', target: 'org_units(site) (EAV pivot)', note: 'LocationID+MetaKey/Value→one org_unit per LocationID' },
  'beaconHS.SETTINGSADDITIONALFORMS': { kind: 'review', note: 'additional-forms config (2 rows) → forms or tenant_settings' },
  'beaconHS.CALENDAR': { kind: 'gap', note: 'scheduling/events (46 cols) — NO calendar module' },
  'beaconHS.EMAILLOG': { kind: 'map', target: 'email_log', note: '144k' },
  'beaconHS.ACTIVITYLOG': { kind: 'map', target: 'audit_log', note: 'activity feed' },
  'beaconHS.AUDITLOG': { kind: 'map', target: 'audit_log', note: '' },
  'beaconHS.REPORTS': { kind: 'map', target: 'reports (definitions)', note: '' },
  'beaconHS.REPORTSCHEDULE': { kind: 'map', target: 'report schedules', note: 'verify target' },
  'beaconHS.REPORTLOG': { kind: 'review', target: 'report run log', note: 'keep history or drop?' },
  'beaconHS.WAHACCESS': { kind: 'gap', note: 'WAH option library (8) — consumed inline by HAZIDJSA; no editable library table' },
  'beaconHS.WAHCOMMUNICATION': { kind: 'gap', note: 'WAH option library (4)' },
  'beaconHS.WAHEQUIPMENT': { kind: 'gap', note: 'WAH option library (8)' },

  // ---------------- toolCRIB: equipment ----------------
  'toolCRIB.EQUIPMENT': { kind: 'transform', target: 'equipment_items (+equipment_types)', note: '67 cols; split type/category; many inspection-schedule fields' },
  'toolCRIB.EQUIPMENTCATEGORIES': { kind: 'map', target: 'equipment_categories', note: '' },
  'toolCRIB.EQUIPMENTTYPES': { kind: 'map', target: 'equipment_types', note: '' },
  'toolCRIB.EQUIPMENTINSPECTIONS': { kind: 'transform', target: 'form_responses (sourceEntityType=equipment)', note: '26k; inspections are Forms in new schema' },
  'toolCRIB.EQUIPMENTINSPECTIONSCRITERIA': { kind: 'transform', target: 'form_response data / scores', note: '340k criteria answers' },
  'toolCRIB.EQUIPMENTINSPECTIONSBANK': { kind: 'map', target: 'equipment_inspection_types', note: 'bank' },
  'toolCRIB.EQUIPMENTINSPECTIONSBANKCRITERIA': { kind: 'map', target: 'equipment_inspection_types (criteria)', note: '' },
  'toolCRIB.EQUIPMENTINSPECTIONSPHOTOS': { kind: 'map', target: 'attachments (equipment inspection)', note: '' },
  'toolCRIB.EQUIPMENTTRUCKLOG': { kind: 'map', target: 'equipment_truck_log', note: '70k' },
  'toolCRIB.EQUIPMENTLOG': { kind: 'map', target: 'equipment_log', note: '' },
  'toolCRIB.EQUIPMENTLOCATIONHISTORY': { kind: 'map', target: 'equipment_log (location history)', note: '9.6k' },
  'toolCRIB.EQUIPMENTCHECKINOUT': { kind: 'map', target: 'equipment_checkin_out', note: '' },
  'toolCRIB.EQUIPMENTFINANCIALS': { kind: 'map', target: 'equipment_financials', note: '18k' },
  'toolCRIB.EQUIPMENTRATES': { kind: 'map', target: 'equipment_financials (rates)', note: '' },
  'toolCRIB.EQUIPMENTRATESCATEGORIES': { kind: 'review', target: 'equipment rate categories', note: 'verify target' },
  'toolCRIB.EQUIPMENTWORKORDERS': { kind: 'review', note: 'work orders (340) — equipment_log or a gap?' },
  'toolCRIB.EQUIPMENTWORKORDERSPHOTOS': { kind: 'map', target: 'attachments (work order)', note: '' },
  'toolCRIB.EQUIPMENTMANUALS': { kind: 'map', target: 'attachments (equipment manual)', note: '' },
  'toolCRIB.EQUIPMENTCRST': { kind: 'review', note: '38 rows/12 cols — purpose unclear' },
  'toolCRIB.users': { kind: 'drop', note: 'duplicate roster; reconcile with beaconHS.users' },

  // ---------------- peopleApp: people master (in scope) ----------------
  'peopleApp.EMPLOYEESHR': { kind: 'map', target: 'people', note: 'primary rassaun roster; DROP SIN (PII, out of scope)' },
  'peopleApp.EMPLOYEESHR2': { kind: 'transform', target: 'people (merge extra fields)', note: '' },
  'peopleApp.EMPLOYEESJOBTITLES': { kind: 'map', target: 'people_titles', note: '' },
  'peopleApp.EMPLOYEESTRADES': { kind: 'map', target: 'trades', note: '' },
  'peopleApp.EMPLOYEESDIVISIONS': { kind: 'map', target: 'departments / people_divisions', note: '' },
  'peopleApp.EMPLOYEESDOCUMENTS': { kind: 'map', target: 'person_files', note: 'employee documents→attachments' },
  // peopleApp HR-specific → out of H&S scope
  'peopleApp.EMPLOYEESAUDIT': { kind: 'drop', note: 'HR audit — out of scope' },
  'peopleApp.EMPLOYEESBONUS': { kind: 'drop', note: 'HR comp — out of scope' },
  'peopleApp.EMPLOYEESCOMPENSATION': { kind: 'drop', note: 'HR comp — out of scope' },
  'peopleApp.EMPLOYEESDISCIPLINE': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESDISCIPLINELEVEL': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESPERFORMANCE': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESREIMBURSEMENT': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESREIMBURSEMENTLIMIT': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESREIMBURSEMENTTYPE': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESREWARDS': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESREWARDSAVAILABLE': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESREWARDSDENOMINATIONS': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESREWARDSREASONS': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESTIMEOFF': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESWSIB': { kind: 'drop', note: 'HR workers-comp — out of scope' },
  'peopleApp.EMPLOYEESWSIBCOMMUNICATIONS': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESWSIBRATES': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.EMPLOYEESWSIBTYPES': { kind: 'drop', note: 'HR — out of scope' },
  'peopleApp.migrations': { kind: 'drop', note: 'framework' },
  'peopleApp.password_resets': { kind: 'drop', note: 'framework' },
  'peopleApp.model_has_permissions': { kind: 'drop', note: 'framework' },
  'peopleApp.model_has_roles': { kind: 'drop', note: 'framework' },
  'peopleApp.permissions': { kind: 'drop', note: 'framework' },
  'peopleApp.roles': { kind: 'drop', note: 'framework' },
  'peopleApp.role_has_permissions': { kind: 'drop', note: 'framework' },
  'peopleApp.users': { kind: 'drop', note: 'duplicate roster' },

  // ---------------- ExternalTraining → external-training tenant ----------------
  'ExternalTraining.PEOPLE': { kind: 'map', target: 'people', note: 'external-training roster; CustomerID→org_unit' },
  'ExternalTraining.CUSTOMERS': { kind: 'map', target: 'org_units(customer)', note: '' },
  'ExternalTraining.CUSTOMERSCONTACTS': { kind: 'review', note: 'customer contacts (3) → people or contacts' },
  'ExternalTraining.PEOPLEDIVISION': { kind: 'map', target: 'people_divisions', note: '' },
  'ExternalTraining.PEOPLEGROUP': { kind: 'map', target: 'people_groups', note: '' },
  'ExternalTraining.PEOPLEGROUPRECORD': { kind: 'map', target: 'people_groups (membership)', note: '' },
  'ExternalTraining.PEOPLEJOBTITLE': { kind: 'map', target: 'people_titles', note: '' },
  'ExternalTraining.PEOPLEJOBTITLETASKS': { kind: 'map', target: 'job_title_tasks', note: '' },
  'ExternalTraining.PEOPLETRADES': { kind: 'map', target: 'trades', note: '' },
  'ExternalTraining.PEOPLEVIEWABLE': { kind: 'review', note: 'visibility scoping' },
  'ExternalTraining.QUIZ': { kind: 'map', target: 'training_assessment_types', note: '' },
  'ExternalTraining.QUIZQUESTIONS': { kind: 'map', target: 'training_assessment_type_questions', note: '' },
  'ExternalTraining.QUIZRESULTS': { kind: 'map', target: 'training_assessments', note: '' },
  'ExternalTraining.QUIZRESULTSQUESTIONS': { kind: 'map', target: 'training_assessment_results', note: '' },
  'ExternalTraining.QUIZASSIGNMENT': { kind: 'map', target: 'training_assignments', note: '' },
  'ExternalTraining.QUIZASSIGNMENTRECORD': { kind: 'map', target: 'training_assignments (record)', note: '' },
  'ExternalTraining.TRAININGCOURSE': { kind: 'map', target: 'training_courses', note: '' },
  'ExternalTraining.TRAININGCOURSEFILE': { kind: 'map', target: 'attachments (course material)', note: '' },
  'ExternalTraining.TRAININGCLASSES': { kind: 'map', target: 'training_classes', note: '' },
  'ExternalTraining.TRAININGATTENDEES': { kind: 'map', target: 'training_class_attendees', note: '' },
  'ExternalTraining.TRAININGRECORDS': { kind: 'map', target: 'training_records', note: '' },
  'ExternalTraining.TRAININGEVALUATORS': { kind: 'map', target: 'training (evaluators)', note: '' },
  'ExternalTraining.TRAININGASSIGNMENT': { kind: 'map', target: 'training_assignments', note: '' },
  'ExternalTraining.TRAININGASSIGNMENTRECORD': { kind: 'map', target: 'training_assignments (record)', note: '' },
  'ExternalTraining.TRAININGCLASSESEXPENSE': { kind: 'drop', note: 'training expense tracking — out of scope' },
  'ExternalTraining.TRAININGCOURSEEXPENSE': { kind: 'drop', note: 'training expense tracking — out of scope' },
  'ExternalTraining.CALENDAR': { kind: 'gap', note: 'scheduling/events — NO calendar module' },
  'ExternalTraining.EMAILLOG': { kind: 'map', target: 'email_log', note: '' },
  'ExternalTraining.ACTIVITYLOG': { kind: 'map', target: 'audit_log', note: '' },
  'ExternalTraining.SETTINGS': { kind: 'transform', target: 'tenant_settings (EAV→jsonb)', note: '' },
  'ExternalTraining.QUEUEFAILEDJOBS': { kind: 'drop', note: 'framework' },
  'ExternalTraining.migrations': { kind: 'drop', note: 'framework' },
  'ExternalTraining.password_resets': { kind: 'drop', note: 'framework' },
  'ExternalTraining.users': { kind: 'map', target: 'user + tenant_users', note: 'external-training app users' },
  'ExternalTraining.rolesV2': { kind: 'map', target: 'roles', note: '' },
  'ExternalTraining.permissionsV2': { kind: 'drop', note: 'code-defined' },
  'ExternalTraining.permissions': { kind: 'drop', note: 'framework' },
  'ExternalTraining.roles': { kind: 'drop', note: 'framework (v1)' },
  'ExternalTraining.model_has_rolesV2': { kind: 'map', target: 'role_assignments', note: '' },
  'ExternalTraining.model_has_permissionsV2': { kind: 'review', note: 'direct grants' },
  'ExternalTraining.role_has_permissionsV2': { kind: 'map', target: 'roles.permissions', note: '' },
  'ExternalTraining.role_users': { kind: 'map', target: 'role_assignments', note: '' },
  'ExternalTraining.permission_roles': { kind: 'drop', note: 'framework (v1)' },
  'ExternalTraining.permission_users': { kind: 'drop', note: 'framework (v1)' },
  'ExternalTraining.rolesV2_dup': { kind: 'drop', note: '' },
}

// Corrections to align targets with the ACTUAL new-schema table names (161 tables).
// Each entry overrides target (and optionally kind/note) for that source table.
/** @type {Record<string,{kind?:string,target?:string,note?:string}>} */
const FIX = {
  // people / org master use the person_* prefix + membership join tables
  'beaconHS.PEOPLEDIVISION': { target: 'person_divisions' },
  'beaconHS.PEOPLEGROUP': { target: 'person_groups' },
  'beaconHS.PEOPLEGROUPRECORD': { target: 'person_group_memberships' },
  'beaconHS.PEOPLEJOBTITLE': { target: 'person_titles (+ person_title_assignments)' },
  'ExternalTraining.PEOPLEDIVISION': { target: 'person_divisions' },
  'ExternalTraining.PEOPLEGROUP': { target: 'person_groups' },
  'ExternalTraining.PEOPLEGROUPRECORD': { target: 'person_group_memberships' },
  'ExternalTraining.PEOPLEJOBTITLE': { target: 'person_titles (+ person_title_assignments)' },
  'ExternalTraining.PEOPLETRADES': { target: 'trades' },
  'ExternalTraining.CUSTOMERSCONTACTS': { kind: 'map', target: 'customer_contacts', note: 'customer contacts' },
  // incidents
  'beaconHS.INCIDENTHOURSWORKED': { target: 'incident_hours_periods', note: 'man-hours for TRIR/LTIR' },
  'beaconHS.INCIDENTCLASSIFICATIONS': { target: 'incident_classifications (+ incident_injury_types)' },
  // inspections
  'beaconHS.INSPECTIONSPHOTOS': { target: 'inspection_record_attachments (+attachments)' },
  'beaconHS.INSPECTIONSTYPES': { target: 'inspection_types (+ inspection_banks)' },
  'beaconHS.INSPECTIONSTYPESQUESTIONS': { target: 'inspection_bank_criteria / inspection_types' },
  // ppe
  'beaconHS.PPETYPESRECORDS': { target: 'ppe_type_inspection_criteria' },
  'beaconHS.PPEINSPECTIONSCRITERIA': { target: 'ppe_type_inspection_criteria / ppe_annual_records' },
  'beaconHS.PPEISSUES': { target: 'ppe_issues (+ ppe_issue_reports)' },
  // corrective actions
  'beaconHS.CORRECTIVEACTIONSPHOTOS': { target: 'ca_photos (+attachments)' },
  // documents
  'beaconHS.DOCUMENTATIONCATEGORY': { kind: 'map', target: 'document_categories', note: '' },
  'beaconHS.DOCUMENTATIONREFERENCECATEGORY': { kind: 'map', target: 'document_reference_categories', note: '' },
  'beaconHS.DOCUMENTATIONBOOKRECORD': { target: 'document_book_items' },
  'beaconHS.DOCUMENTATIONREVIEW': { target: 'document_reviews' },
  'beaconHS.DOCUMENTATIONREVIEWRECORD': { target: 'document_reviews (record)' },
  // training assignments + skills (no training_assignments table; uses training_audience_* + training_skill_*)
  'beaconHS.TRAININGASSIGNMENT': { target: 'training_audience_assignments' },
  'beaconHS.TRAININGASSIGNMENTRECORD': { target: 'training_audience_assignment_records' },
  'beaconHS.TRAININGEVALUATORS': { kind: 'review', target: 'people(evaluator) / training_records.evaluator', note: 'no evaluators table' },
  'beaconHS.TRAININGSKILLTYPE': { kind: 'map', target: 'training_skill_types', note: '' },
  'beaconHS.TRAININGSKILLAUTHORITY': { kind: 'map', target: 'training_skill_authorities', note: '' },
  'beaconHS.TRAININGSKILLASSIGNMENT': { kind: 'map', target: 'training_skill_assignments', note: '' },
  'beaconHS.TRAININGSKILLASSIGNMENTRECORD': { kind: 'map', target: 'training_skill_assignments (record)', note: '' },
  'beaconHS.TRAININGSKILLTYPEADDITIONAL': { kind: 'map', target: 'training_extra_fields', note: '' },
  'beaconHS.TRAININGSKILLADDITIONAL': { kind: 'map', target: 'training_extra_fields', note: '' },
  'beaconHS.TRAININGSKILLAUTHORITYADDITIONAL': { kind: 'map', target: 'training_extra_fields', note: '' },
  'beaconHS.TRAININGSKILLRECORDS': { kind: 'gap', target: null, note: 'skill evaluations/records (465) — no target; build or fold into training_records' },
  'beaconHS.QUIZASSIGNMENT': { target: 'training_audience_assignments' },
  'beaconHS.QUIZASSIGNMENTRECORD': { target: 'training_audience_assignment_records' },
  'ExternalTraining.TRAININGASSIGNMENT': { target: 'training_audience_assignments' },
  'ExternalTraining.TRAININGASSIGNMENTRECORD': { target: 'training_audience_assignment_records' },
  'ExternalTraining.QUIZASSIGNMENT': { target: 'training_audience_assignments' },
  'ExternalTraining.QUIZASSIGNMENTRECORD': { target: 'training_audience_assignment_records' },
  // reports
  'beaconHS.REPORTS': { target: 'report_definitions' },
  'beaconHS.REPORTSCHEDULE': { kind: 'map', target: 'report_schedules', note: '' },
  'beaconHS.REPORTLOG': { kind: 'map', target: 'report_runs', note: 'run history' },
  // equipment (toolCRIB)
  'toolCRIB.EQUIPMENTLOG': { target: 'equipment_log_entries' },
  'toolCRIB.EQUIPMENTTRUCKLOG': { target: 'truck_log_entries' },
  'toolCRIB.EQUIPMENTCHECKINOUT': { target: 'equipment_checkouts' },
  'toolCRIB.EQUIPMENTFINANCIALS': { target: 'equipment_expenses' },
  'toolCRIB.EQUIPMENTLOCATIONHISTORY': { target: 'equipment_location_history' },
  'toolCRIB.EQUIPMENTWORKORDERS': { kind: 'map', target: 'equipment_work_orders', note: '' },
  'toolCRIB.EQUIPMENTINSPECTIONSBANK': { target: 'equipment_inspection_types' },
  'toolCRIB.EQUIPMENTINSPECTIONSBANKCRITERIA': { target: 'equipment_inspection_criteria' },
  'toolCRIB.EQUIPMENTRATESCATEGORIES': { kind: 'review', target: 'equipment_rates (category col)', note: 'no rate_categories table' },
  'toolCRIB.EQUIPMENTRATES': { target: 'equipment_rates' },
  'peopleApp.EMPLOYEESJOBTITLES': { target: 'person_titles' },
  'peopleApp.EMPLOYEESDIVISIONS': { target: 'departments / person_divisions' },
  'ExternalTraining.TRAININGEVALUATORS': { kind: 'review', target: 'people(evaluator)', note: 'no evaluators table' },
}

const KIND_ORDER = ['map', 'transform', 'gap', 'review', 'drop']
const rows = []
const unclassified = []
const mappingJson = { generatedFrom: 'docs/migration/legacy-schema.json', tenantsByDb: TENANT_BY_DB, tables: {} }

for (const [db, tbls] of Object.entries(schema)) {
  for (const [tbl, meta] of Object.entries(tbls)) {
    if (tbl === '__error') continue
    const key = `${db}.${tbl}`
    const base = D[key] ?? { kind: 'review', note: '(UNCLASSIFIED — needs disposition)' }
    const disp = { ...base, ...(FIX[key] ?? {}) }
    if (!D[key]) unclassified.push(key)
    const tenant = disp.tenant ?? TENANT_BY_DB[db] ?? '?'
    rows.push({ db, tbl, rows: meta.rows ?? 0, cols: meta.columns.length, pk: meta.pk.join(','), ct: meta.changeTracking[0] ?? '', kind: disp.kind, target: disp.target ?? '', note: disp.note ?? '', tenant })
    mappingJson.tables[key] = {
      db, table: tbl, tenant, rows: meta.rows ?? 0,
      pk: meta.pk, changeTracking: meta.changeTracking,
      disposition: { kind: disp.kind, target: disp.target ?? null, note: disp.note ?? '' },
      columns: meta.columns.map((c) => ({ name: c.name, type: c.type, nullable: c.nullable, identity: c.identity, computed: c.computed })),
    }
  }
}

// ---- emit mapping.json ----
writeFileSync(ROOT + 'docs/migration/mapping.json', JSON.stringify(mappingJson, null, 2))

// ---- emit legacy-inventory.md ----
const byKind = {}
let totalRows = 0
for (const r of rows) { byKind[r.kind] = (byKind[r.kind] || 0) + 1; totalRows += r.rows }
const fmt = (n) => Number(n).toLocaleString()
let md = `# Legacy → BeaconHS — table inventory & disposition\n\n`
md += `_Generated from \`legacy-schema.json\` (MSSQL 2022 @ 10.0.0.44). ${rows.length} in-scope tables, ~${fmt(totalRows)} rows._\n\n`
md += `**Disposition legend:** \`map\` = load 1:1-ish · \`transform\` = reshaped (Forms / EAV pivot) · \`gap\` = no target, build first · \`review\` = decision needed · \`drop\` = not migrated.\n\n`
md += `**Counts:** ` + KIND_ORDER.map((k) => `${k}=${byKind[k] || 0}`).join(' · ') + `\n\n`
for (const db of Object.keys(schema)) {
  const dbRows = rows.filter((r) => r.db === db).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.rows - a.rows)
  if (!dbRows.length) continue
  md += `\n## ${db} → tenant \`${TENANT_BY_DB[db]}\` (${dbRows.length} tables)\n\n`
  md += `| table | rows | cols | pk | disposition | target | notes |\n|---|--:|--:|---|---|---|---|\n`
  for (const r of dbRows) {
    md += `| \`${r.tbl}\` | ${fmt(r.rows)} | ${r.cols} | ${r.pk || '—'} | **${r.kind}** | ${r.target || '—'} | ${r.note} |\n`
  }
}
writeFileSync(ROOT + 'docs/migration/legacy-inventory.md', md)

// ---- console summary ----
console.log(`tables=${rows.length} totalRows≈${fmt(totalRows)}`)
console.log('by kind: ' + KIND_ORDER.map((k) => `${k}=${byKind[k] || 0}`).join('  '))
console.log('rows by kind:')
for (const k of KIND_ORDER) {
  const rr = rows.filter((r) => r.kind === k).reduce((a, r) => a + r.rows, 0)
  console.log(`  ${k}: ${fmt(rr)} rows`)
}
if (unclassified.length) {
  console.log(`\nUNCLASSIFIED (${unclassified.length}) — defaulted to review:`)
  for (const u of unclassified) console.log('  ' + u)
} else console.log('\nAll tables classified.')
console.log('\nwrote docs/migration/legacy-inventory.md + mapping.json')
