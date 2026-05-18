import { ListChecks } from 'lucide-react'
import { desc } from 'drizzle-orm'
import { Badge, EmptyState } from '@beaconhs/ui'
import { correctiveActions } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

export const metadata = { title: 'Corrective Actions' }

export default async function CorrectiveActionsPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx.select().from(correctiveActions).orderBy(desc(correctiveActions.createdAt)).limit(50),
  )
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Corrective Actions</h1>
      <p className="text-sm text-slate-500">
        Standalone records, linkable to incidents, inspections, or audit findings.
      </p>
      {rows.length === 0 ? (
        <EmptyState icon={<ListChecks size={32} />} title="No corrective actions" />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">
                  {c.reference} · {c.title}
                </div>
                <div className="text-xs text-slate-500">
                  Due {c.dueOn ?? '—'} · {c.severity}
                </div>
              </div>
              <Badge variant={c.status === 'closed' ? 'success' : 'warning'}>{c.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
