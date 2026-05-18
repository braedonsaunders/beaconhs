import { HardHat } from 'lucide-react'
import { asc, eq } from 'drizzle-orm'
import { Badge, EmptyState } from '@beaconhs/ui'
import { ppeItems, ppeTypes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

export const metadata = { title: 'PPE' }

export default async function PpePage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select({ item: ppeItems, type: ppeTypes })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .orderBy(asc(ppeTypes.name), asc(ppeItems.serialNumber))
      .limit(200),
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">PPE</h1>
        <p className="text-sm text-slate-500">
          Issue, return, replace, discard — plus scheduled inspections for inspectable PPE.
        </p>
      </header>

      {rows.length === 0 ? (
        <EmptyState icon={<HardHat size={32} />} title="No PPE items yet" />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {rows.map((r) => (
            <li key={r.item.id} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">
                  {r.type.name} · {r.item.serialNumber ?? '—'}
                </div>
                <div className="text-xs text-slate-500">
                  size {r.item.size ?? '—'} · {r.type.category ?? '—'}
                </div>
              </div>
              <Badge variant={r.item.status === 'in_stock' ? 'secondary' : 'success'}>
                {r.item.status.replace('_', ' ')}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
