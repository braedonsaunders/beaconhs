import { PageHeader, Skeleton, TableSkeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'

/**
 * Streamed loading state for /hazard-assessments (JSHA / Hazard Identification).
 */
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Hazard Assessments"
            description="Job-safety analyses, hazard registers, and field assessments."
            actions={<Skeleton className="h-9 w-40" />}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-72" />
          </div>
        </>
      }
    >
      <TableSkeleton rows={10} cols={6} />
    </ListPageLayout>
  )
}
