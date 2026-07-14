import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  hazidAssessmentAppResponses,
  hazidAssessmentHazards,
  hazidAssessmentPhotos,
  hazidAssessmentPPE,
  hazidAssessmentQuestions,
  hazidAssessmentSignatures,
  hazidAssessmentTasks,
  hazidAssessments,
  hazidAssessmentTypeApps,
  hazidAssessmentTypePPE,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypes,
  hazidHazards,
  hazidHazardSets,
  hazidHazardTypes,
  hazidLocationTasks,
  hazidTasks,
} from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0008_fast_warbound.sql')

type Table = Parameters<typeof getTableConfig>[0]

const tables = [
  hazidAssessmentAppResponses,
  hazidAssessmentHazards,
  hazidAssessmentPhotos,
  hazidAssessmentPPE,
  hazidAssessmentQuestions,
  hazidAssessmentSignatures,
  hazidAssessmentTasks,
  hazidAssessments,
  hazidAssessmentTypeApps,
  hazidAssessmentTypePPE,
  hazidAssessmentTypeQuestions,
  hazidAssessmentTypes,
  hazidHazards,
  hazidHazardSets,
  hazidHazardTypes,
  hazidLocationTasks,
  hazidTasks,
] as const

const schemaRelationships = [
  {
    child: hazidAssessmentAppResponses,
    key: 'tenant_id,assessment_id->hazid_assessments.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    child: hazidAssessmentHazards,
    key: 'tenant_id,assessment_id->hazid_assessments.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    child: hazidAssessmentPhotos,
    key: 'tenant_id,assessment_id->hazid_assessments.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    child: hazidAssessmentPPE,
    key: 'tenant_id,assessment_id->hazid_assessments.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    child: hazidAssessmentQuestions,
    key: 'tenant_id,assessment_id->hazid_assessments.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    child: hazidAssessmentSignatures,
    key: 'tenant_id,assessment_id->hazid_assessments.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    child: hazidAssessmentTasks,
    key: 'tenant_id,assessment_id->hazid_assessments.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    child: hazidAssessmentTypeApps,
    key: 'tenant_id,type_id->hazid_assessment_types.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    child: hazidAssessmentTypePPE,
    key: 'tenant_id,type_id->hazid_assessment_types.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    child: hazidAssessmentTypeQuestions,
    key: 'tenant_id,type_id->hazid_assessment_types.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    child: hazidAssessments,
    key: 'tenant_id,locked_by_tenant_user_id->tenant_users.tenant_id,id',
    onDelete: 'no action',
  },
  {
    child: hazidLocationTasks,
    key: 'tenant_id,org_unit_id->org_units.tenant_id,id',
    onDelete: 'cascade',
  },
  {
    child: hazidLocationTasks,
    key: 'tenant_id,task_id->hazid_tasks.tenant_id,id',
    onDelete: 'cascade',
  },
] as const

