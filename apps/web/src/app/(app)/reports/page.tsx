import { FileText } from 'lucide-react'
import { EmptyState } from '@beaconhs/ui'

export const metadata = { title: 'Reports' }

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <p className="text-sm text-slate-500">
        Pre-built reports + simple custom report builder. Schedule by subscription, distribution
        list, or event trigger. PDF + Excel exports.
      </p>
      <EmptyState
        icon={<FileText size={32} />}
        title="Reports come online in Phase 4"
        description="Saved report definitions, scheduled runs, and event-triggered reports."
      />
    </div>
  )
}
