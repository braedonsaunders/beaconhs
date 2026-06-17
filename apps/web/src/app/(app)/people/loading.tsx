import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

/**
 * Streamed loading state for /people.
 */
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="People"
            description="Workers, contractors, and visitors tied to this tenant."
            actions={<Skeleton className="h-9 w-32" />}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-72" />
          </div>
        </>
      }
    >
      <RecordsSkeleton cols={6} />
    </ListPageLayout>
  )
}
