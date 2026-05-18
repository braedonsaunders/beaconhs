import { GraduationCap } from 'lucide-react'
import { EmptyState } from '@beaconhs/ui'

export const metadata = { title: 'Training' }

export default function TrainingPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Training</h1>
      <p className="text-sm text-slate-500">
        Course catalogue, classes, individual records, training matrix, and certificate verification
        come online in Phase 3.
      </p>
      <EmptyState
        icon={<GraduationCap size={32} />}
        title="Training module scaffolded"
        description="Schema is in place. Build the course/class/record screens next."
      />
    </div>
  )
}
