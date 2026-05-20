import { PageHeader, Skeleton, TableSkeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'

/**
 * Streamed loading state for /corrective-actions. Mirrors the real page
 * chrome so navigation feels instant — the title and action row appear
 * before the DB-bound table arrives.
 */
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Corrective actions"
            description="Tasks to fix problems, address findings, and prevent recurrence."
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
      <TableSkeleton rows={10} cols={7} />
    </ListPageLayout>
  )
}
