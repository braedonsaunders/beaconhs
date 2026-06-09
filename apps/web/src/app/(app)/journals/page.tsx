import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'
import { getEntry, getWorkspaceData, listEntries } from './_data'
import { JournalWorkspace } from './_workspace'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Journals' }

export default async function JournalsPage() {
  const ctx = await requireRequestContext()
  const groupBy = 'date' as const

  const [data, recent] = await Promise.all([
    getWorkspaceData(ctx, groupBy, {}),
    listEntries(ctx, {}, { limit: 1 }),
  ])
  const initialEntry = recent[0] ? await getEntry(ctx, recent[0].id) : null
  const canManage = ctx.isSuperAdmin || can(ctx, 'journals.assign')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2 sm:px-4">
        <ModuleSubNav
          tabs={[{ key: 'workspace', label: 'Journals', href: '/journals' }]}
          active="workspace"
          manageHref={canManage ? '/journals/manage' : undefined}
        />
      </div>
      <div className="min-h-0 flex-1">
        <JournalWorkspace initialData={data} initialEntry={initialEntry} initialGroupBy={groupBy} />
      </div>
    </div>
  )
}
