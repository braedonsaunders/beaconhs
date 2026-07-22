import { asc, inArray } from 'drizzle-orm'
import {
  complianceObligations,
  departments,
  orgUnits,
  people,
  personGroups,
  ppeTypes,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import type { PickerOption } from '@/lib/picker-options'
import type { OperationalReportFilters } from '@beaconhs/reports'

export type OperationalFilterSelections = {
  people: PickerOption[]
  departments: PickerOption[]
  groups: PickerOption[]
  obligations: PickerOption[]
  skillTypes: PickerOption[]
  authorities: PickerOption[]
  sites: PickerOption[]
  ppeTypes: PickerOption[]
}

export async function loadOperationalFilterSelections(
  ctx: RequestContext,
  filters: OperationalReportFilters,
): Promise<OperationalFilterSelections> {
  return ctx.db(async (tx) => {
    const [
      personRows,
      departmentRows,
      groupRows,
      obligationRows,
      skillRows,
      authorityRows,
      siteRows,
      ppeRows,
    ] = await Promise.all([
      filters.personIds.length
        ? tx
            .select({
              id: people.id,
              firstName: people.firstName,
              lastName: people.lastName,
              employeeNo: people.employeeNo,
            })
            .from(people)
            .where(inArray(people.id, filters.personIds))
            .orderBy(asc(people.lastName), asc(people.firstName))
        : [],
      filters.departmentIds.length
        ? tx
            .select({ id: departments.id, name: departments.name, code: departments.code })
            .from(departments)
            .where(inArray(departments.id, filters.departmentIds))
            .orderBy(asc(departments.name))
        : [],
      filters.groupIds.length
        ? tx
            .select({ id: personGroups.id, name: personGroups.name })
            .from(personGroups)
            .where(inArray(personGroups.id, filters.groupIds))
            .orderBy(asc(personGroups.name))
        : [],
      filters.obligationIds.length
        ? tx
            .select({
              id: complianceObligations.id,
              name: complianceObligations.title,
              module: complianceObligations.sourceModule,
            })
            .from(complianceObligations)
            .where(inArray(complianceObligations.id, filters.obligationIds))
            .orderBy(asc(complianceObligations.title))
        : [],
      filters.skillTypeIds.length
        ? tx
            .select({
              id: trainingSkillTypes.id,
              name: trainingSkillTypes.name,
              code: trainingSkillTypes.code,
            })
            .from(trainingSkillTypes)
            .where(inArray(trainingSkillTypes.id, filters.skillTypeIds))
            .orderBy(asc(trainingSkillTypes.name))
        : [],
      filters.authorityIds.length
        ? tx
            .select({ id: trainingSkillAuthorities.id, name: trainingSkillAuthorities.name })
            .from(trainingSkillAuthorities)
            .where(inArray(trainingSkillAuthorities.id, filters.authorityIds))
            .orderBy(asc(trainingSkillAuthorities.name))
        : [],
      filters.siteIds.length
        ? tx
            .select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
            .from(orgUnits)
            .where(inArray(orgUnits.id, filters.siteIds))
            .orderBy(asc(orgUnits.name))
        : [],
      filters.ppeTypeIds.length
        ? tx
            .select({ id: ppeTypes.id, name: ppeTypes.name, category: ppeTypes.category })
            .from(ppeTypes)
            .where(inArray(ppeTypes.id, filters.ppeTypeIds))
            .orderBy(asc(ppeTypes.name))
        : [],
    ])

    return {
      people: personRows.map((row) => ({
        value: row.id,
        label: `${row.lastName}, ${row.firstName}`,
        ...(row.employeeNo ? { hint: row.employeeNo } : {}),
      })),
      departments: departmentRows.map((row) => ({
        value: row.id,
        label: row.name,
        ...(row.code ? { hint: row.code } : {}),
      })),
      groups: groupRows.map((row) => ({ value: row.id, label: row.name })),
      obligations: obligationRows.map((row) => ({
        value: row.id,
        label: row.name,
        hint: row.module.replaceAll('_', ' '),
      })),
      skillTypes: skillRows.map((row) => ({
        value: row.id,
        label: `${row.code ? `${row.code} · ` : ''}${row.name}`,
      })),
      authorities: authorityRows.map((row) => ({ value: row.id, label: row.name })),
      sites: siteRows.map((row) => ({
        value: row.id,
        label: row.name,
        ...(row.code ? { hint: row.code } : {}),
      })),
      ppeTypes: ppeRows.map((row) => ({
        value: row.id,
        label: row.name,
        ...(row.category ? { hint: row.category } : {}),
      })),
    }
  })
}