const partialSetNullRelationships = [
  {
    table: 'hazid_assessment_types',
    column: 'default_hazard_set_id',
    parent: 'hazid_hazard_sets',
    constraint: 'hazid_assessment_types_tenant_default_hazard_set_fk',
    legacy: 'hazid_assessment_types_default_hazard_set_id_hazid_hazard_sets_id_fk',
    preflight: 'hazid_assessment_types.default_hazard_set',
  },
  {
    table: 'hazid_hazards',
    column: 'hazard_type_id',
    parent: 'hazid_hazard_types',
    constraint: 'hazid_hazards_tenant_hazard_type_fk',
    legacy: 'hazid_hazards_hazard_type_id_hazid_hazard_types_id_fk',
    preflight: 'hazid_hazards.hazard_type',
  },
  {
    table: 'hazid_assessment_hazards',
    column: 'hazard_id',
    parent: 'hazid_hazards',
    constraint: 'hazid_assessment_hazards_tenant_hazard_fk',
    legacy: 'hazid_assessment_hazards_hazard_id_hazid_hazards_id_fk',
    preflight: 'hazid_assessment_hazards.hazard',
  },
  {
    table: 'hazid_assessment_signatures',
    column: 'person_id',
    parent: 'people',
    constraint: 'hazid_assessment_signatures_tenant_person_fk',
    legacy: 'hazid_assessment_signatures_person_id_people_id_fk',
    preflight: 'hazid_assessment_signatures.person',
  },
  {
    table: 'hazid_assessment_tasks',
    column: 'task_id',
    parent: 'hazid_tasks',
    constraint: 'hazid_assessment_tasks_tenant_task_fk',
    legacy: 'hazid_assessment_tasks_task_id_hazid_tasks_id_fk',
    preflight: 'hazid_assessment_tasks.task',
  },
  {
    table: 'hazid_assessments',
    column: 'site_org_unit_id',
    parent: 'org_units',
    constraint: 'hazid_assessments_tenant_site_org_unit_fk',
    legacy: 'hazid_assessments_site_org_unit_id_org_units_id_fk',
    preflight: 'hazid_assessments.site_org_unit',
  },
  {
    table: 'hazid_assessments',
    column: 'project_org_unit_id',
    parent: 'org_units',
    constraint: 'hazid_assessments_tenant_project_org_unit_fk',
    legacy: 'hazid_assessments_project_org_unit_id_org_units_id_fk',
    preflight: 'hazid_assessments.project_org_unit',
  },
  {
    table: 'hazid_assessments',
    column: 'supervisor_tenant_user_id',
    parent: 'tenant_users',
    constraint: 'hazid_assessments_tenant_supervisor_user_fk',
    legacy: 'hazid_assessments_supervisor_tenant_user_id_tenant_users_id_fk',
    preflight: 'hazid_assessments.supervisor_tenant_user',
  },
  {
    table: 'hazid_assessments',
    column: 'supervisor_person_id',
    parent: 'people',
    constraint: 'hazid_assessments_tenant_supervisor_person_fk',
    legacy: 'hazid_assessments_supervisor_person_id_people_id_fk',
    preflight: 'hazid_assessments.supervisor_person',
  },
  {
    table: 'hazid_assessments',
    column: 'reported_by_tenant_user_id',
    parent: 'tenant_users',
    constraint: 'hazid_assessments_tenant_reported_by_user_fk',
    legacy: 'hazid_assessments_reported_by_tenant_user_id_tenant_users_id_fk',
    preflight: 'hazid_assessments.reported_by_tenant_user',
  },
  {
    table: 'hazid_assessments',
    column: 'assessment_type_id',
    parent: 'hazid_assessment_types',
    constraint: 'hazid_assessments_tenant_assessment_type_fk',
    legacy: 'hazid_assessments_assessment_type_id_hazid_assessment_types_id_fk',
    preflight: 'hazid_assessments.assessment_type',
  },
] as const

function foreignKeys(table: Table): Map<string, string> {
  return new Map(
    getTableConfig(table).foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference()
      const parent = getTableConfig(reference.foreignTable).name
      const localColumns = reference.columns.map((column) => column.name).join(',')
      const parentColumns = reference.foreignColumns.map((column) => column.name).join(',')
      return [`${localColumns}->${parent}.${parentColumns}`, foreignKey.onDelete ?? 'no action']
    }),
  )
}

function hasIndexPrefix(table: Table, columns: string[]): boolean {
  return getTableConfig(table).indexes.some((index) =>
    columns.every((column, position) => {
      const candidate = index.config.columns[position]
      return candidate && 'name' in candidate && candidate.name === column
    }),
  )
}

