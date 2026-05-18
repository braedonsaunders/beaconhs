import { HardHat } from 'lucide-react'
import { EmptyState } from '@beaconhs/ui'

export const metadata = { title: 'PPE' }

export default function PpePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">PPE</h1>
      <p className="text-sm text-slate-500">
        Issue, return, replace, discard — plus scheduled inspections for inspectable PPE.
      </p>
      <EmptyState icon={<HardHat size={32} />} title="PPE module scaffolded" description="ppe_types, ppe_items, ppe_issues are ready." />
    </div>
  )
}
