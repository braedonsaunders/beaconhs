import { isUuid } from '../../../lib/list-params'
import type { GroupBy, JournalFilters } from './_types'
import { normalizeJournalTags } from './_tag-policy'
import { isJournalDate } from './_dates'

export function normalizeJournalGroupBy(value: unknown): GroupBy {
  return value === 'site' || value === 'topic' ? value : 'date'
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
  if (isJournalDate(input.from)) filters.from = input.from
  if (isJournalDate(input.to)) filters.to = input.to
  return filters
}
