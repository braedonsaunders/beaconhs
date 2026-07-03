import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

// Streamed loading state for /documents/books.
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Document books"
            description="Curated, ordered bundles of documents that publish as a single PDF."
            actions={<Skeleton className="h-9 w-28" />}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-72" />
          </div>
        </>
      }
    >
      <RecordsSkeleton cols={5} />
    </ListPageLayout>
  )
}
