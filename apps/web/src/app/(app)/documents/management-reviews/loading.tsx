import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

// Streamed loading state for /documents/management-reviews.
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Management reviews"
            description="Annual / scheduled board reviews of the SH&S management system."
            actions={<Skeleton className="h-9 w-28" />}
          />
        </>
      }
    >
      <RecordsSkeleton cols={5} />
    </ListPageLayout>
  )
}
