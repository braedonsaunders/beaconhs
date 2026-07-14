import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const trainingHardeningSql = readProductionCutoverSection('0015_zippy_mac_gargan.sql')
const trainingCutoverSql = readProductionCutoverSection(
  '0028_unified_compliance_assignment_cutover.sql',
)
const migrationSql = [trainingHardeningSql, trainingCutoverSql].join('\n')

type TableConfig = ReturnType<typeof getTableConfig>
type DeleteAction = 'cascade' | 'no action' | 'restrict' | 'set null'

type ManifestRelationship = {
  relationName: string
  childTable: string
  childColumn: string
  parentTable: string
  constraintName: string
  legacyConstraint: string
  deleteAction: DeleteAction
}

const cascadeRelationships = [
  'training_assessment_results.tenant_id,assessment_id->training_assessments.tenant_id,id',
  'training_assessment_type_questions.tenant_id,type_id->training_assessment_types.tenant_id,id',
  'training_assessments.tenant_id,person_id->people.tenant_id,id',
  'training_certificates.tenant_id,record_id->training_records.tenant_id,id',
  'training_class_attendees.tenant_id,class_id->training_classes.tenant_id,id',
  'training_class_attendees.tenant_id,person_id->people.tenant_id,id',
  'training_classes.tenant_id,course_id->training_courses.tenant_id,id',
  'training_course_files.tenant_id,course_id->training_courses.tenant_id,id',
  'training_course_modules.tenant_id,course_id->training_courses.tenant_id,id',
  'training_enrollments.tenant_id,course_id->training_courses.tenant_id,id',
  'training_enrollments.tenant_id,person_id->people.tenant_id,id',
  'training_lesson_progress.tenant_id,enrollment_id->training_enrollments.tenant_id,id',
  'training_lesson_progress.tenant_id,lesson_id->training_lessons.tenant_id,id',
  'training_lesson_progress.tenant_id,person_id->people.tenant_id,id',
  'training_lessons.tenant_id,course_id->training_courses.tenant_id,id',
  'training_lessons.tenant_id,module_id->training_course_modules.tenant_id,id',
  'training_records.tenant_id,person_id->people.tenant_id,id',
  'training_skill_assignment_files.tenant_id,skill_assignment_id->training_skill_assignments.tenant_id,id',
  'training_skill_assignments.tenant_id,person_id->people.tenant_id,id',
  'training_skill_assignments.tenant_id,skill_type_id->training_skill_types.tenant_id,id',
  'training_skill_certificates.tenant_id,skill_assignment_id->training_skill_assignments.tenant_id,id',
  'training_skill_types.tenant_id,authority_id->training_skill_authorities.tenant_id,id',
] as const

const noActionRelationships = [
  'training_assessment_types.tenant_id,created_by_tenant_user_id->tenant_users.tenant_id,id',
  'training_assessments.tenant_id,submitted_by_tenant_user_id->tenant_users.tenant_id,id',
  'training_assessments.tenant_id,compliance_obligation_id->compliance_obligations.tenant_id,id',
  'training_classes.tenant_id,instructor_tenant_user_id->tenant_users.tenant_id,id',
  'training_classes.tenant_id,site_org_unit_id->org_units.tenant_id,id',
  'training_enrollments.tenant_id,assigned_by_tenant_user_id->tenant_users.tenant_id,id',
  'training_lesson_progress.tenant_id,evaluated_by_tenant_user_id->tenant_users.tenant_id,id',
  'training_records.tenant_id,class_id->training_classes.tenant_id,id',
  'training_records.tenant_id,course_id->training_courses.tenant_id,id',
  'training_records.tenant_id,evaluator_person_id->people.tenant_id,id',
  'training_records.tenant_id,issued_by_tenant_user_id->tenant_users.tenant_id,id',
  'training_skill_assignments.tenant_id,granted_by_tenant_user_id->tenant_users.tenant_id,id',
] as const

const retiredAssignmentTables = new Set([
  'training_audience_assignments',
  'training_audience_assignment_targets',
  'training_audience_assignment_records',
])

const restrictRelationships = [
  'training_assessment_results.tenant_id,question_id->training_assessment_type_questions.tenant_id,id',
  'training_assessments.tenant_id,type_id->training_assessment_types.tenant_id,id',
] as const

