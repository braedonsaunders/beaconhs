import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  customFieldDefinitions,
  departments,
  equipmentCategories,
  equipmentTypes,
  inspectionTypes,
  orgUnits,
  people,
  personGroups,
  ppeTypes,
  tenantUsers,
  trades,
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

/** Title-cases a raw pg enum label ('near_miss' → 'Near miss') for pickers. */
function prettifyEnumLabel(value: string): string {
  const spaced = value.replace(/[_-]+/g, ' ').trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : value
}

function uniqueOptions(
  options: readonly { value: string; label: string }[] | undefined,
): { value: string; label: string }[] | undefined {
  if (!options?.length) return undefined
  return Array.from(new Map(options.map((option) => [option.value, option] as const)).values())
}

/**
 * Introspects every public enum-backed column and returns its ordered labels
 * keyed by `table.column`, so enum filter fields (status/severity/type/source)
 * render as dropdowns instead of free text — with values that can never drift
 * from the database because they come from `pg_enum` itself.
 */
async function loadEnumOptionsByColumn(
  tx: Database,
): Promise<Map<string, { value: string; label: string }[]>> {
  const rows = (await tx.execute(sql`
    SELECT c.table_name, c.column_name, e.enumlabel AS value
    FROM information_schema.columns c
    JOIN pg_type t ON t.typname = c.udt_name
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE c.table_schema = 'public'
    ORDER BY c.table_name, c.column_name, e.enumsortorder
  `)) as unknown as Array<{ table_name: string; column_name: string; value: string }>
  const map = new Map<string, { value: string; label: string }[]>()
  for (const row of rows) {
    const key = `${row.table_name}.${row.column_name}`
    const list = map.get(key) ?? []
    list.push({ value: row.value, label: prettifyEnumLabel(row.value) })
    map.set(key, list)
  }
  return map
}

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
    enumOptionsByColumn,
    personRows,
    departmentRows,
    groupRows,
    courseRows,
    skillTypeRows,
    authorityRows,
    ppeTypeRows,
    ownerRows,
    locationRows,
    inspectionTypeRows,
    equipmentTypeRows,
    equipmentCategoryRows,
    tradeRows,
  ] = await Promise.all([
    loadEnumOptionsByColumn(tx),
    tx
      .select({
        value: people.id,
        employeeNo: people.employeeNo,
        firstName: people.firstName,
        lastName: people.lastName,
      })
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
      .select({
        value: trainingCourses.id,
        code: trainingCourses.code,
        name: trainingCourses.name,
        courseType: trainingCourses.courseType,
      })
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
    tx
      .select({ value: inspectionTypes.id, label: inspectionTypes.name })
      .from(inspectionTypes)
      .where(isNull(inspectionTypes.deletedAt))
      .orderBy(asc(inspectionTypes.name)),
    tx
      .select({ value: equipmentTypes.id, label: equipmentTypes.name })
      .from(equipmentTypes)
      .orderBy(asc(equipmentTypes.name)),
    tx
      .select({ value: equipmentCategories.id, label: equipmentCategories.name })
      .from(equipmentCategories)
      .orderBy(asc(equipmentCategories.name)),
    tx.select({ value: trades.id, label: trades.name }).from(trades).orderBy(asc(trades.name)),
  ])
  const personIdOptions = personRows.map((row) => ({
    value: row.value,
    label: `${row.lastName}, ${row.firstName}`,
  }))
  const personNameOptions = personRows.map((row) => ({
    value: `${row.lastName}, ${row.firstName}`,
    label: `${row.lastName}, ${row.firstName}`,
  }))
  const holderNameOptions = personRows.map((row) => ({
    value: `${row.firstName} ${row.lastName}`,
    label: `${row.lastName}, ${row.firstName}`,
  }))
  const employeeNumberOptions = personRows
    .filter((row): row is typeof row & { employeeNo: string } => Boolean(row.employeeNo))
    .map((row) => ({
      value: row.employeeNo,
      label: `${row.employeeNo} — ${row.lastName}, ${row.firstName}`,
    }))
  const courseIdOptions = courseRows.map((row) => ({
    value: row.value,
    label: `${row.code} — ${row.name}`,
  }))
  const courseNameOptions = courseRows.map((row) => ({
    value: row.name,
    label: `${row.code} — ${row.name}`,
  }))
  const courseCodeOptions = courseRows.map((row) => ({
    value: row.code,
    label: `${row.code} — ${row.name}`,
  }))
  const courseTypeOptions = Array.from(
    new Set(
      courseRows.map((row) => row.courseType).filter((value): value is string => Boolean(value)),
    ),
  )
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, label: prettifyEnumLabel(value) }))
  const departmentNameOptions = departmentRows.map((row) => ({
    value: row.label,
    label: row.label,
  }))
  const locationNameOptions = locationRows.map((row) => ({ value: row.label, label: row.label }))
  const groupOptions = groupRows.map((row) => ({ value: row.value, label: row.label }))
  const optionsByColumn = new Map<string, { value: string; label: string }[]>([
    ['person_id', personIdOptions],
    ['current_holder_person_id', personIdOptions],
    ['driver_person_id', personIdOptions],
    ['subject_person_id', personIdOptions],
    ['department_id', departmentRows],
    ['department_name', departmentNameOptions],
    ['group_id_list', groupOptions],
    ['course_id', courseIdOptions],
    ['skill_type_id', skillTypeRows],
    ['authority_id', authorityRows],
    ['ppe_items.type_id', ppeTypeRows],
    [
      'owner_tenant_user_id',
      ownerRows.map((row) => ({ value: row.value, label: row.label ?? row.value })),
    ],
    ['site_org_unit_id', locationRows],
    ['current_site_org_unit_id', locationRows],
    ['inspection_records.type_id', inspectionTypeRows],
    ['training_matrix.person_name', personNameOptions],
    ['training_matrix.employee_no', employeeNumberOptions],
    [
      'training_matrix.last_name',
      personRows.map((row) => ({ value: row.lastName, label: row.lastName })),
    ],
    [
      'training_matrix.first_name',
      personRows.map((row) => ({ value: row.firstName, label: row.firstName })),
    ],
    ['training_matrix.course_name', courseNameOptions],
    ['training_matrix.course_code', courseCodeOptions],
    ['training_matrix.course_type', courseTypeOptions],
    ['skill_assignments.employee_no', employeeNumberOptions],
    [
      'skill_assignments.last_name',
      personRows.map((row) => ({ value: row.lastName, label: row.lastName })),
    ],
    [
      'skill_assignments.first_name',
      personRows.map((row) => ({ value: row.firstName, label: row.firstName })),
    ],
    ['skill_assignments.trade', tradeRows.map((row) => ({ value: row.label, label: row.label }))],
    [
      'skill_assignments.authority',
      authorityRows.map((row) => ({ value: row.label, label: row.label })),
    ],
    [
      'skill_assignments.certification_name',
      skillTypeRows.map((row) => ({ value: row.label, label: row.label })),
    ],
    ['ppe_items.ppe_type', ppeTypeRows.map((row) => ({ value: row.label, label: row.label }))],
    ['ppe_items.holder_name', personNameOptions],
    [
      'corrective_actions.owner_name',
      ownerRows.map((row) => ({ value: row.label ?? row.value, label: row.label ?? row.value })),
    ],
    ['corrective_actions.location_name', locationNameOptions],
    [
      'equipment_fleet.equipment_type',
      equipmentTypeRows.map((row) => ({ value: row.label, label: row.label })),
    ],
    [
      'equipment_fleet.type_category',
      equipmentCategoryRows.map((row) => ({ value: row.label, label: row.label })),
    ],
    ['equipment_fleet.site_name', locationNameOptions],
    ['equipment_fleet.holder_name', holderNameOptions],
    ['vehicle_log_entries.driver_name', holderNameOptions],
    ['vehicle_log_entries.employee_no', employeeNumberOptions],
    ['vehicle_log_entries.site_name', locationNameOptions],
    ['vehicle_log_monthly.driver_name', holderNameOptions],
    ['vehicle_log_monthly.employee_no', employeeNumberOptions],
    ['compliance_status.person_name', personNameOptions],
  ])
  const derivedOptionsByColumn = new Map<string, { value: string; label: string }[]>([
    [
      'training_matrix.coverage_status',
      ['missing', 'expired', 'expiring', 'valid'].map((value) => ({
        value,
        label: prettifyEnumLabel(value),
      })),
    ],
    [
      'skill_assignments.status',
      ['expired', 'expiring', 'valid', 'no_expiry'].map((value) => ({
        value,
        label: prettifyEnumLabel(value),
      })),
    ],
  ])
  return {
    entities: await Promise.all(
      REPORT_ENTITIES.map(async (entity) => {
        const augmented = await augmentBeaconReportEntityWithCustomFields(tx, entity)
        return {
          ...augmented,
          columns: augmented.columns.map((column) => {
            const filterOptions =
              optionsByColumn.get(`${entity.key}.${column.key}`) ??
              optionsByColumn.get(column.key) ??
              enumOptionsByColumn.get(`${entity.table}.${column.key}`) ??
              derivedOptionsByColumn.get(`${entity.key}.${column.key}`) ??
              column.filterOptions
            return {
              ...column,
              filterOptions: uniqueOptions(filterOptions),
            }
          }),
        }
      }),
    ),
  }
}
