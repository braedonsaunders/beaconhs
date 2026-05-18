import { BookOpen } from 'lucide-react'
import { EmptyState } from '@beaconhs/ui'

export const metadata = { title: 'Documents' }

export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Documents</h1>
      <p className="text-sm text-slate-500">
        Versioned library, read-and-acknowledge, periodic review, management review books.
      </p>
      <EmptyState icon={<BookOpen size={32} />} title="Documents module scaffolded" />
    </div>
  )
}
