// /journals/records — the admin / safety-dept "browse all journals" surface.
// A full-page, filterable browser over every entry the viewer is allowed to see
// (read.all → tenant-wide, read.site → their sites), with Split / Table / Card
// views. The sidebar workspace stays the place to write your own; this is the
// place to review everyone's. Gated to managers; self-only users go to /journals.

import { redirect } from 'next/navigation'
import { PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { ModuleNav } from '@/components/module-admin/module-nav'
import { countEntries, listEntries, listMetaOptions, listTagSuggestions } from '../_data'
import { getAuthorPersonId, journalCanBrowseAll, journalScopeWhere } from '../_lib'
import { RecordsBrowser } from './_browser'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Journal records' }

const PAGE = 40

export default async function JournalRecordsPage() {
  const ctx = await requireRequestContext()
  if (!journalCanBrowseAll(ctx)) redirect('/journals')

  const scope = journalScopeWhere(ctx, await getAuthorPersonId(ctx))
  const [items, total, options, tags] = await Promise.all([
    listEntries(ctx, {}, { limit: PAGE }),
    countEntries(ctx, {}),
    listMetaOptions(ctx),
    listTagSuggestions(ctx, scope),
  ])

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900">
      <div className="shrink-0 border-b border-slate-200 px-4 pt-4 sm:px-6 dark:border-slate-800">
        <PageHeader
          title="Journal records"
          description="Browse and filter journal entries by person, site, and date."
        />
        <div className="pt-2 pb-3">
          <ModuleNav moduleKey="journals" active="records" />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <RecordsBrowser
          initialItems={items}
          initialTotal={total}
          pageSize={PAGE}
          sites={options.sites}
          people={options.people}
          tags={tags}
        />
      </div>
    </div>
  )
}
