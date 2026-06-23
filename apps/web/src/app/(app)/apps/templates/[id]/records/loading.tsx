import { Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

/**
 * Streamed loading state for a Builder app's records list. Mirrors the real
 * page chrome (title + actions + filter chips) so navigation feels instant.
 * The app name is data-bound, so the title shows as a shimmer until it loads.
 */
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <div className="flex items-center justify-between gap-3 sm:items-end">
            <div className="space-y-1.5">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="hidden h-4 w-64 sm:block" />
            </div>
            <div className="flex shrink-0 gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        </>
      }
    >
      <RecordsSkeleton cols={8} />
    </ListPageLayout>
  )
}
