import { isUuid } from '../../../lib/list-params'
import type { GroupBy, JournalFilters } from './_types'
import { normalizeJournalTags } from './_tag-policy'

export function normalizeJournalGroupBy(value: unknown): GroupBy {
  return value === 'site' || value === 'topic' ? value : 'date'
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

/** Runtime boundary for filters arriving through a client-called server action. */
export function normalizeJournalFilters(value: unknown): JournalFilters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const filters: JournalFilters = {}
  if (typeof input.q === 'string') {
    const q = input.q.trim().slice(0, 200)
    if (q) filters.q = q
  }
  if (typeof input.site === 'string' && isUuid(input.site)) filters.site = input.site
  if (typeof input.person === 'string' && isUuid(input.person)) filters.person = input.person
  if (typeof input.tag === 'string') {
    const [tag] = normalizeJournalTags([input.tag]) ?? []
    if (tag) filters.tag = tag
  }
  if (input.status === 'draft' || input.status === 'submitted' || input.status === 'archived') {
    filters.status = input.status
  }
  if (input.definition === 'worker' || input.definition === 'supervisor') {
    filters.definition = input.definition
  }
  if (validDate(input.from)) filters.from = input.from
  if (validDate(input.to)) filters.to = input.to
  return filters
}
