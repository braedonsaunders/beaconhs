import 'server-only'

import { and, eq, inArray, isNull } from 'drizzle-orm'
import { activePeopleWhere } from '@beaconhs/db'
import {
  departments,
  people,
  personGroups,
  trainingCourses,
  trainingSkillTypes,
  type BhqlQuery,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import type { PickerOption } from '@/lib/picker-options'
import { matrixSource, type MatrixFilters } from './_matrix-filter-values'

export type MatrixSelections = Record<keyof MatrixFilters, PickerOption[]>

/** Only hydrate selected values. Searchable options use the shared bounded picker API. */
export async function loadMatrixSelections(
  ctx: RequestContext,
  query: BhqlQuery,
  values: MatrixFilters,
): Promise<MatrixSelections> {
  return ctx.db(async (tx) => {
    const [personRows, departmentRows, groupRows, typeRows] = await Promise.all([
      values.people.length
        ? tx
            .select({ id: people.id, first: people.firstName, last: people.lastName })
            .from(people)
            .where(and(activePeopleWhere(), inArray(people.id, values.people)))
        : [],
      values.departments.length
        ? tx
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(inArray(departments.id, values.departments))
        : [],
      values.groups.length
        ? tx
            .select({ id: personGroups.id, name: personGroups.name })
            .from(personGroups)
            .where(and(isNull(personGroups.deletedAt), inArray(personGroups.id, values.groups)))
        : [],
      values.types.length
        ? matrixSource(query) === 'skill_coverage'
          ? tx
              .select({ id: trainingSkillTypes.id, name: trainingSkillTypes.name })
              .from(trainingSkillTypes)
              .where(
                and(
                  isNull(trainingSkillTypes.deletedAt),
                  eq(trainingSkillTypes.isActive, true),
                  inArray(trainingSkillTypes.id, values.types),
                ),
              )
          : tx
              .select({ id: trainingCourses.id, name: trainingCourses.name })
              .from(trainingCourses)
              .where(
                and(isNull(trainingCourses.deletedAt), inArray(trainingCourses.id, values.types)),
              )
        : [],
    ])
    const options = (rows: { id: string; name: string }[]): PickerOption[] =>
      rows.map((row) => ({ value: row.id, label: row.name }))
    // Retain stale IDs visibly instead of silently broadening a bookmarked filter.
    const complete = (key: keyof MatrixFilters, rows: PickerOption[]) =>
      values[key].map(
        (value) =>
          rows.find((row) => row.value === value) ?? { value, label: 'Unavailable selection' },
      )
    return {
      people: complete(
        'people',
        personRows.map((row) => ({ value: row.id, label: `${row.last}, ${row.first}` })),
      ),
      departments: complete('departments', options(departmentRows)),
      groups: complete('groups', options(groupRows)),
      types: complete('types', options(typeRows)),
      statuses: values.statuses.map((status) => ({
        value: status,
        label: status[0]!.toUpperCase() + status.slice(1),
      })),
    }
  })
}
