import { ShieldCheck } from 'lucide-react'
import { EmptyState } from '@beaconhs/ui'

export const metadata = { title: 'Confined Space' }

export default function ConfinedSpacePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Confined Space</h1>
      <p className="text-sm text-slate-500">
        Entry permits, atmospheric readings, rescue plans. First-class because of the permit
        lifecycle and out-of-spec alarming.
      </p>
      <EmptyState
        icon={<ShieldCheck size={32} />}
        title="Confined Space module scaffolded"
        description="cs_permits and cs_atmospheric_readings are ready."
      />
    </div>
  )
}
