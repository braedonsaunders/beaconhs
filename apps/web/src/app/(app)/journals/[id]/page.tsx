import { notFound } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'
import { getEntry, getWorkspaceData, listEntries } from '../_data'
import { isUuid } from '@/lib/list-params'
import { JournalWorkspace } from '../_workspace'
import { FlowApprovals } from '@/components/flows/flow-approvals'
import { getPendingFlowGatesForSubject } from '@/lib/flows/gate-store'
import { canManageSubjectGates } from '@/lib/flows/registry'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Journal entry' }

export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  const groupBy = 'date' as const

  const [data, deepEntry, pendingGates] = await Promise.all([
    getWorkspaceData(ctx, groupBy, {}),
    getEntry(ctx, id),
    getPendingFlowGatesForSubject(
      ctx,
      'module',
      id,
      canManageSubjectGates(ctx, 'module', 'journals'),
    ),
  ])
  const initialEntry =
    deepEntry ??
    (await listEntries(ctx, {}, { limit: 1 }).then((r) => (r[0] ? getEntry(ctx, r[0].id) : null)))

  const workspace = (
    <JournalWorkspace initialData={data} initialEntry={initialEntry} initialGroupBy={groupBy} />
  )
  if (pendingGates.length === 0) return workspace
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-200 p-3 dark:border-slate-800">
        <FlowApprovals gates={pendingGates} />
      </div>
      <div className="min-h-0 flex-1">{workspace}</div>
    </div>
  )
}
