import { notFound } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'
import { getEntry, getWorkspaceData, listEntries } from '../_data'
import { isUuid } from '../_lib'
import { JournalWorkspace } from '../_workspace'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Journal entry' }

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireRequestContext()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const groupBy = 'date' as const

  const [data, deepEntry] = await Promise.all([
    getWorkspaceData(ctx, groupBy, {}),
    getEntry(ctx, id),
  ])
  const initialEntry =
    deepEntry ?? (await listEntries(ctx, {}, { limit: 1 }).then((r) => (r[0] ? getEntry(ctx, r[0].id) : null)))

  return (
    <JournalWorkspace initialData={data} initialEntry={initialEntry} initialGroupBy={groupBy} />
  )
}
