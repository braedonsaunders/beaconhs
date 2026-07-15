import { describe, expect, it } from 'vitest'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrations = {
  cutover: readProductionCutoverSection('0005_watery_blizzard.sql'),
  forms: readProductionCutoverSection('0006_lean_inhumans.sql'),
  hazidBuilder: readProductionCutoverSection('0007_pink_marvex.sql'),
  hazid: readProductionCutoverSection('0008_fast_warbound.sql'),
  equipment: readProductionCutoverSection('0009_special_redwing.sql'),
  documentVersions: readProductionCutoverSection('0010_chilly_proudstar.sql'),
  documents: readProductionCutoverSection('0011_famous_hammerhead.sql'),
  sourceOnlyTemplates: readProductionCutoverSection('0014_natural_captain_marvel.sql'),
  storageDeletionOutbox: readProductionCutoverSection('0019_storage_object_deletion_outbox.sql'),
  trainingCompletion: readProductionCutoverSection('0020_training_completion_cutover.sql'),
  trainingValueGuards: readProductionCutoverSection('0021_training_record_value_guards.sql'),
  incidentInjuries: readProductionCutoverSection('0024_incident_injury_taxonomy_cutover.sql'),
  orphanColumns: readProductionCutoverSection('0026_orphan_column_cutover.sql'),
  unifiedAssignments: readProductionCutoverSection(
    '0028_unified_compliance_assignment_cutover.sql',
  ),
  documentReviewSnapshots: readProductionCutoverSection(
    '0029_document_review_snapshot_cutover.sql',
  ),
  inspectionResponses: readProductionCutoverSection(
    '0030_inspection_configured_response_cutover.sql',
  ),
  identityAccess: readProductionCutoverSection('0031_identity_access_shadow_cutover.sql'),
  notificationRecipientShadow: readProductionCutoverSection(
    '0032_notification_recipient_shadow_cutover.sql',
  ),
  physicalConvergence: readProductionCutoverSection('0033_physical_schema_convergence.sql'),
  finalProductionInvariants: readProductionCutoverSection('0034_final_production_invariants.sql'),
}

function rlsTables(sql: string, force: 'relax' | 'restore'): string[] {
  const expression =
    force === 'relax'
      ? /^ALTER TABLE "([^"]+)" NO FORCE ROW LEVEL SECURITY;.*$/gm
      : /^ALTER TABLE "([^"]+)" FORCE ROW LEVEL SECURITY;.*$/gm
  return [...sql.matchAll(expression)].map((match) => match[1]!).sort()
}

function expectVisiblePreflight(input: {
  sql: string
  expectedTables: string[]
  errorText: string
  firstDurableDdl: string
}) {
  const { sql, expectedTables, errorText, firstDurableDdl } = input
  expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
  expect(rlsTables(sql, 'relax')).toEqual([...expectedTables].sort())
  expect(rlsTables(sql, 'restore')).toEqual([...expectedTables].sort())

  const lastRelaxAt = sql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
  const errorAt = sql.indexOf(errorText)
  const firstRestoreAt = sql.indexOf(
    'FORCE ROW LEVEL SECURITY',
    lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
  )
  const durableDdlAt = sql.indexOf(firstDurableDdl)
  expect(errorAt).toBeGreaterThan(lastRelaxAt)
  expect(firstRestoreAt).toBeGreaterThan(errorAt)
  expect(durableDdlAt).toBeGreaterThan(firstRestoreAt)
}

