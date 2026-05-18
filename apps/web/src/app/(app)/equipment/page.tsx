import { Wrench } from 'lucide-react'
import { asc, eq } from 'drizzle-orm'
import { Badge, EmptyState } from '@beaconhs/ui'
import { equipmentItems, equipmentTypes, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

export const metadata = { title: 'Equipment' }

export default async function EquipmentPage() {
  const ctx = await requireRequestContext()
  const rows = await ctx.db((tx) =>
    tx
      .select({
        item: equipmentItems,
        type: equipmentTypes,
        site: orgUnits,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .orderBy(asc(equipmentItems.assetTag))
      .limit(200),
  )

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Equipment</h1>
        <p className="text-sm text-slate-500">Asset registry. QR scan + inspections + work orders coming in Phase 3.</p>
      </header>

      {rows.length === 0 ? (
        <EmptyState icon={<Wrench size={32} />} title="No equipment registered yet" />
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {rows.map((r) => (
            <li key={r.item.id} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">{r.item.name}</div>
                <div className="text-xs text-slate-500">
                  {r.item.assetTag} · {r.type?.name ?? '—'} · {r.site?.name ?? 'unassigned'}
                </div>
              </div>
              <Badge variant={r.item.status === 'in_service' ? 'success' : 'warning'}>
                {r.item.status.replace('_', ' ')}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
