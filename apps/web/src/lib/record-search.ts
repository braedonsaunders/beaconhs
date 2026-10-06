import { ilike, or, sql, type SQL } from 'drizzle-orm'
import { primaryPersonTitleName } from '@beaconhs/db'
import {
  correctiveActions,
  departments,
  documents,
  equipmentCategories,
  equipmentItems,
  equipmentTypes,
  hazidAssessments,
  incidents,
  people,
  ppeItems,
  ppeTypes,
} from '@beaconhs/db/schema'

/** Literal substring search: user-entered % and _ are not SQL wildcards. */
export function recordSearchTerm(query: string): string {
  return `%${query.trim().replace(/[%_\\]/g, (character) => `\\${character}`)}%`
}

// Search business fields deliberately, independently of table columns. Do not
// include verification tokens, internal IDs, or arbitrary private metadata.
const fields = {
  ppe: [ppeItems.serialNumber, ppeItems.size, ppeItems.notes],
  equipment: [
    equipmentItems.assetTag,
    equipmentItems.name,
    equipmentItems.serialNumber,
    equipmentItems.licensePlate,
    equipmentItems.vin,
    equipmentItems.manufacturer,
    equipmentItems.model,
    equipmentItems.description,
    equipmentItems.notes,
  ],
  people: [
    people.firstName,
    people.lastName,
    sql<string>`${people.firstName} || ' ' || ${people.lastName}`,
    people.formalName,
    people.employeeNo,
    people.email,
    primaryPersonTitleName(people.id, people.tenantId),
  ],
  incidents: [incidents.reference, incidents.title, incidents.description],
  corrective_actions: [
    correctiveActions.reference,
    correctiveActions.title,
    correctiveActions.description,
    correctiveActions.rootCause,
    correctiveActions.actionTaken,
    correctiveActions.verificationNotes,
  ],
  documents: [documents.key, documents.title, documents.description],
  hazid_assessments: [
    hazidAssessments.reference,
    hazidAssessments.locationOnSite,
    hazidAssessments.jobScope,
  ],
} as const

/**
 * Shared by global results/counts, module lists/exports, and equipment pickers.
 * The caller must still apply tenant context, permissions and record filters.
 * Related lookups are correlated to the record's tenant and need no outer joins.
 */
export function recordSearchWhere(
  kind: keyof typeof fields,
  query: string | undefined,
): SQL | undefined {
  const trimmed = query?.trim()
  if (!trimmed) return undefined
  const term = recordSearchTerm(trimmed)
  const matches = fields[kind].map((field) => ilike(field, term))
  if (kind === 'equipment') {
    // Plates and other equipment identifiers are commonly entered with spaces
    // or hyphens. Accept either presentation without changing stored values.
    const identifier = trimmed.replace(/[\s-]/g, '')
    if (identifier) {
      const identifierTerm = recordSearchTerm(identifier)
      for (const field of [
        equipmentItems.licensePlate,
        equipmentItems.vin,
        equipmentItems.assetTag,
        equipmentItems.serialNumber,
      ]) {
        matches.push(ilike(sql`regexp_replace(${field}, '[[:space:]-]', '', 'g')`, identifierTerm))
      }
    }
    for (const [table, id, name] of [
      [departments, equipmentItems.departmentId, departments.name],
      [equipmentTypes, equipmentItems.typeId, equipmentTypes.name],
      [equipmentCategories, equipmentItems.categoryId, equipmentCategories.name],
    ] as const) {
      matches.push(sql`exists (
        select 1 from ${table}
        where ${table.id} = ${id}
          and ${table.tenantId} = ${equipmentItems.tenantId}
          and ${ilike(name, term)}
      )`)
    }
  }
  if (kind === 'ppe') {
    matches.push(sql`exists (
      select 1 from ${ppeTypes}
      where ${ppeTypes.id} = ${ppeItems.typeId}
        and ${ppeTypes.tenantId} = ${ppeItems.tenantId}
        and ${or(ilike(ppeTypes.name, term), ilike(ppeTypes.category, term))}
    )`)
    matches.push(sql`exists (
      select 1 from ${people}
      where ${people.id} = ${ppeItems.currentHolderPersonId}
        and ${people.tenantId} = ${ppeItems.tenantId}
        and ${recordSearchWhere('people', trimmed)}
    )`)
  }
  return or(...matches)
}
