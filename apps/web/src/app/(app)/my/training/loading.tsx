import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

/**
 * Streamed loading state for /my/training. Mirrors the real page chrome —
 * header plus tab strip — so navigation feels instant.
 */
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title="My training"
            description="Your courses, records, upcoming expirations, and outstanding assignments."
            actions={<Skeleton className="h-9 w-40" />}
          />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-28" />
            ))}
          </div>
        </>
      }
    >
      <RecordsSkeleton cols={6} />
    </ListPageLayout>
  )
}