const partialSetNullRelationships = [
  'training_assessment_types.tenant_id,course_id->training_courses.tenant_id,id',
  'training_assessments.tenant_id,course_id->training_courses.tenant_id,id',
  'training_enrollments.tenant_id,record_id->training_records.tenant_id,id',
  'training_lesson_progress.tenant_id,assessment_id->training_assessments.tenant_id,id',
  'training_lessons.tenant_id,assessment_type_id->training_assessment_types.tenant_id,id',
  'training_lessons.tenant_id,class_id->training_classes.tenant_id,id',
] as const

function allTableConfigs(): TableConfig[] {
  const byName = new Map<string, TableConfig>()
  for (const value of Object.values(schema)) {
    if (!value || typeof value !== 'object') continue
    try {
      const config = getTableConfig(value as Parameters<typeof getTableConfig>[0])
      if (config.name && config.columns.length > 0) byName.set(config.name, config)
    } catch {
      // enums, relations, and type-only exports are not tables
    }
  }
  return [...byName.values()]
}

function manifestRelationships(): ManifestRelationship[] {
  const relationships = [
    ...migrationSql.matchAll(
      /^\s+\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '(cascade|no action|restrict|set null)'\)[,;](?:-->.*)?$/gm,
    ),
  ].map((match) => ({
    relationName: match[1]!,
    childTable: match[2]!,
    childColumn: match[3]!,
    parentTable: match[4]!,
    constraintName: match[5]!,
    legacyConstraint: match[6]!,
    deleteAction: match[7]! as DeleteAction,
  }))
  // The squashed source still describes the tables that existed before the
  // clean-cutover drop. Only relationships between live schema tables belong
  // in the post-cutover contract below.
  return relationships.filter(
    ({ childTable, parentTable }) =>
      !retiredAssignmentTables.has(childTable) && !retiredAssignmentTables.has(parentTable),
  )
}

function signature(input: { childTable: string; childColumn: string; parentTable: string }) {
  return `${input.childTable}.tenant_id,${input.childColumn}->${input.parentTable}.tenant_id,id`
}

function foreignKeys(table: TableConfig): Map<string, Exclude<DeleteAction, 'set null'>> {
  return new Map(
    table.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference()
      return [
        `${table.name}.${reference.columns.map((column) => column.name).join(',')}->${getTableConfig(reference.foreignTable).name}.${reference.foreignColumns.map((column) => column.name).join(',')}`,
        (foreignKey.onDelete ?? 'no action') as Exclude<DeleteAction, 'set null'>,
      ]
    }),
  )
}

function hasIndexPrefix(table: TableConfig, columns: string[]) {
  return table.indexes.some((index) =>
    columns.every((column, position) => {
      const candidate = index.config.columns[position]
      return candidate && 'name' in candidate && candidate.name === column
    }),
  )
}

