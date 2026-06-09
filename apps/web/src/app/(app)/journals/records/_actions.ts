'use server'

// Server actions for the admin/safety "browse all journals" page. Visibility is
// the journal scope (read.all → tenant-wide, read.site → your sites) applied
// inside listEntries/countEntries; the page itself is gated to managers.

import { requireRequestContext } from '@/lib/auth'
import { countEntries, listEntries } from '../_data'
import { journalCanBrowseAll } from '../_lib'
import type { JournalFilters, JournalListItem } from '../_types'

const PAGE = 40

export async function fetchRecords(input: {
  filters: JournalFilters
  offset?: number
  limit?: number
  /** Skip the (heavier) count when paging — only the first page needs the total. */
  withTotal?: boolean
}): Promise<{ items: JournalListItem[]; total: number | null }> {
  const ctx = await requireRequestContext()
  if (!journalCanBrowseAll(ctx)) return { items: [], total: 0 }
  const limit = Math.min(input.limit ?? PAGE, 100)
  const offset = input.offset ?? 0
  const [items, total] = await Promise.all([
    listEntries(ctx, input.filters, { limit, offset }),
    input.withTotal ? countEntries(ctx, input.filters) : Promise.resolve(null),
  ])
  return { items, total }
}
