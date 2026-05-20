import { PageHeader, Skeleton, TableSkeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'

/**
 * Streamed loading state for /equipment.
 */
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Equipment"
            description="Assets, tools, vehicles — everything that lives on a site."
            actions={<Skeleton className="h-9 w-44" />}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-72" />
          </div>
        </>
      }
    >
      <TableSkeleton rows={10} cols={7} />
    </ListPageLayout>
  )
}
