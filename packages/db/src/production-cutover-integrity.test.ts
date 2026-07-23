import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const drizzleFolder = new URL('../drizzle/', import.meta.url)
const metaFolder = new URL('../drizzle/meta/', import.meta.url)
const cutoverSql = readFileSync(new URL('0005_production_cutover.sql', drizzleFolder), 'utf8')
const finalSection = readProductionCutoverSection('0023_flaky_squirrel_girl.sql')
const languageSection = readFileSync(
  new URL('0006_tenant_language_policy.sql', drizzleFolder),
  'utf8',
)
const assessmentReviewSql = readFileSync(new URL('0017_wakeful_jackal.sql', drizzleFolder), 'utf8')
const assessmentHistorySql = readFileSync(
  new URL('0021_training_assessment_history.sql', drizzleFolder),
  'utf8',
)
const assessmentChoiceSnapshotSql = readFileSync(
  new URL('0023_gorgeous_sheva_callister.sql', drizzleFolder),
  'utf8',
)
const reportCutoverSql = readFileSync(new URL('0024_flawless_la_nuit.sql', drizzleFolder), 'utf8')

function position(fragment: string): number {
  const value = finalSection.indexOf(fragment)
  expect(value, fragment).toBeGreaterThan(-1)
  return value
}

describe('production cutover migration integrity', () => {
  it('keeps a linear post-baseline migration and snapshot chain', () => {
    const migrations = readdirSync(drizzleFolder)
      .filter((name) => name.endsWith('.sql'))
      .sort()
    expect(migrations).toEqual([
      '0000_init.sql',
      '0001_migration_cutover.sql',
      '0002_drop_retired_plugin_tables.sql',
      '0003_converge_dev_schema.sql',
      '0004_flawless_boomer.sql',
      '0005_production_cutover.sql',
      '0006_tenant_language_policy.sql',
      '0007_compliance_scan_toggle.sql',
      '0008_hazid_review_conditions_signatures.sql',
      '0009_early_longshot.sql',
      '0010_lush_sue_storm.sql',
      '0011_calm_talkback.sql',
      '0012_orange_violations.sql',
      '0013_remarkable_mimic.sql',
      '0014_military_major_mapleleaf.sql',
      '0015_deep_scalphunter.sql',
      '0016_smiling_thunderbolts.sql',
      '0017_wakeful_jackal.sql',
      '0018_training_report_parity.sql',
      '0019_report_parity_cutover.sql',
      '0020_inspection_location_storage.sql',
      '0021_training_assessment_history.sql',
      '0022_hazid_submit_trigger_cutover.sql',
      '0023_gorgeous_sheva_callister.sql',
      '0024_flawless_la_nuit.sql',
      '0025_unify_builder_photo_fields.sql',
    ])

    const journal = JSON.parse(readFileSync(new URL('_journal.json', metaFolder), 'utf8')) as {
      entries: Array<{ idx: number; tag: string; when: number }>
    }
    expect(journal.entries.map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      { idx: 0, tag: '0000_init' },
      { idx: 1, tag: '0001_migration_cutover' },
      { idx: 2, tag: '0002_drop_retired_plugin_tables' },
      { idx: 3, tag: '0003_converge_dev_schema' },
      { idx: 4, tag: '0004_flawless_boomer' },
      { idx: 5, tag: '0005_production_cutover' },
      { idx: 6, tag: '0006_tenant_language_policy' },
      { idx: 7, tag: '0007_compliance_scan_toggle' },
      { idx: 8, tag: '0008_hazid_review_conditions_signatures' },
      { idx: 9, tag: '0009_early_longshot' },
      { idx: 10, tag: '0010_lush_sue_storm' },
      { idx: 11, tag: '0011_calm_talkback' },
      { idx: 12, tag: '0012_orange_violations' },
      { idx: 13, tag: '0013_remarkable_mimic' },
      { idx: 14, tag: '0014_military_major_mapleleaf' },
      { idx: 15, tag: '0015_deep_scalphunter' },
      { idx: 16, tag: '0016_smiling_thunderbolts' },
      { idx: 17, tag: '0017_wakeful_jackal' },
      { idx: 18, tag: '0018_training_report_parity' },
      { idx: 19, tag: '0019_report_parity_cutover' },
      { idx: 20, tag: '0020_inspection_location_storage' },
      { idx: 21, tag: '0021_training_assessment_history' },
      { idx: 22, tag: '0022_hazid_submit_trigger_cutover' },
      { idx: 23, tag: '0023_gorgeous_sheva_callister' },
      { idx: 24, tag: '0024_flawless_la_nuit' },
      { idx: 25, tag: '0025_unify_builder_photo_fields' },
    ])
    for (let index = 1; index < journal.entries.length; index++) {
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when)
    }

    const snapshots = [
      4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    ].map(
      (index) =>
        JSON.parse(
          readFileSync(
            new URL(`${String(index).padStart(4, '0')}_snapshot.json`, metaFolder),
            'utf8',
          ),
        ) as { id: string; prevId: string },
    )
    for (let index = 1; index < snapshots.length; index++) {
      expect(snapshots[index]!.prevId).toBe(snapshots[index - 1]!.id)
      expect(snapshots[index]!.id).not.toBe(snapshots[index]!.prevId)
    }
    expect([...cutoverSql.matchAll(/^-- Squashed source:/gm)]).toHaveLength(30)
  })

  it('normalizes completion-only assessment history during the review cutover', () => {
    expect(assessmentReviewSql).toContain('AND assessment."graded" = false')
    expect(assessmentReviewSql).toContain("'Assessment completion'")
    expect(assessmentReviewSql).toContain('SET "training_record_id" = record."id"')
    expect(assessmentReviewSql).toContain('SET "score" = NULL')
    expect(assessmentReviewSql).toContain('"passed" = true')
  })

  it('repairs imported assessment lifecycle timestamps without inventing completions', () => {
    expect(assessmentHistorySql).toContain(
      'ALTER TABLE "training_assessments" NO FORCE ROW LEVEL SECURITY',
    )
    expect(assessmentHistorySql).toContain(`WHERE "status" = 'cancelled'`)
    expect(assessmentHistorySql).toContain('SET "completed_at" = NULL')
    expect(assessmentHistorySql).toContain('SET "completed_at" = GREATEST')
    expect(assessmentHistorySql).toContain(`"notes" LIKE 'Migrated legacy quiz attempt.%'`)
    expect(assessmentHistorySql).toContain(
      'ALTER TABLE "training_assessments" FORCE ROW LEVEL SECURITY',
    )
  })

  it('repairs and enforces complete choice snapshots for assessment attempts', () => {
    expect(assessmentChoiceSnapshotSql).toContain('UPDATE "training_assessment_results" AS result')
    expect(assessmentChoiceSnapshotSql).toContain('THEN question."options"')
    expect(assessmentChoiceSnapshotSql).toContain(
      "'assessment choice snapshot cutover blocked: % invalid template(s), % invalid snapshot(s)'",
    )
    expect(assessmentChoiceSnapshotSql).toContain(
      'ADD CONSTRAINT "training_assessment_results_choice_options_snapshot_ck"',
    )
    expect(assessmentChoiceSnapshotSql).toContain(
      'VALIDATE CONSTRAINT "training_assessment_results_choice_options_snapshot_ck"',
    )
    expect(assessmentChoiceSnapshotSql).toContain(
      'ALTER TABLE "training_assessment_results" FORCE ROW LEVEL SECURITY',
    )
  })

  it('clearcuts split report definitions into tenant-owned AppKit definitions', () => {
    expect(reportCutoverSql).toContain(
      'ALTER TABLE "report_definitions" RENAME COLUMN "custom_query" TO "query"',
    )
    expect(reportCutoverSql).toContain('CROSS JOIN seeds AS seed')
    expect(reportCutoverSql).toContain(
      'AppKit report cutover blocked: % schedule(s) still reference a global definition',
    )
    expect(reportCutoverSql).toContain('SET "filters" = \'{}\'::jsonb')
    expect(reportCutoverSql).toContain('ALTER TABLE "report_definitions" DROP COLUMN "kind"')
    expect(reportCutoverSql).toContain('ALTER TABLE "report_definitions" DROP COLUMN "query_kind"')
    expect(reportCutoverSql).toContain('ADD CONSTRAINT "report_schedules_tenant_definition_fk"')
    expect(reportCutoverSql).toContain('ALTER TABLE "report_definitions" FORCE ROW LEVEL SECURITY')
    expect(reportCutoverSql).toContain('ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY')
  })

  it('preflights and backfills training owners before removing legacy columns', () => {
    const relax = position('ALTER TABLE "corrective_actions" NO FORCE ROW LEVEL SECURITY')
    const orphanPreflight = position('training additional-field cutover blocked: % row(s)')
    const duplicatePreflight = position(
      'training additional-field cutover blocked: % owner/key group(s)',
    )
    const restore = position('ALTER TABLE "corrective_actions" FORCE ROW LEVEL SECURITY')
    const addColumn = position(
      'ALTER TABLE "training_extra_fields" ADD COLUMN "skill_assignment_id" uuid',
    )
    const backfill = position('SET "skill_assignment_id" = "owner_id"')
    const addForeignKey = position(
      'ADD CONSTRAINT "training_extra_fields_tenant_skill_assignment_fk"',
    )
    const validateForeignKey = position(
      'VALIDATE CONSTRAINT "training_extra_fields_tenant_skill_assignment_fk"',
    )
    const addCheck = position('ADD CONSTRAINT "training_extra_fields_exactly_one_owner_ck"')
    const validateCheck = position(
      'VALIDATE CONSTRAINT "training_extra_fields_exactly_one_owner_ck"',
    )
    const dropOwnerType = position('ALTER TABLE "training_extra_fields" DROP COLUMN "owner_type"')

    const orderedPositions = [
      relax,
      orphanPreflight,
      duplicatePreflight,
      addColumn,
      backfill,
      addForeignKey,
      validateForeignKey,
      addCheck,
      validateCheck,
      dropOwnerType,
      restore,
    ]
    expect(orderedPositions).toEqual([...orderedPositions].sort((left, right) => left - right))
  })

  it('fails closed on relational and business-key conflicts before adding constraints', () => {
    const relax = position('ALTER TABLE "corrective_actions" NO FORCE ROW LEVEL SECURITY')
    const correctivePreflight = position('corrective_actions source response cutover blocked')
    const restore = position('ALTER TABLE "corrective_actions" FORCE ROW LEVEL SECURITY')
    const correctiveForeignKey = position(
      'ADD CONSTRAINT "corrective_actions_tenant_source_response_fk"',
    )
    const documentPreflight = position('document key cutover blocked')
    const documentUniqueIndex = position('CREATE UNIQUE INDEX "documents_tenant_key_live_ux"')

    expect(relax).toBeLessThan(correctivePreflight)
    expect(correctivePreflight).toBeLessThan(correctiveForeignKey)
    expect(correctiveForeignKey).toBeLessThan(restore)
    expect(relax).toBeLessThan(documentPreflight)
    expect(documentPreflight).toBeLessThan(documentUniqueIndex)
    expect(documentUniqueIndex).toBeLessThan(restore)
  })

  it('keeps every final preflight table visible through owner-role backfills, then restores FORCE RLS', () => {
    const expectedTables = [
      'corrective_actions',
      'documents',
      'form_responses',
      'training_extra_fields',
      'training_skill_assignments',
      'training_skill_authorities',
      'training_skill_types',
    ]
    const relaxed = [
      ...finalSection.matchAll(/^ALTER TABLE "([^"]+)" NO FORCE ROW LEVEL SECURITY;/gm),
    ]
      .map((match) => match[1]!)
      .sort()
    const restored = [
      ...finalSection.matchAll(/^ALTER TABLE "([^"]+)" FORCE ROW LEVEL SECURITY;/gm),
    ]
      .map((match) => match[1]!)
      .sort()

    expect(relaxed).toEqual(expectedTables)
    expect(restored).toEqual(expectedTables)
    const firstRestore = finalSection.indexOf(
      'ALTER TABLE "corrective_actions" FORCE ROW LEVEL SECURITY',
    )
    expect(firstRestore).toBeGreaterThan(
      finalSection.indexOf('training additional-field cutover blocked'),
    )
    expect(firstRestore).toBeGreaterThan(
      finalSection.indexOf('SET "skill_assignment_id" = "owner_id"'),
    )
    expect(firstRestore).toBeGreaterThan(
      finalSection.indexOf('ALTER TABLE "training_extra_fields" DROP COLUMN "owner_id"'),
    )
    expect(firstRestore).toBeGreaterThan(finalSection.indexOf('DROP INDEX "documents_key_idx"'))
  })

  it('moves language preferences to tenant memberships without bypassing forced RLS', () => {
    function localePosition(fragment: string): number {
      const value = languageSection.indexOf(fragment)
      expect(value, fragment).toBeGreaterThan(-1)
      return value
    }

    const addOverride = localePosition(
      'ALTER TABLE "tenant_users" ADD COLUMN "locale_override" text',
    )
    const relaxMemberships = localePosition(
      'ALTER TABLE "tenant_users" NO FORCE ROW LEVEL SECURITY',
    )
    const relaxTenants = localePosition('ALTER TABLE "tenants" NO FORCE ROW LEVEL SECURITY')
    const normalizePolicy = localePosition('SET "enabled_languages" = COALESCE')
    const backfillOverride = localePosition('SET "locale_override" = identity."locale"')
    const dropGlobalLocale = localePosition('ALTER TABLE "user" DROP COLUMN "locale"')
    const restoreMemberships = localePosition('ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY')
    const restoreTenants = localePosition('ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY')
    const addMembershipConstraint = localePosition(
      'ADD CONSTRAINT "tenant_users_locale_override_supported_check"',
    )
    const addTenantConstraint = localePosition(
      'ADD CONSTRAINT "tenants_enabled_languages_valid_check"',
    )

    const orderedPositions = [
      addOverride,
      relaxMemberships,
      relaxTenants,
      normalizePolicy,
      backfillOverride,
      dropGlobalLocale,
      restoreMemberships,
      restoreTenants,
      addMembershipConstraint,
      addTenantConstraint,
    ]
    expect(orderedPositions).toEqual([...orderedPositions].sort((left, right) => left - right))
  })
})
