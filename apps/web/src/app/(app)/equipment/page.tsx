import { Wrench } from 'lucide-react'
import { EmptyState } from '@beaconhs/ui'

export const metadata = { title: 'Equipment' }

export default function EquipmentPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Equipment</h1>
      <p className="text-sm text-slate-500">Asset registry, QR scan, inspections, and work orders.</p>
      <EmptyState
        icon={<Wrench size={32} />}
        title="Equipment module scaffolded"
        description="Schema in place: equipment_items, equipment_location_history, equipment_work_orders."
      />
    </div>
  )
}
