import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  normalizeRelation,
} from 'drizzle-orm/relations'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0018_organic_madame_web.sql')

type TableConfig = ReturnType<typeof getTableConfig>
type DeleteAction = 'cascade' | 'no action' | 'set null'

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
  'ppe_annual_records.tenant_id,item_id->ppe_items.tenant_id,id',
  'ppe_criteria_bank_criteria.tenant_id,bank_id->ppe_criteria_banks.tenant_id,id',
  'ppe_inspection_attachments.tenant_id,criterion_result_id->ppe_inspection_criteria.tenant_id,id',
  'ppe_inspection_attachments.tenant_id,inspection_id->ppe_inspections.tenant_id,id',
  'ppe_inspection_criteria.tenant_id,inspection_id->ppe_inspections.tenant_id,id',
  'ppe_inspections.tenant_id,item_id->ppe_items.tenant_id,id',
  'ppe_issue_reports.tenant_id,item_id->ppe_items.tenant_id,id',
  'ppe_issues.tenant_id,item_id->ppe_items.tenant_id,id',
  'ppe_type_criteria_groups.tenant_id,ppe_type_id->ppe_types.tenant_id,id',
  'ppe_type_inspection_criteria.tenant_id,ppe_type_id->ppe_types.tenant_id,id',
] as const

const noActionRelationships = [
  'ppe_annual_records.tenant_id,inspected_by_person_id->people.tenant_id,id',
  'ppe_inspections.tenant_id,inspected_by_tenant_user_id->tenant_users.tenant_id,id',
  'ppe_issue_reports.tenant_id,inspection_id->ppe_inspections.tenant_id,id',
  'ppe_issue_reports.tenant_id,reported_by_tenant_user_id->tenant_users.tenant_id,id',
  'ppe_issues.tenant_id,issued_by_tenant_user_id->tenant_users.tenant_id,id',
  'ppe_issues.tenant_id,person_id->people.tenant_id,id',
  'ppe_items.tenant_id,current_holder_person_id->people.tenant_id,id',
  'ppe_items.tenant_id,type_id->ppe_types.tenant_id,id',
] as const

const partialSetNullRelationships = [
  'ppe_type_inspection_criteria.tenant_id,group_id->ppe_type_criteria_groups.tenant_id,id',
] as const