describe('migration all-tenant visibility under FORCE RLS', () => {
  it('protects storage deletion intents before installing trigger writers', () => {
    const sql = migrations.storageDeletionOutbox
    const tableAt = sql.indexOf('CREATE TABLE "storage_object_deletion_outbox"')
    const enableAt = sql.indexOf(
      'ALTER TABLE "storage_object_deletion_outbox" ENABLE ROW LEVEL SECURITY',
    )
    const policyAt = sql.indexOf(
      'CREATE POLICY "tenant_isolation" ON "storage_object_deletion_outbox"',
    )
    const forceAt = sql.indexOf(
      'ALTER TABLE "storage_object_deletion_outbox" FORCE ROW LEVEL SECURITY',
    )
    const triggerFunctionAt = sql.indexOf(
      'CREATE OR REPLACE FUNCTION "enqueue_attachment_storage_object_deletion"',
    )

    expect(tableAt).toBeGreaterThanOrEqual(0)
    expect(enableAt).toBeGreaterThan(tableAt)
    expect(policyAt).toBeGreaterThan(enableAt)
    expect(forceAt).toBeGreaterThan(policyAt)
    expect(triggerFunctionAt).toBeGreaterThan(forceAt)
  })

  it('makes training value preflights visible before installing their constraints', () => {
    const sql = migrations.trainingValueGuards
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(rlsTables(sql, 'relax')).toEqual(['training_records', 'training_skill_assignment_files'])
    expect(rlsTables(sql, 'restore')).toEqual(rlsTables(sql, 'relax'))

    const lastRelaxAt = sql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const invalidGradeAt = sql.indexOf('have a grade outside 0..100')
    const invalidKindAt = sql.indexOf('have an unsupported kind')
    const firstRestoreAt = sql.indexOf(
      'FORCE ROW LEVEL SECURITY',
      lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
    )
    const firstConstraintAt = sql.indexOf('ADD CONSTRAINT "training_records_grade_ck"')
    const orderedPositions = [
      lastRelaxAt,
      invalidGradeAt,
      invalidKindAt,
      firstRestoreAt,
      firstConstraintAt,
    ]
    expect(orderedPositions.every((position) => position >= 0)).toBe(true)
    expect(orderedPositions).toEqual([...orderedPositions].sort((left, right) => left - right))
  })

  it('preserves legacy job titles without overriding structured primaries', () => {
    const sql = migrations.identityAccess
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(rlsTables(sql, 'relax')).toEqual([
      'crews',
      'departments',
      'insight_cards',
      'insight_dashboards',
      'people',
      'person_groups',
      'person_title_assignments',
      'person_titles',
      'report_definitions',
      'report_runs',
      'report_schedules',
      'role_assignments',
      'sync_connections',
      'sync_crosswalk',
      'trades',
    ])
    expect(rlsTables(sql, 'restore')).toEqual(rlsTables(sql, 'relax'))

    const lastRelaxAt = sql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const primaryDuplicateAt = sql.indexOf('have duplicate primary title assignments')
    const archivedAssignmentAt = sql.indexOf('reference an archived title')
    const persistedReaderAt = sql.indexOf(
      'persisted report/dashboard definition(s) still reference the retired job_title field',
    )
    const roleDuplicateAt = sql.indexOf('member/role group(s) contain duplicate assignments')
    const retiredSyncOwnerAt = sql.indexOf('still owned by a retired connection')
    const syncOwnerDuplicateAt = sql.indexOf('have multiple authoritative crosswalks')
    const catalogBlankAt = sql.indexOf('row(s) have blank canonical names')
    const catalogDuplicateAt = sql.indexOf('ambiguous across active or deleted rows')
    const sourceAt = sql.indexOf('INSERT INTO "_legacy_person_title_backfill"')
    const deletedMatchAt = sql.indexOf('resolve only to a deleted catalog row')
    const catalogInsertAt = sql.indexOf('INSERT INTO "person_titles"')
    const existingAssignmentAt = sql.indexOf('UPDATE "person_title_assignments" AS assignment')
    const newAssignmentAt = sql.indexOf('INSERT INTO "person_title_assignments"')
    const finalVerificationAt = sql.indexOf(
      'nonblank legacy value(s) remain without a structured primary',
    )
    const sourceColumnAt = sql.indexOf('ADD COLUMN "source_connection_id" uuid')
    const titleCacheAt = sql.indexOf('SET "title_ids" = desired.title_ids')
    const titleCacheVerificationAt = sql.indexOf('have a stale title_ids cache')
    const manualOwnershipColumnAt = sql.indexOf(
      'ADD COLUMN "is_manually_maintained" boolean DEFAULT true NOT NULL',
    )
    const sourceBackfillAt = sql.indexOf('SET "source_connection_id" = owner."connection_id"')
    const sourceVerificationAt = sql.indexOf(
      'eligible primary assignment(s) were not attached to their exact people connection',
    )
    const firstRestoreAt = sql.indexOf(
      'FORCE ROW LEVEL SECURITY',
      lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
    )
    const firstNonblankCheckAt = sql.indexOf('ADD CONSTRAINT "departments_name_nonblank_ck"')
    const firstRetiredIndexDropAt = sql.indexOf('DROP INDEX "departments_tenant_name_ux"')
    const departmentIndexAt = sql.indexOf(
      'CREATE UNIQUE INDEX "departments_tenant_normalized_name_ux"',
    )
    const tradeIndexAt = sql.indexOf('CREATE UNIQUE INDEX "trades_tenant_normalized_name_ux"')
    const crewIndexAt = sql.indexOf('CREATE UNIQUE INDEX "crews_tenant_normalized_name_ux"')
    const groupIndexAt = sql.indexOf(
      'CREATE UNIQUE INDEX "person_groups_tenant_normalized_name_ux"',
    )
    const normalizedTitleIndexAt = sql.indexOf(
      'CREATE UNIQUE INDEX "person_titles_tenant_normalized_name_ux"',
    )
    const primaryIndexAt = sql.indexOf(
      'CREATE UNIQUE INDEX "person_title_assignments_one_primary_ux"',
    )
    const roleIndexAt = sql.indexOf('CREATE UNIQUE INDEX "role_assignments_tenant_user_role_ux"')
    const syncOwnerIndexAt = sql.indexOf(
      'CREATE UNIQUE INDEX "sync_crosswalk_tenant_entity_canonical_owner_ux"',
    )
    const sourceConnectionIndexAt = sql.indexOf(
      'CREATE INDEX "person_title_assignments_source_connection_idx"',
    )
    const sourceOwnerIndexAt = sql.indexOf(
      'CREATE UNIQUE INDEX "person_title_assignments_source_owner_ux"',
    )
    const ownerCheckAt = sql.indexOf('ADD CONSTRAINT "person_title_assignments_has_owner_ck"')
    const sourcePrimaryCheckAt = sql.indexOf(
      'ADD CONSTRAINT "person_title_assignments_source_primary_ck"',
    )
    const sourceConnectionForeignKeyAt = sql.indexOf(
      'ADD CONSTRAINT "person_title_assignments_tenant_source_connection_fk"',
    )
    const signatureAttachmentForeignKeyAt = sql.indexOf(
      'ADD CONSTRAINT "job_title_task_acks_tenant_signature_attachment_fk"',
    )
    const immutableTaskTriggerAt = sql.indexOf(
      'CREATE TRIGGER "job_title_tasks_acknowledged_content_guard_trg"',
    )
    const legacyDropAt = sql.indexOf('ALTER TABLE "people" DROP COLUMN "job_title"')

    const orderedPositions = [
      lastRelaxAt,
      primaryDuplicateAt,
      archivedAssignmentAt,
      persistedReaderAt,
      roleDuplicateAt,
      retiredSyncOwnerAt,
      syncOwnerDuplicateAt,
      catalogBlankAt,
      catalogDuplicateAt,
      sourceAt,
      deletedMatchAt,
      catalogInsertAt,
      existingAssignmentAt,
      newAssignmentAt,
      finalVerificationAt,
      titleCacheAt,
      titleCacheVerificationAt,
      sourceColumnAt,
      manualOwnershipColumnAt,
      sourceBackfillAt,
      sourceVerificationAt,
      firstRestoreAt,
      firstNonblankCheckAt,
      firstRetiredIndexDropAt,
      departmentIndexAt,
      tradeIndexAt,
      crewIndexAt,
      groupIndexAt,
      normalizedTitleIndexAt,
      primaryIndexAt,
      roleIndexAt,
      syncOwnerIndexAt,
      sourceConnectionIndexAt,
      sourceOwnerIndexAt,
      ownerCheckAt,
      sourcePrimaryCheckAt,
      sourceConnectionForeignKeyAt,
      signatureAttachmentForeignKeyAt,
      immutableTaskTriggerAt,
      legacyDropAt,
    ]
    expect(orderedPositions.every((position) => position >= 0)).toBe(true)
    expect(orderedPositions).toEqual([...orderedPositions].sort((left, right) => left - right))
    expect(sql).toContain(
      "btrim(regexp_replace(normalize(person.\"job_title\", NFKC), '[[:space:]]+', ' ', 'g'))",
    )
    for (const catalog of ['departments', 'trades', 'crews', 'person_groups', 'person_titles']) {
      expect(sql).toContain(`SELECT '${catalog}', "tenant_id", "id",`)
      expect(sql).toContain(`ADD CONSTRAINT "${catalog}_name_nonblank_ck"`)
      expect(sql).toContain(`VALIDATE CONSTRAINT "${catalog}_name_nonblank_ck"`)
      expect(sql).toContain(`CREATE UNIQUE INDEX "${catalog}_tenant_normalized_name_ux"`)
    }
    expect(sql).toContain(
      "lower(btrim(regexp_replace(normalize(\"name\", NFKC), '[[:space:]]+', ' ', 'g')))",
    )
    expect(sql).not.toContain('regexp_replace(btrim(normalize(')
    for (const catalog of ['departments', 'person_groups', 'person_titles']) {
      expect(sql).toContain(`DROP INDEX "${catalog}_tenant_name_ux"`)
    }
    expect(sql).toContain('DROP INDEX "sync_crosswalk_canonical_idx"')
    expect(sql).toContain('assignment."updated_at" <= owner."last_synced_at"')
    expect(sql).toContain('"is_manually_maintained" IS DISTINCT FROM true')
    expect(sql).toContain(
      'VALIDATE CONSTRAINT "person_title_assignments_tenant_source_connection_fk"',
    )
    expect(sql.slice(sourceAt, deletedMatchAt)).toContain('assignment."is_primary" = true')
    expect(sql.slice(sourceAt, deletedMatchAt)).toContain('title."deleted_at" IS NULL')
    expect(sql).toContain("run.\"status\" IN ('queued', 'running')")
    for (const persistedField of [
      'definition."custom_query"',
      'schedule."filters"',
      'run."request_snapshot"',
      'card."query"',
      'card."viz_settings"',
      'card."config"',
      'dashboard."layout"',
      'dashboard."params"',
      'dashboard."param_map"',
    ]) {
      expect(sql).toContain(persistedField)
    }
    expect(sql).toContain('jsonb_agg(assignment."title_id" ORDER BY assignment."title_id")')
    expect(sql).toContain('prevent_acknowledged_job_title_task_rewrite')
    expect(sql).not.toContain('ON CONFLICT DO NOTHING')
  })

  it('merges the orphaned notification recipient table before removing it', () => {
    const sql = migrations.notificationRecipientShadow
    expectVisiblePreflight({
      sql,
      expectedTables: ['tenant_notification_recipients', 'tenant_notification_settings'],
      errorText: 'legacy row(s) have a blank category or user id',
      firstDurableDdl: 'DROP TABLE "tenant_notification_recipients"',
    })

    const insertAt = sql.indexOf('INSERT INTO "tenant_notification_settings"')
    const verificationAt = sql.indexOf('legacy row(s) are missing from canonical user_ids')
    const firstRestoreAt = sql.indexOf(
      'ALTER TABLE "tenant_notification_recipients" FORCE ROW LEVEL SECURITY',
    )
    const dropAt = sql.indexOf('DROP TABLE "tenant_notification_recipients"')
    const orderedPositions = [insertAt, verificationAt, firstRestoreAt, dropAt]
    expect(orderedPositions.every((position) => position >= 0)).toBe(true)
    expect(orderedPositions).toEqual([...orderedPositions].sort((left, right) => left - right))
    expect(sql).toContain('jsonb_agg(DISTINCT recipient."user_id"')
    expect(sql).toContain('"tenant_notification_settings"."user_ids" || EXCLUDED."user_ids"')
    expect(sql).toContain("jsonb_typeof(entry.value) IS DISTINCT FROM 'string'")
    expect(sql).toContain('["safety_manager", "tenant_admin"]')
    expect(sql).toContain('ELSE \'["tenant_admin"]\'::jsonb')
  })

  it('converges historical physical columns only after all-tenant fail-closed checks', () => {
    const sql = migrations.physicalConvergence
    expectVisiblePreflight({
      sql,
      expectedTables: [
        'ca_complete_steps',
        'compliance_obligations',
        'document_categories',
        'documents',
        'equipment_categories',
        'equipment_types',
        'flow_gates',
        'form_response_steps',
        'hazid_assessment_signatures',
        'incidents',
        'inspection_records',
        'integration_export_log',
        'job_title_task_acknowledgments',
        'report_runs',
        'report_schedules',
        'tenant_integrations',
        'training_lesson_progress',
      ],
      errorText: 'Signature storage cutover blocked',
      firstDurableDdl:
        'ALTER TABLE "integration_export_log" ALTER COLUMN "automation_id" SET NOT NULL',
    })

    const signatureGuardAt = sql.indexOf('Signature storage cutover blocked')
    const retiredIntegrationNormalizeAt = sql.indexOf('SET "name" = btrim("integration_key")')
    const complianceGuardAt = sql.indexOf('Compliance legacy-identity cutover blocked')
    const documentGuardAt = sql.indexOf('Document category cutover blocked')
    const equipmentInsertAt = sql.indexOf('INSERT INTO "equipment_categories"')
    const equipmentVerificationAt = sql.indexOf(
      'Equipment type category cutover verification failed',
    )
    const firstRestoreAt = sql.indexOf('ALTER TABLE "ca_complete_steps" FORCE ROW LEVEL SECURITY')
    const firstNotNullAt = sql.indexOf(
      'ALTER TABLE "integration_export_log" ALTER COLUMN "automation_id" SET NOT NULL',
    )
    const firstIndexDropAt = sql.indexOf('DROP INDEX "api_keys_hash_idx"')
    const firstColumnDropAt = sql.indexOf(
      'ALTER TABLE "ca_complete_steps" DROP COLUMN "signature_data_url"',
    )
    const orderedPositions = [
      signatureGuardAt,
      complianceGuardAt,
      documentGuardAt,
      equipmentInsertAt,
      equipmentVerificationAt,
      firstRestoreAt,
      firstNotNullAt,
      firstIndexDropAt,
      firstColumnDropAt,
    ]
    expect(orderedPositions.every((position) => position >= 0)).toBe(true)
    expect(orderedPositions).toEqual([...orderedPositions].sort((left, right) => left - right))
    expect(sql).toContain('Incident classification cutover blocked')
    expect(sql).toContain('Incident medical-field cutover blocked')
    expect(sql).toContain('("ems_notified" AND NOT "ems_called")')
    expect(sql).toContain('("first_aid_received" AND NOT "first_aid_given")')
    expect(sql).not.toContain('("ems_called" AND NOT "ems_notified")')
    expect(sql).not.toContain('("first_aid_given" AND NOT "first_aid_received")')
    expect(sql).toContain('Integration-key cutover blocked')
    expect(retiredIntegrationNormalizeAt).toBeLessThan(signatureGuardAt)
    expect(sql).toContain('Report run cutover blocked')
    expect(sql).toContain('DROP COLUMN "legacy_table"')
    expect(sql).toContain('DROP COLUMN "contents"')
    expect(sql).toContain('DROP COLUMN "classification"')
  })

  it('protects the normalized incident injury taxonomy throughout cutover', () => {
    const sql = migrations.incidentInjuries
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(rlsTables(sql, 'relax')).toEqual([
      'incident_injuries',
      'incident_injury_type_assignments',
      'incident_injury_types',
    ])
    expect(rlsTables(sql, 'restore')).toEqual(rlsTables(sql, 'relax'))

    const createAt = sql.indexOf('CREATE TABLE "incident_injury_type_assignments"')
    const enableAt = sql.indexOf(
      'ALTER TABLE "incident_injury_type_assignments" ENABLE ROW LEVEL SECURITY',
    )
    const finalVerificationAt = sql.indexOf('Incident injury Result cutover verification failed')
    const policyAt = sql.indexOf(
      'CREATE POLICY "tenant_isolation" ON "incident_injury_type_assignments"',
    )
    const forceAt = sql.indexOf(
      'ALTER TABLE "incident_injury_type_assignments" FORCE ROW LEVEL SECURITY',
    )
    const firstDropAt = sql.indexOf('DROP INDEX "incident_injuries_injury_type_idx"')

    expect(createAt).toBeGreaterThanOrEqual(0)
    expect(enableAt).toBeGreaterThan(createAt)
    expect(policyAt).toBeGreaterThan(finalVerificationAt)
    expect(forceAt).toBeGreaterThan(policyAt)
    expect(firstDropAt).toBeGreaterThan(forceAt)
  })

  it('rebuilds the inspection response enum before adding mutually exclusive value stores', () => {
    const sql = migrations.inspectionResponses
    expect(sql).not.toMatch(/ALTER TYPE\s+"[^"]+"(?:\."[^"]+")?\s+ADD VALUE/)

    const labelPreflightAt = sql.indexOf('inspection_bank_response_type has unexpected labels')
    const typeDefaultDropAt = sql.indexOf(
      'ALTER TABLE "inspection_type_criteria"\n  ALTER COLUMN "response_type" DROP DEFAULT',
    )
    const recordDefaultDropAt = sql.indexOf(
      'ALTER TABLE "inspection_record_criteria"\n  ALTER COLUMN "response_type" DROP DEFAULT',
    )
    const renameAt = sql.indexOf('RENAME TO "inspection_bank_response_type_retired"')
    const createAt = sql.indexOf(
      "AS ENUM('pass_fail_na', 'rating', 'yes_no', 'choice', 'text', 'long_text', 'number')",
    )
    const bankCastAt = sql.indexOf(
      'ALTER TABLE "inspection_bank_criteria"\n  ALTER COLUMN "response_type" TYPE',
    )
    const typeCastAt = sql.indexOf(
      'ALTER TABLE "inspection_type_criteria"\n  ALTER COLUMN "response_type" TYPE',
    )
    const recordCastAt = sql.indexOf(
      'ALTER TABLE "inspection_record_criteria"\n  ALTER COLUMN "response_type" TYPE',
    )
    const typeDefaultRestoreAt = sql.indexOf(
      'ALTER TABLE "inspection_type_criteria"\n  ALTER COLUMN "response_type" SET DEFAULT',
    )
    const recordDefaultRestoreAt = sql.indexOf(
      'ALTER TABLE "inspection_record_criteria"\n  ALTER COLUMN "response_type" SET DEFAULT',
    )
    const retiredTypeDropAt = sql.indexOf(
      'DROP TYPE "public"."inspection_bank_response_type_retired"',
    )
    const firstColumnAt = sql.indexOf('ADD COLUMN "choice_options"')
    const textColumnAt = sql.indexOf('ADD COLUMN "text_answer" text')
    const numberColumnAt = sql.indexOf('ADD COLUMN "number_answer" numeric')
    const bankCheckAt = sql.indexOf('ADD CONSTRAINT "inspection_bank_criteria_choice_options_ck"')
    const typeCheckAt = sql.indexOf('ADD CONSTRAINT "inspection_type_criteria_choice_options_ck"')
    const recordCheckAt = sql.indexOf(
      'ADD CONSTRAINT "inspection_record_criteria_response_shape_ck"',
    )
    const finalValidationAt = sql.indexOf(
      'VALIDATE CONSTRAINT "inspection_record_criteria_response_shape_ck"',
    )

    const orderedPositions = [
      labelPreflightAt,
      typeDefaultDropAt,
      recordDefaultDropAt,
      renameAt,
      createAt,
      bankCastAt,
      typeCastAt,
      recordCastAt,
      typeDefaultRestoreAt,
      recordDefaultRestoreAt,
      retiredTypeDropAt,
      firstColumnAt,
      textColumnAt,
      numberColumnAt,
      bankCheckAt,
      typeCheckAt,
      recordCheckAt,
      finalValidationAt,
    ]
    expect(orderedPositions.every((position) => position >= 0)).toBe(true)
    expect(orderedPositions).toEqual([...orderedPositions].sort((left, right) => left - right))
    expect(sql).toContain('"answer" IS NULL')
    expect(sql).toContain('"choice_options_snapshot" ? "choice_answer"')
    expect(sql).toContain("\"response_type\" IN ('text', 'long_text')")
    expect(sql).toContain('"response_type" = \'number\'')
    expect(sql).toContain("\"response_type\" IN ('pass_fail_na', 'rating', 'yes_no')")
  })

  it('pins review evidence only after fail-closed temporal and cardinality preflights', () => {
    const sql = migrations.documentReviewSnapshots
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(rlsTables(sql, 'relax')).toEqual([
      'document_management_review_documents',
      'document_management_reviews',
      'document_reviews',
      'document_versions',
      'documents',
    ])
    expect(rlsTables(sql, 'restore')).toEqual(rlsTables(sql, 'relax'))

    const lastRelaxAt = sql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const temporalPreflightAt = sql.indexOf('have no version published by reviewed_at')
    const ambiguityPreflightAt = sql.indexOf('ambiguous latest published_at/version candidate')
    const perReviewBackfillAt = sql.indexOf('UPDATE "document_reviews" AS review')
    const jsonShapeAt = sql.indexOf('have a non-array documents_reviewed payload')
    const firstJsonExpansionAt = sql.indexOf('jsonb_array_elements(review."documents_reviewed")')
    const uuidShapeAt = sql.indexOf('contain a non-UUID document value')
    const firstUuidCastAt = sql.indexOf('element.value::uuid AS document_id')
    const oneVersionAt = sql.indexOf('do not identify exactly one published version')
    const managementBackfillAt = sql.indexOf('INSERT INTO "document_management_review_documents"')
    const verificationAt = sql.indexOf('Management review document verification failed')
    const firstRestoreAt = sql.indexOf('ALTER TABLE "documents" FORCE ROW LEVEL SECURITY')
    const requiredVersionAt = sql.indexOf('ALTER COLUMN "document_version_id" SET NOT NULL')
    const exactVersionFkAt = sql.indexOf('ADD CONSTRAINT "document_reviews_tenant_doc_version_fk"')
    const legacyDropAt = sql.indexOf('DROP COLUMN "documents_reviewed"')

    expect(temporalPreflightAt).toBeGreaterThan(lastRelaxAt)
    expect(ambiguityPreflightAt).toBeGreaterThan(temporalPreflightAt)
    expect(perReviewBackfillAt).toBeGreaterThan(ambiguityPreflightAt)
    expect(jsonShapeAt).toBeGreaterThan(perReviewBackfillAt)
    expect(firstJsonExpansionAt).toBeGreaterThan(jsonShapeAt)
    expect(uuidShapeAt).toBeGreaterThan(jsonShapeAt)
    expect(firstUuidCastAt).toBeGreaterThan(uuidShapeAt)
    expect(oneVersionAt).toBeGreaterThan(firstUuidCastAt)
    expect(managementBackfillAt).toBeGreaterThan(oneVersionAt)
    expect(verificationAt).toBeGreaterThan(managementBackfillAt)
    expect(firstRestoreAt).toBeGreaterThan(verificationAt)
    expect(requiredVersionAt).toBeGreaterThan(firstRestoreAt)
    expect(exactVersionFkAt).toBeGreaterThan(requiredVersionAt)
    expect(legacyDropAt).toBeGreaterThan(exactVersionFkAt)
    expect(sql).toContain('CREATE POLICY "tenant_isolation"')
  })

  it('proves retired course material and slide stores have canonical replacements', () => {
    const sql = migrations.orphanColumns
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(rlsTables(sql, 'relax')).toEqual(rlsTables(sql, 'restore'))

    const jsonShapeAt = sql.indexOf('have a non-array attachment value')
    const uuidShapeAt = sql.indexOf('have a malformed attachment array')
    const firstAttachmentCastAt = sql.indexOf('element.value::uuid')
    const pptxPreflightAt = sql.indexOf('lack a valid non-empty PowerPoint master')
    const contentBlockShapeAt = sql.indexOf('contain malformed legacy block JSON')
    const contentBlockCoverageAt = sql.indexOf(
      'contain authored legacy blocks without canonical HTML',
    )
    const materialBackfillAt = sql.indexOf('INSERT INTO "training_course_files"')
    const materialVerificationAt = sql.indexOf('Training course material verification failed')
    const firstRestoreAt = sql.indexOf('ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY')
    const firstDropAt = sql.indexOf('ALTER TABLE "training_courses" DROP COLUMN')

    expect(uuidShapeAt).toBeGreaterThan(jsonShapeAt)
    expect(firstAttachmentCastAt).toBeGreaterThan(uuidShapeAt)
    expect(pptxPreflightAt).toBeGreaterThan(firstAttachmentCastAt)
    expect(contentBlockShapeAt).toBeGreaterThan(pptxPreflightAt)
    expect(contentBlockCoverageAt).toBeGreaterThan(contentBlockShapeAt)
    expect(materialBackfillAt).toBeGreaterThan(pptxPreflightAt)
    expect(materialVerificationAt).toBeGreaterThan(materialBackfillAt)
    expect(firstRestoreAt).toBeGreaterThan(materialVerificationAt)
    expect(firstDropAt).toBeGreaterThan(firstRestoreAt)
    expect(sql).toContain('ALTER TABLE "training_lessons" DROP COLUMN "content_blocks"')
    expect(sql).toContain('ALTER TABLE "training_content_items" DROP COLUMN "content_blocks"')
  })

  it('reconciles every shadow assignment before any destructive cutover DDL', () => {
    const sql = migrations.unifiedAssignments
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(sql).not.toMatch(/DROP TABLE .*CASCADE/)
    expect(sql).not.toMatch(/source_pk[^\n]*::uuid/)
    expect(rlsTables(sql, 'relax')).toEqual(rlsTables(sql, 'restore'))

    const lastRelaxAt = sql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const jsonShapeAt = sql.indexOf('have malformed audience containers')
    const uuidShapeAt = sql.indexOf('audience UUID value(s) are malformed')
    const firstAudienceUuidCastAt = sql.indexOf('value::uuid AS entity_id')
    const etlAmbiguityAt = sql.indexOf('multiple accepted ETL identities')
    const evidencePreflightAt = sql.indexOf(
      'Training assessment cutover blocked: % assignment link',
    )
    const evidenceBackfillAt = sql.indexOf('UPDATE "training_assessments" AS assessment')
    const finalVerificationAt = sql.indexOf(
      'Compliance assignment cutover verification failed: % legacy assignment(s)',
    )
    const firstRestoreAt = sql.indexOf(
      'FORCE ROW LEVEL SECURITY',
      lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
    )
    const firstLegacyDropAt = sql.indexOf('DROP TABLE "form_assignment_dispatches"')
    const oldAssessmentColumnDropAt = sql.indexOf(
      'ALTER TABLE "training_assessments" DROP COLUMN "assignment_id"',
    )

    expect(jsonShapeAt).toBeGreaterThan(lastRelaxAt)
    expect(uuidShapeAt).toBeGreaterThan(jsonShapeAt)
    expect(firstAudienceUuidCastAt).toBeGreaterThan(uuidShapeAt)
    expect(etlAmbiguityAt).toBeGreaterThan(lastRelaxAt)
    expect(evidenceBackfillAt).toBeGreaterThan(evidencePreflightAt)
    expect(finalVerificationAt).toBeGreaterThan(evidenceBackfillAt)
    expect(firstRestoreAt).toBeGreaterThan(finalVerificationAt)
    expect(oldAssessmentColumnDropAt).toBeGreaterThan(firstRestoreAt)
    expect(firstLegacyDropAt).toBeGreaterThan(oldAssessmentColumnDropAt)
  })

  it('makes the training retirement scan and webhook cleanup see every tenant', () => {
    const sql = migrations.cutover
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(rlsTables(sql, 'relax')).toEqual([
      'form_automations',
      'training_content_items',
      'training_lessons',
    ])
    expect(rlsTables(sql, 'restore')).toEqual([
      'form_automations',
      'training_content_items',
      'training_lessons',
    ])

    const trainingRelaxAt = sql.indexOf(
      'ALTER TABLE "training_content_items" NO FORCE ROW LEVEL SECURITY',
    )
    const contentErrorAt = sql.indexOf('meaningful legacy row(s) have no canonical content_html')
    const trainingRestoreAt = sql.indexOf(
      'ALTER TABLE "training_content_items" FORCE ROW LEVEL SECURITY',
    )
    const contentDropAt = sql.indexOf(
      'ALTER TABLE "training_content_items" DROP COLUMN IF EXISTS "content_json"',
    )
    expect(contentErrorAt).toBeGreaterThan(trainingRelaxAt)
    expect(trainingRestoreAt).toBeGreaterThan(contentErrorAt)
    expect(contentDropAt).toBeGreaterThan(trainingRestoreAt)

    const automationRelaxAt = sql.indexOf(
      'ALTER TABLE "form_automations" NO FORCE ROW LEVEL SECURITY',
    )
    const automationUpdateAt = sql.indexOf('UPDATE "form_automations"')
    const automationRestoreAt = sql.indexOf(
      'ALTER TABLE "form_automations" FORCE ROW LEVEL SECURITY',
    )
    expect(automationUpdateAt).toBeGreaterThan(automationRelaxAt)
    expect(automationRestoreAt).toBeGreaterThan(automationUpdateAt)
  })

  it('revalidates source-only template cutover data across every tenant', () => {
    const sql = migrations.sourceOnlyTemplates
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(rlsTables(sql, 'relax')).toEqual(['email_templates'])
    expect(rlsTables(sql, 'restore')).toEqual(['email_templates'])

    const lastRelaxAt = sql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const emailConflictAt = sql.indexOf('have conflicting mjml_source and source_html')
    const firstRestoreAt = sql.indexOf(
      'FORCE ROW LEVEL SECURITY',
      lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
    )
    const renameAt = sql.indexOf('RENAME COLUMN mjml_source TO source_html')
    const firstDropAt = sql.indexOf('DROP COLUMN IF EXISTS')
    expect(emailConflictAt).toBeGreaterThan(lastRelaxAt)
    expect(firstRestoreAt).toBeGreaterThan(emailConflictAt)
    expect(renameAt).toBeGreaterThan(firstRestoreAt)
    expect(firstDropAt).toBeGreaterThan(firstRestoreAt)
  })

  it('makes the Builder form preflight see every scanned tenant table', () => {
    expectVisiblePreflight({
      sql: migrations.forms,
      expectedTables: [
        'attachments',
        'flow_gates',
        'form_assignments',
        'form_automations',
        'form_response_checkins',
        'form_response_comments',
        'form_response_participants',
        'form_response_scores',
        'form_response_steps',
        'form_responses',
        'form_template_versions',
        'form_templates',
        'org_units',
        'people',
      ],
      errorText: 'Builder form tenant/relation integrity preflight failed',
      firstDurableDdl: 'CREATE UNIQUE INDEX',
    })
  })

  it('makes the HazID Builder bridge preflight see every scanned tenant table', () => {
    expectVisiblePreflight({
      sql: migrations.hazidBuilder,
      expectedTables: [
        'form_responses',
        'form_templates',
        'hazid_assessment_app_responses',
        'hazid_assessment_type_apps',
      ],
      errorText: 'HazID Builder-link integrity preflight failed',
      firstDurableDdl: 'CREATE UNIQUE INDEX',
    })
  })

  it('makes the complete HazID preflight see every scanned tenant table', () => {
    expectVisiblePreflight({
      sql: migrations.hazid,
      expectedTables: [
        'tenant_users',
        'org_units',
        'people',
        'hazid_hazard_types',
        'hazid_hazards',
        'hazid_hazard_sets',
        'hazid_tasks',
        'hazid_location_tasks',
        'hazid_assessment_types',
        'hazid_assessment_type_ppe',
        'hazid_assessment_type_questions',
        'hazid_assessment_type_apps',
        'hazid_assessments',
        'hazid_assessment_tasks',
        'hazid_assessment_hazards',
        'hazid_assessment_signatures',
        'hazid_assessment_ppe',
        'hazid_assessment_questions',
        'hazid_assessment_photos',
        'hazid_assessment_app_responses',
      ],
      errorText: 'HazID tenant/relation integrity preflight failed',
      firstDurableDdl: 'CREATE UNIQUE INDEX',
    })
  })

  it('makes the complete equipment preflight see every scanned tenant table', () => {
    expectVisiblePreflight({
      sql: migrations.equipment,
      expectedTables: [
        'tenant_users',
        'org_units',
        'people',
        'sync_connections',
        'equipment_categories',
        'equipment_types',
        'equipment_items',
        'equipment_location_history',
        'equipment_work_orders',
        'truck_log_entries',
        'equipment_log_entries',
        'equipment_inspection_types',
        'equipment_inspection_groups',
        'equipment_inspection_criteria',
        'equipment_inspection_records',
        'equipment_inspection_record_attachments',
        'equipment_inspection_record_criteria',
        'equipment_inspection_schedules',
        'equipment_reminders',
        'equipment_checkouts',
        'equipment_station_settings',
      ],
      errorText: 'Equipment tenant/relation integrity preflight failed',
      firstDurableDdl: 'CREATE UNIQUE INDEX',
    })
  })

  it('makes the document-version duplicate preflight see every tenant', () => {
    expectVisiblePreflight({
      sql: migrations.documentVersions,
      expectedTables: ['document_versions'],
      errorText: 'Document version uniqueness preflight failed',
      firstDurableDdl: 'DROP INDEX',
    })
  })

  it('makes the complete document relationship preflight see every tenant', () => {
    expectVisiblePreflight({
      sql: migrations.documents,
      expectedTables: [
        'tenant_users',
        'people',
        'documents',
        'document_versions',
        'document_acknowledgment_sessions',
        'document_acknowledgments',
        'document_books',
        'document_reviews',
        'document_types',
        'document_categories',
        'document_book_items',
        'document_assignments',
        'document_assignment_audience',
        'document_management_reviews',
      ],
      errorText: 'Document tenant/relation integrity preflight failed',
      firstDurableDdl: 'CREATE UNIQUE INDEX',
    })
  })

  it('snapshots equipment inspection behavior and preflights final constraints across tenants', () => {
    const sql = migrations.finalProductionInvariants
    expect(sql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(rlsTables(sql, 'relax')).toEqual([
      'custom_field_definitions',
      'equipment_inspection_criteria',
      'equipment_inspection_record_criteria',
      'equipment_inspection_records',
      'equipment_inspection_types',
      'inspection_record_attachments',
      'inspection_records',
    ])
    expect(rlsTables(sql, 'restore')).toEqual(rlsTables(sql, 'relax'))

    const lastRelaxAt = sql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const requiredColumnAt = sql.indexOf('ADD COLUMN "is_required"')
    const requiredBackfillAt = sql.indexOf('SET "is_required" = criterion."is_required"')
    const behaviorBackfillAt = sql.indexOf(
      'SET "interval_value" = inspection_type."interval_value"',
    )
    const duplicatePreflightAt = sql.indexOf('Inspection attachment cutover blocked')
    const lifecyclePreflightAt = sql.indexOf('Inspection lifecycle cutover blocked')
    const customFieldPreflightAt = sql.indexOf('Custom-field cutover blocked')
    const firstRestoreAt = sql.indexOf(
      'FORCE ROW LEVEL SECURITY',
      lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
    )
    const uniqueIndexAt = sql.indexOf(
      'CREATE UNIQUE INDEX "inspection_record_attachments_record_attachment_ux"',
    )
    const firstCheckAt = sql.indexOf('ADD CONSTRAINT "inspection_records_closed_locked_ck"')
    const firstValidateAt = sql.indexOf('VALIDATE CONSTRAINT "inspection_records_closed_locked_ck"')

    expect(requiredColumnAt).toBeGreaterThan(lastRelaxAt)
    expect(requiredBackfillAt).toBeGreaterThan(requiredColumnAt)
    expect(behaviorBackfillAt).toBeGreaterThan(requiredBackfillAt)
    expect(duplicatePreflightAt).toBeGreaterThan(behaviorBackfillAt)
    expect(lifecyclePreflightAt).toBeGreaterThan(duplicatePreflightAt)
    expect(customFieldPreflightAt).toBeGreaterThan(lifecyclePreflightAt)
    expect(firstRestoreAt).toBeGreaterThan(customFieldPreflightAt)
    expect(uniqueIndexAt).toBeGreaterThan(firstRestoreAt)
    expect(firstCheckAt).toBeGreaterThan(uniqueIndexAt)
    expect(sql.slice(firstCheckAt, firstValidateAt)).toContain('NOT VALID')
    expect(firstValidateAt).toBeGreaterThan(firstCheckAt)
  })
})
