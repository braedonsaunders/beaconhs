import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  customFieldDefinitions,
  departments,
  orgUnits,
  people,
  personGroups,
  ppeTypes,
  tenantUsers,
  trainingCourses,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import {
  buildCustomReportColumns,
  type CustomReportFieldDefinition,
  type ReportEntityCatalog,
  type ReportEntityColumn,
} from '@appkit/reports'
import { REPORT_ENTITIES, type ReportEntity } from './entities'

const TABLE_TO_KIND: Record<string, 'equipment' | 'ppe' | 'person' | 'location'> = {
  equipment_items: 'equipment',
  ppe_items: 'ppe',
  report_ppe_items: 'ppe',
  people: 'person',
  org_units: 'location',
}

export async function loadBeaconCustomReportColumns(
  tx: Database,
  table: string,
): Promise<ReportEntityColumn[]> {
  const kind = TABLE_TO_KIND[table]
  if (!kind) return []
  const definitions: CustomReportFieldDefinition[] = await tx
    .select({
      key: customFieldDefinitions.key,
      label: customFieldDefinitions.label,
      fieldType: customFieldDefinitions.fieldType,
    })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.entityKind, kind),
        eq(customFieldDefinitions.isActive, true),
        isNull(customFieldDefinitions.deletedAt),
      ),
    )
    .orderBy(asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.label))
    .for('key share')
  return buildCustomReportColumns(table, definitions)
}

export async function augmentBeaconReportEntityWithCustomFields(
  tx: Database,
  entity: ReportEntity,
): Promise<ReportEntity> {
  if (!entity.table) return entity
  const columns = await loadBeaconCustomReportColumns(tx, entity.table)
  if (!columns.length) return entity
  const existing = new Set(entity.columns.map((column) => column.key))
  return {
    ...entity,
    columns: [...entity.columns, ...columns.filter((column) => !existing.has(column.key))],
  }
}

/** Tenant-aware AppKit catalogue used by the studio and every executor. */
export async function loadBeaconReportCatalog(tx: Database): Promise<ReportEntityCatalog> {
  const [
    personRows,
    departmentRows,
    groupRows,
    courseRows,
    skillTypeRows,
    authorityRows,
    ppeTypeRows,
    ownerRows,
    locationRows,
  ] = await Promise.all([
    tx
      .select({ value: people.id, firstName: people.firstName, lastName: people.lastName })
      .from(people)
      .where(and(eq(people.status, 'active'), isNull(people.deletedAt)))
      .orderBy(asc(people.lastName), asc(people.firstName)),
    tx
      .select({ value: departments.id, label: departments.name })
      .from(departments)
      .orderBy(asc(departments.name)),
    tx
      .select({ value: personGroups.id, label: personGroups.name })
      .from(personGroups)
      .where(isNull(personGroups.deletedAt))
      .orderBy(asc(personGroups.name)),
    tx
      .select({ value: trainingCourses.id, code: trainingCourses.code, name: trainingCourses.name })
      .from(trainingCourses)
      .where(isNull(trainingCourses.deletedAt))
      .orderBy(asc(trainingCourses.name)),
    tx
      .select({ value: trainingSkillTypes.id, label: trainingSkillTypes.name })
      .from(trainingSkillTypes)
      .orderBy(asc(trainingSkillTypes.name)),
    tx
      .select({ value: trainingSkillAuthorities.id, label: trainingSkillAuthorities.name })
      .from(trainingSkillAuthorities)
      .orderBy(asc(trainingSkillAuthorities.name)),
    tx
      .select({ value: ppeTypes.id, label: ppeTypes.name })
      .from(ppeTypes)
      .orderBy(asc(ppeTypes.name)),
    tx
      .select({ value: tenantUsers.id, label: tenantUsers.displayName })
      .from(tenantUsers)
      .where(eq(tenantUsers.status, 'active'))
      .orderBy(asc(tenantUsers.displayName)),
    tx
      .select({ value: orgUnits.id, label: orgUnits.name })
      .from(orgUnits)
      .where(isNull(orgUnits.deletedAt))
      .orderBy(asc(orgUnits.name)),
  ])
  const optionsByColumn = new Map<string, { value: string; label: string }[]>([
    [
      'person_id',
      personRows.map((row) => ({
        value: row.value,
        label: `${row.lastName}, ${row.firstName}`,
      })),
    ],
    [
      'current_holder_person_id',
      personRows.map((row) => ({ value: row.value, label: `${row.lastName}, ${row.firstName}` })),
    ],
    ['department_id', departmentRows],
    ['group_id_list', groupRows],
    [
      'course_id',
      courseRows.map((row) => ({ value: row.value, label: `${row.code} — ${row.name}` })),
    ],
    ['skill_type_id', skillTypeRows],
    ['authority_id', authorityRows],
    ['ppe_items.type_id', ppeTypeRows],
    [
      'owner_tenant_user_id',
      ownerRows.map((row) => ({ value: row.value, label: row.label ?? row.value })),
    ],
    ['site_org_unit_id', locationRows],
  ])
  return {
    entities: await Promise.all(
      REPORT_ENTITIES.map(async (entity) => {
        const augmented = await augmentBeaconReportEntityWithCustomFields(tx, entity)
        return {
          ...augmented,
          columns: augmented.columns.map((column) => ({
            ...column,
            enumOptions:
              optionsByColumn.get(`${entity.key}.${column.key}`) ??
              optionsByColumn.get(column.key) ??
              column.enumOptions,
          })),
        }
      }),
    ),
  }
}