const domainTables = new Set([
  'ppe_annual_records',
  'ppe_criteria_bank_criteria',
  'ppe_criteria_banks',
  'ppe_inspection_attachments',
  'ppe_inspection_criteria',
  'ppe_inspections',
  'ppe_issue_reports',
  'ppe_issues',
  'ppe_items',
  'ppe_type_criteria_groups',
  'ppe_type_inspection_criteria',
  'ppe_types',
])

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
  return [
    ...migrationSql.matchAll(
      /^\s+\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '(cascade|no action|set null)'\)[,;](?:-->.*)?$/gm,
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

describe('PPE relational integrity', () => {
  it('keeps the complete 19-edge physical manifest explicit and stable', () => {
    const relationships = manifestRelationships()
    expect(relationships).toHaveLength(19)
    expect(new Set(relationships.map(({ relationName }) => relationName)).size).toBe(19)
    expect(new Set(relationships.map(({ constraintName }) => constraintName)).size).toBe(19)
    expect(new Set(relationships.map(({ legacyConstraint }) => legacyConstraint)).size).toBe(19)
    expect(
      new Set(relationships.map(({ legacyConstraint }) => legacyConstraint.slice(0, 63))).size,
    ).toBe(19)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'cascade')).toHaveLength(10)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'no action')).toHaveLength(8)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'set null')).toHaveLength(1)

    const expected = [
      ...cascadeRelationships.map((value) => `${value}|cascade`),
      ...noActionRelationships.map((value) => `${value}|no action`),
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

  it('keeps all 19 ORM relation joins tenant-qualified', () => {
    const { tables, tableNamesMap } = extractTablesRelationalConfig(
      schema,
      createTableRelationsHelpers,
    )
    const expected = [
      ['ppeAnnualRecords', 'inspectedByPerson', 'people', ['tenant_id', 'inspected_by_person_id']],
      ['ppeAnnualRecords', 'item', 'ppe_items', ['tenant_id', 'item_id']],
      ['ppeCriteriaBankCriteria', 'bank', 'ppe_criteria_banks', ['tenant_id', 'bank_id']],
      [
        'ppeInspectionAttachments',
        'criterion',
        'ppe_inspection_criteria',
        ['tenant_id', 'criterion_result_id'],
      ],
      ['ppeInspectionAttachments', 'inspection', 'ppe_inspections', ['tenant_id', 'inspection_id']],
      ['ppeInspectionCriteria', 'inspection', 'ppe_inspections', ['tenant_id', 'inspection_id']],
      [
        'ppeInspections',
        'inspectedBy',
        'tenant_users',
        ['tenant_id', 'inspected_by_tenant_user_id'],
      ],
      ['ppeInspections', 'item', 'ppe_items', ['tenant_id', 'item_id']],
      ['ppeIssueReports', 'item', 'ppe_items', ['tenant_id', 'item_id']],
      ['ppeIssueReports', 'inspection', 'ppe_inspections', ['tenant_id', 'inspection_id']],
      [
        'ppeIssueReports',
        'reportedBy',
        'tenant_users',
        ['tenant_id', 'reported_by_tenant_user_id'],
      ],
      ['ppeIssues', 'issuedBy', 'tenant_users', ['tenant_id', 'issued_by_tenant_user_id']],
      ['ppeIssues', 'item', 'ppe_items', ['tenant_id', 'item_id']],
      ['ppeIssues', 'person', 'people', ['tenant_id', 'person_id']],
      ['ppeItems', 'currentHolder', 'people', ['tenant_id', 'current_holder_person_id']],
      ['ppeItems', 'type', 'ppe_types', ['tenant_id', 'type_id']],
      ['ppeTypeCriteriaGroups', 'ppeType', 'ppe_types', ['tenant_id', 'ppe_type_id']],
      ['ppeTypeInspectionCriteria', 'group', 'ppe_type_criteria_groups', ['tenant_id', 'group_id']],
      ['ppeTypeInspectionCriteria', 'ppeType', 'ppe_types', ['tenant_id', 'ppe_type_id']],
    ] as const

    for (const [tableName, relationName, parentName, childColumns] of expected) {
      const table = tables[tableName]
      expect(table, tableName).toBeDefined()
      const relation = table!.relations[relationName]
      expect(relation, `${tableName}.${relationName}`).toBeDefined()
      expect(relation!.referencedTableName).toBe(parentName)
      const normalized = normalizeRelation(tables, tableNamesMap, relation!)
      expect(normalized.fields.map((column) => column.name)).toEqual(childColumns)
      expect(normalized.references.map((column) => column.name)).toEqual(['tenant_id', 'id'])
    }
  })

  it('leaves no single-column PPE FK to another tenant-owned table', () => {
    const tables = allTableConfigs()
    const tenantTables = new Set(
      tables
        .filter((table) => table.columns.some((column) => column.name === 'tenant_id'))
        .map((table) => table.name),
    )
    const residual: string[] = []

    for (const table of tables.filter((candidate) => domainTables.has(candidate.name))) {
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

  it('preserves group SET NULL without clearing tenant ownership', () => {
    expect(migrationSql).toContain("WHEN 'set null' THEN format('SET NULL (%I)'")
    expect(migrationSql).toContain(`SET NULL (%I)', relationship."child_column"`)
    expect(partialSetNullRelationships[0].split(',')[1]!.split('->')[0]).toBe('group_id')
  })

  it('preflights every tenant and validates replacements before retiring legacy keys', () => {
    expect(migrationSql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(migrationSql).toContain('PPE tenant/relation integrity preflight failed')
    expect(migrationSql).toContain('parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I')

    const relaxed = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" NO FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    const restored = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    expect(relaxed).toHaveLength(14)
    expect(restored).toEqual(relaxed)

    const lastRelaxAt = migrationSql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const errorAt = migrationSql.indexOf('PPE tenant/relation integrity preflight failed')
    const firstRestoreAt = migrationSql.indexOf(
      'FORCE ROW LEVEL SECURITY',
      lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
    )
    const criteriaPolicyAt = migrationSql.indexOf(
      'CREATE POLICY "tenant_isolation" ON "ppe_inspection_criteria"',
    )
    const attachmentPolicyAt = migrationSql.indexOf(
      'CREATE POLICY "tenant_isolation" ON "ppe_inspection_attachments"',
    )
    const parentKeysAt = migrationSql.indexOf('CREATE UNIQUE INDEX "ppe_types_tenant_id_id_ux"')
    const addAt = migrationSql.indexOf('ADD CONSTRAINT %I FOREIGN KEY')
    const validateAt = migrationSql.indexOf('VALIDATE CONSTRAINT %I')
    const legacyDropAt = migrationSql.indexOf('left(relationship."legacy_constraint", 63)')
    expect(errorAt).toBeGreaterThan(lastRelaxAt)
    expect(criteriaPolicyAt).toBeGreaterThan(errorAt)
    expect(attachmentPolicyAt).toBeGreaterThan(criteriaPolicyAt)
    expect(firstRestoreAt).toBeGreaterThan(attachmentPolicyAt)
    expect(parentKeysAt).toBeGreaterThan(firstRestoreAt)
    expect(addAt).toBeGreaterThan(parentKeysAt)
    expect(migrationSql.slice(addAt, validateAt)).toContain('NOT VALID')
    expect(validateAt).toBeGreaterThan(addAt)
    expect(legacyDropAt).toBeGreaterThan(validateAt)
  })

  it('guards the historical submitted-state backfill before relaxing result nullability', () => {
    const preflightAt = migrationSql.indexOf('PPE inspection status preflight failed')
    const resultNullableAt = migrationSql.indexOf(
      'ALTER TABLE "ppe_inspections" ALTER COLUMN "result" DROP NOT NULL',
    )
    const dateNullableAt = migrationSql.indexOf(
      'ALTER TABLE "ppe_inspections" ALTER COLUMN "inspected_on" DROP NOT NULL',
    )
    const checkAt = migrationSql.indexOf('ADD CONSTRAINT "ppe_inspections_submitted_result_ck"')
    const validateAt = migrationSql.indexOf(
      'VALIDATE CONSTRAINT "ppe_inspections_submitted_result_ck"',
    )

    expect(preflightAt).toBeGreaterThanOrEqual(0)
    expect(resultNullableAt).toBeGreaterThan(preflightAt)
    expect(dateNullableAt).toBeGreaterThan(preflightAt)
    expect(checkAt).toBeGreaterThan(dateNullableAt)
    expect(migrationSql.slice(checkAt, validateAt)).toContain('NOT VALID')
    expect(validateAt).toBeGreaterThan(checkAt)
    expect(migrationSql).not.toContain('INSERT INTO "ppe_inspection_criteria"')
  })

  it('pins historical inspector display evidence only from the exact tenant actor', () => {
    expect(getTableConfig(schema.ppeInspections).columns.map((column) => column.name)).toContain(
      'inspector_name_snapshot',
    )

    const relationshipPreflightAt = migrationSql.indexOf(
      'PPE tenant/relation integrity preflight failed',
    )
    const backfillAt = migrationSql.indexOf('UPDATE "ppe_inspections" AS inspection')
    const verificationAt = migrationSql.indexOf('PPE inspector snapshot verification failed')
    const firstRestoreAt = migrationSql.indexOf(
      'ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY',
    )

    expect(backfillAt).toBeGreaterThan(relationshipPreflightAt)
    expect(verificationAt).toBeGreaterThan(backfillAt)
    expect(firstRestoreAt).toBeGreaterThan(verificationAt)
    expect(migrationSql).toContain(
      'SET "inspector_name_snapshot" = coalesce(member."display_name", account."name")',
    )
    expect(migrationSql).toContain(
      'member."tenant_id" = inspection."tenant_id"\n  AND member."id" = inspection."inspected_by_tenant_user_id"',
    )
  })

  it('adds issue-report provenance without guessing a historical inspection', () => {
    const reportColumns = getTableConfig(schema.ppeIssueReports).columns.map(
      (column) => column.name,
    )
    expect(reportColumns).toEqual(
      expect.arrayContaining(['inspection_id', 'reported_by_name_snapshot', 'source']),
    )

    const relationshipPreflightAt = migrationSql.indexOf(
      'PPE tenant/relation integrity preflight failed',
    )
    const reporterBackfillAt = migrationSql.indexOf('UPDATE "ppe_issue_reports" AS report')
    const sourceBackfillAt = migrationSql.indexOf(
      'UPDATE "ppe_issue_reports"\nSET "source" = \'manual\'',
    )
    const verificationAt = migrationSql.indexOf('PPE issue provenance verification failed')
    const defaultAt = migrationSql.indexOf('ALTER COLUMN "source" SET DEFAULT \'manual\'')
    const requiredAt = migrationSql.indexOf('ALTER COLUMN "source" SET NOT NULL')
    const inspectionIndexAt = migrationSql.indexOf(
      'CREATE INDEX "ppe_issue_reports_inspection_idx"',
    )
    const relationshipAddAt = migrationSql.indexOf('ADD CONSTRAINT %I FOREIGN KEY')

    expect(reporterBackfillAt).toBeGreaterThan(relationshipPreflightAt)
    expect(sourceBackfillAt).toBeGreaterThan(reporterBackfillAt)
    expect(verificationAt).toBeGreaterThan(sourceBackfillAt)
    expect(defaultAt).toBeGreaterThan(verificationAt)
    expect(requiredAt).toBeGreaterThan(defaultAt)
    expect(inspectionIndexAt).toBeGreaterThan(requiredAt)
    expect(relationshipAddAt).toBeGreaterThan(inspectionIndexAt)
    expect(migrationSql).toContain(
      'member."tenant_id" = report."tenant_id"\n  AND member."id" = report."reported_by_tenant_user_id"',
    )
    expect(migrationSql).toContain('OR "inspection_id" IS NOT NULL')
  })

  it('makes general and criterion photos mutually exclusive at the database boundary', () => {
    expect(migrationSql).toContain(
      'CONSTRAINT "ppe_inspection_attachments_exactly_one_owner_ck" CHECK',
    )
    expect(migrationSql).toContain('("inspection_id" IS NULL) <> ("criterion_result_id" IS NULL)')
    expect(migrationSql).toContain(
      'CREATE UNIQUE INDEX "ppe_inspection_attachments_criterion_attachment_ux"',
    )
    expect(migrationSql).not.toContain(
      '\t"inspection_id" uuid NOT NULL,\n\t"criterion_result_id" uuid,',
    )
  })
})
