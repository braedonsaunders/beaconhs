import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

/**
 * Streamed loading state for /my/incidents. Mirrors the real page chrome so
 * navigation feels instant — the title appears before the DB-bound table.
 */
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title="My incidents"
            description="Incidents you reported."
            actions={<Skeleton className="h-9 w-56" />}
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
      <RecordsSkeleton cols={7} />
    </ListPageLayout>
  )
}