describe('HazID relational integrity', () => {
  it('models every non-SET-NULL tenant relationship as a composite foreign key', () => {
    for (const relationship of schemaRelationships) {
      expect(foreignKeys(relationship.child).get(relationship.key), relationship.key).toBe(
        relationship.onDelete,
      )
      const localColumns = relationship.key.split('->')[0]!.split(',')
      expect(hasIndexPrefix(relationship.child, localColumns), `${relationship.key} index`).toBe(
        true,
      )
    }

    for (const table of tables) {
      for (const key of foreignKeys(table).keys()) {
        if (
          !key.includes('->hazid_') &&
          !key.includes('->org_units.') &&
          !key.includes('->people.')
        ) {
          continue
        }
        expect(key, `${getTableConfig(table).name}.${key}`).not.toMatch(/^[^,]+->/)
      }
    }
  })

  it('backs every HazID composite parent key with an exact unique index', () => {
    for (const table of [
      hazidAssessments,
      hazidAssessmentTypes,
      hazidHazardSets,
      hazidHazardTypes,
      hazidHazards,
      hazidTasks,
    ]) {
      const uniqueKeys = getTableConfig(table)
        .indexes.filter((index) => index.config.unique)
        .map((index) => index.config.columns.map((column) => ('name' in column ? column.name : '')))
      expect(uniqueKeys, getTableConfig(table).name).toContainEqual(['tenant_id', 'id'])
    }
  })

  it('preserves every nullable relationship with tenant-safe partial SET NULL', () => {
    for (const relationship of partialSetNullRelationships) {
      expect(relationship.constraint.length, relationship.constraint).toBeLessThanOrEqual(63)
      expect(migrationSql).toContain(
        `ALTER TABLE "${relationship.table}" ADD CONSTRAINT "${relationship.constraint}" FOREIGN KEY ("tenant_id","${relationship.column}") REFERENCES "public"."${relationship.parent}"("tenant_id","id") ON DELETE SET NULL ("${relationship.column}") ON UPDATE no action NOT VALID`,
      )
      expect(migrationSql).toContain(`VALIDATE CONSTRAINT "${relationship.constraint}"`)
      expect(migrationSql).toContain(relationship.preflight)

      const validateAt = migrationSql.indexOf(`VALIDATE CONSTRAINT "${relationship.constraint}"`)
      const legacyDropAt = migrationSql.indexOf(`DROP CONSTRAINT "${relationship.legacy}"`)
      expect(validateAt, relationship.constraint).toBeGreaterThanOrEqual(0)
      expect(legacyDropAt, relationship.legacy).toBeGreaterThan(validateAt)
    }
  })

  it('fails closed and validates every stronger key before dropping legacy keys', () => {
    expect(migrationSql).toContain('HazID tenant/relation integrity preflight failed')
    expect(migrationSql).toContain('parent."id" IS NULL')
    expect(migrationSql).toContain('child."tenant_id" IS DISTINCT FROM parent."tenant_id"')
    expect(migrationSql).not.toContain('content_json')
    const preflightAt = migrationSql.indexOf('HazID tenant/relation integrity preflight failed')

    const added = migrationSql.match(/ ADD CONSTRAINT /g) ?? []
    const validated = migrationSql.match(/ VALIDATE CONSTRAINT /g) ?? []
    const dropped = migrationSql.match(/ DROP CONSTRAINT /g) ?? []
    expect(added).toHaveLength(24)
    expect(validated).toHaveLength(24)
    expect(dropped).toHaveLength(24)

    const relaxedTables = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" NO FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1])
    const restoredTables = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1])
    expect(relaxedTables).toHaveLength(20)
    expect(restoredTables).toEqual(relaxedTables)

    const preflightBlockAt = migrationSql.indexOf('DO $$')
    const lastRelaxAt = migrationSql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const firstRestoreAt = migrationSql.indexOf(
      'FORCE ROW LEVEL SECURITY',
      lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
    )
    const firstDurableDdlAt = migrationSql.indexOf('CREATE UNIQUE INDEX')
    expect(lastRelaxAt).toBeLessThan(preflightBlockAt)
    expect(firstRestoreAt).toBeGreaterThan(preflightAt)
    expect(firstDurableDdlAt).toBeGreaterThan(firstRestoreAt)

    for (const statement of migrationSql.match(/ALTER TABLE .* ADD CONSTRAINT .*?;/g) ?? []) {
      expect(statement).toContain('NOT VALID')
    }

    const firstLegacyDropAt = migrationSql.indexOf(' DROP CONSTRAINT ')
    const lastValidationAt = migrationSql.lastIndexOf(' VALIDATE CONSTRAINT ')
    expect(firstDurableDdlAt).toBeGreaterThan(preflightAt)
    expect(firstLegacyDropAt).toBeGreaterThan(lastValidationAt)
  })
})
