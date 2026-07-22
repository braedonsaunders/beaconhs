import { asc, inArray } from 'drizzle-orm'
import { departments, people, personGroups, trainingCourses } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import type { PickerOption } from '@/lib/picker-options'
import type { TrainingReportFilters } from '@beaconhs/reports'

export type TrainingFilterSelections = {
  people: PickerOption[]
  departments: PickerOption[]
  groups: PickerOption[]
  courses: PickerOption[]
  courseTypes: PickerOption[]
}

export async function loadTrainingFilterSelections(
  ctx: RequestContext,
  filters: TrainingReportFilters,
): Promise<TrainingFilterSelections> {
  return ctx.db(async (tx) => {
    const [personRows, departmentRows, groupRows, courseRows] = await Promise.all([
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
      filters.courseIds.length
        ? tx
            .select({
              id: trainingCourses.id,
              name: trainingCourses.name,
              code: trainingCourses.code,
            })
            .from(trainingCourses)
            .where(inArray(trainingCourses.id, filters.courseIds))
            .orderBy(asc(trainingCourses.name))
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
      courses: courseRows.map((row) => ({
        value: row.id,
        label: `${row.code ? `${row.code} · ` : ''}${row.name}`,
      })),
      courseTypes: filters.courseTypes.map((value) => ({ value, label: value })),
    }
  })
}
