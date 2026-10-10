import { z } from 'zod'
import type { BhqlQuery, ReportRule, ReportRuleGroup } from '@beaconhs/db/schema'

const ids = z
  .array(z.string().uuid())
  .max(100)
  .default([])
  .transform((values) => [...new Set(values)])
const schema = z
  .object({
    people: ids,
    departments: ids,
    groups: ids,
    types: ids,
    statuses: z
      .array(z.enum(['valid', 'expiring', 'expired', 'missing']))
      .max(4)
      .default([]),
  })
  .strict()
  .refine(
    (values) => Object.values(values).reduce((count, items) => count + items.length, 0) <= 100,
    'Choose at most 100 filter values.',
  )

export type MatrixFilters = z.infer<typeof schema>
export const MATRIX_FILTER_PARAM = 'matrix_filters'

export function parseMatrixFilters(raw?: string | null): MatrixFilters {
  if (raw && raw.length > 12_000) throw new Error('Matrix filters are too large.')
  return schema.parse(raw ? JSON.parse(raw) : {})
}

export function serializeMatrixFilters(values: MatrixFilters): string | null {
  const parsed = schema.parse(values)
  const selected = Object.fromEntries(
    Object.entries(parsed).filter(([, items]) => items.length > 0),
  )
  return Object.keys(selected).length ? JSON.stringify(selected) : null
}

export function matrixSource(query: BhqlQuery): 'skill_coverage' | 'training_matrix' | null {
  const source = query.stages[0]?.source
  return query.display === 'pivot' && (source === 'skill_coverage' || source === 'training_matrix')
    ? source
    : null
}

/** Runtime controls only narrow the saved query; they never overwrite it. */
export function applyMatrixFilterRules(
  query: BhqlQuery,
  values: MatrixFilters,
  peopleSearch = '',
): BhqlQuery {
  const source = matrixSource(query)
  const stage = query.stages[0]
  if (!source || !stage) return query
  const rules: (ReportRule | ReportRuleGroup)[] = []
  const add = (field: string, values: string[]) => {
    if (values.length) rules.push({ field, op: 'in', value: values })
  }
  add('person_id', values.people)
  add('department_id', values.departments)
  add('group_id_list', values.groups)
  add(source === 'skill_coverage' ? 'skill_type_id' : 'course_id', values.types)
  if (values.statuses.includes('missing')) {
    const other = values.statuses.filter((status) => status !== 'missing')
    const missing: ReportRuleGroup = {
      combinator: 'and',
      rules: [
        { field: 'coverage_status', op: 'eq', value: 'missing' },
        { field: 'is_required', op: 'is_true' },
      ],
    }
    rules.push(
      other.length
        ? {
            combinator: 'or',
            rules: [{ field: 'coverage_status', op: 'in', value: other }, missing],
          }
        : missing,
    )
  } else add('coverage_status', values.statuses)
  if (peopleSearch.trim())
    rules.push({ field: 'person_name', op: 'contains', value: peopleSearch.trim().slice(0, 200) })
  if (!rules.length) return query
  const filter: ReportRuleGroup = stage.filter?.rules.length
    ? { combinator: 'and', rules: [stage.filter, ...rules] }
    : { combinator: 'and', rules }
  return { ...query, stages: [{ ...stage, filter }, ...query.stages.slice(1)] }
}
