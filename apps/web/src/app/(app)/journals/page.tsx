import { requireRequestContext } from '@/lib/auth'
import { ModuleNav } from '@/components/module-admin/module-nav'
import { getEntry, getWorkspaceData, listEntries } from './_data'
import { JournalWorkspace } from './_workspace'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Journals' }

export default async function JournalsPage() {
  const ctx = await requireRequestContext()
  const groupBy = 'date' as const

  const [data, recent] = await Promise.all([
    getWorkspaceData(ctx, groupBy, {}),
    // Open the user's OWN most-recent entry (the workspace is personal).
    listEntries(ctx, {}, { limit: 1 }, true),
  ])
  const initialEntry = recent[0] ? await getEntry(ctx, recent[0].id) : null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
        <ModuleNav moduleKey="journals" active="workspace" />
      </div>
      <div className="min-h-0 flex-1">
        <JournalWorkspace initialData={data} initialEntry={initialEntry} initialGroupBy={groupBy} />
      </div>
    </div>
  )
}
