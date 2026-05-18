import { BookOpen } from 'lucide-react'
import { asc } from 'drizzle-orm'
import { Badge, EmptyState } from '@beaconhs/ui'
import { documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

export const metadata = { title: 'Documents' }

export default async function DocumentsPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx.select().from(documents).orderBy(asc(documents.title)).limit(200),
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Documents</h1>
        <p className="text-sm text-slate-500">
          Versioned library + read-and-acknowledge + periodic review + management review books.
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState icon={<BookOpen size={32} />} title="Documents module scaffolded" />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {rows.map((d) => (
            <li key={d.id} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">{d.title}</div>
                <div className="text-xs text-slate-500">
                  {d.category ?? 'document'}
                  {d.reviewFrequencyMonths ? ` · review every ${d.reviewFrequencyMonths}mo` : ''}
                </div>
              </div>
              <Badge variant={d.status === 'published' ? 'success' : 'secondary'}>{d.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
