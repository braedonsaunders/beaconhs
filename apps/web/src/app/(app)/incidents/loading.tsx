import { PageHeader, TableSkeleton } from '@beaconhs/ui'
import { Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'

/**
 * Streamed loading state for /incidents. Renders alongside the sticky list
 * header so the chrome doesn't jump when data arrives. The shimmer rows
 * give the page a sense of motion while the Server Component awaits its DB
 * round-trip.
 */
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Incidents"
            description="Reports, investigations, and closeouts."
            actions={<Skeleton className="h-9 w-44" />}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-72" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-7 w-full max-w-2xl" />
            <Skeleton className="h-7 w-full max-w-2xl" />
          </div>
        </>
      }
    >
      <TableSkeleton rows={10} cols={7} />
    </ListPageLayout>
  )
}
