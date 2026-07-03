import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

/**
 * Streamed loading state for the /ppe register. Renders alongside the sticky
 * list header so the chrome doesn't jump when data arrives. Detail-shaped
 * segments ([id], types/[id], banks/[id]) ship their own DetailSkeleton so
 * this table shimmer never leaks onto them.
 */
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="PPE"
            description="Issue, inspect, and track PPE through its lifecycle."
            actions={<Skeleton className="h-9 w-40" />}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-72" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-7 w-full max-w-2xl" />
          </div>
        </>
      }
    >
      <RecordsSkeleton cols={8} />
    </ListPageLayout>
  )
}