describe('training relational integrity', () => {
  it('keeps the complete 42-edge post-cutover relationship contract explicit and stable', () => {
    const relationships = manifestRelationships()
    expect(relationships).toHaveLength(42)
    expect(new Set(relationships.map(({ relationName }) => relationName)).size).toBe(42)
    expect(new Set(relationships.map(({ constraintName }) => constraintName)).size).toBe(42)
    expect(new Set(relationships.map(({ legacyConstraint }) => legacyConstraint)).size).toBe(42)
    expect(
      new Set(relationships.map(({ legacyConstraint }) => legacyConstraint.slice(0, 63))).size,
    ).toBe(42)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'cascade')).toHaveLength(22)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'no action')).toHaveLength(
      12,
    )
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'restrict')).toHaveLength(2)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'set null')).toHaveLength(6)

    const expected = [
      ...cascadeRelationships.map((value) => `${value}|cascade`),
      ...noActionRelationships.map((value) => `${value}|no action`),
      ...restrictRelationships.map((value) => `${value}|restrict`),
      ...partialSetNullRelationships.map((value) => `${value}|set null`),
    ].sort()
    expect(
      relationships
        .map((relationship) => `${signature(relationship)}|${relationship.deleteAction}`)
        .sort(),
    ).toEqual(expected)

    for (const relationship of relationships) {
      expect(relationship.constraintName.length, relationship.constraintName).toBeLessThanOrEqual(
        63,
      )
    }
  })

  it('models every relationship with a tenant-aware schema key and child index', () => {
    const tables = new Map(allTableConfigs().map((table) => [table.name, table]))
    for (const relationship of manifestRelationships()) {
      const relationshipSignature = signature(relationship)
      const child = tables.get(relationship.childTable)!
      const schemaDeleteAction =
        relationship.deleteAction === 'set null' ? 'no action' : relationship.deleteAction
      expect(foreignKeys(child).get(relationshipSignature), relationshipSignature).toBe(
        schemaDeleteAction,
      )
      expect(
        hasIndexPrefix(child, ['tenant_id', relationship.childColumn]),
        `${relationshipSignature} child index`,
      ).toBe(true)
    }
  })

  it('backs every composite parent with an exact tenant/id unique key', () => {
    const tables = new Map(allTableConfigs().map((table) => [table.name, table]))
    for (const tableName of new Set(
      manifestRelationships().map((relationship) => relationship.parentTable),
    )) {
      const uniqueKeys = tables
        .get(tableName)!
        .indexes.filter((index) => index.config.unique)
        .map((index) => index.config.columns.map((column) => ('name' in column ? column.name : '')))
      expect(uniqueKeys, tableName).toContainEqual(['tenant_id', 'id'])
    }
  })

  it('leaves no single-column training FK to another tenant-owned table', () => {
    const tables = allTableConfigs()
    const tenantTables = new Set(
      tables
        .filter((table) => table.columns.some((column) => column.name === 'tenant_id'))
        .map((table) => table.name),
    )
    const residual: string[] = []

    for (const table of tables.filter((candidate) => candidate.name.startsWith('training_'))) {
      for (const foreignKey of table.foreignKeys) {
        const reference = foreignKey.reference()
        const parentName = getTableConfig(reference.foreignTable).name
        if (
          tenantTables.has(parentName) &&
          !reference.columns.some((column) => column.name === 'tenant_id')
        ) {
          residual.push(
            `${table.name}.${reference.columns.map((column) => column.name).join(',')}->${parentName}`,
          )
        }
      }
    }
    expect(residual).toEqual([])
  })

  it('preserves partial SET NULL without clearing tenant ownership', () => {
    expect(trainingHardeningSql).toContain("WHEN 'set null' THEN format('SET NULL (%I)'")
    expect(trainingHardeningSql).toContain("WHEN 'restrict' THEN 'RESTRICT'")
    for (const relationship of partialSetNullRelationships) {
      const businessColumn = relationship.split('->')[0]!.split('.')[1]!.split(',')[1]!
      expect(trainingHardeningSql).toContain(`SET NULL (%I)', relationship."child_column"`)
      expect(businessColumn).not.toBe('tenant_id')
    }
  })

  it('preflights every tenant and validates replacements before retiring legacy keys', () => {
    expect(trainingHardeningSql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(trainingHardeningSql).toContain('Training tenant/relation integrity preflight failed')
    expect(trainingHardeningSql).toContain(
      'parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I',
    )

    const relaxed = [
      ...trainingHardeningSql.matchAll(/^ALTER TABLE "([^"]+)" NO FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    const restored = [
      ...trainingHardeningSql.matchAll(/^ALTER TABLE "([^"]+)" FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    expect(relaxed).toHaveLength(26)
    expect(restored).toEqual(relaxed)

    const lastRelaxAt = trainingHardeningSql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const errorAt = trainingHardeningSql.indexOf(
      'Training tenant/relation integrity preflight failed',
    )
    const firstRestoreAt = trainingHardeningSql.indexOf(
      'FORCE ROW LEVEL SECURITY',
      lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
    )
    const parentKeysAt = trainingHardeningSql.indexOf('CREATE UNIQUE INDEX')
    const addAt = trainingHardeningSql.indexOf('ADD CONSTRAINT %I FOREIGN KEY')
    const validateAt = trainingHardeningSql.indexOf('VALIDATE CONSTRAINT %I')
    const legacyDropAt = trainingHardeningSql.indexOf('left(relationship."legacy_constraint", 63)')
    expect(errorAt).toBeGreaterThan(lastRelaxAt)
    expect(firstRestoreAt).toBeGreaterThan(errorAt)
    expect(parentKeysAt).toBeGreaterThan(firstRestoreAt)
    expect(addAt).toBeGreaterThan(parentKeysAt)
    expect(trainingHardeningSql.slice(addAt, validateAt)).toContain('NOT VALID')
    expect(validateAt).toBeGreaterThan(addAt)
    expect(legacyDropAt).toBeGreaterThan(validateAt)
  })
})
