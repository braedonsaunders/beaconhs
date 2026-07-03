import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

/**
 * Streamed loading state for /tools/safe-distance. Mirrors the real page
 * chrome so navigation feels instant — the title appears before the DB-bound
 * table.
 */
export default function Loading() {
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Safe Distance"
            description="Pneumatic pressure-test stand-off — NASA-Glenn, ASME PCC-2, and Lloyd's Register."
            back={{ href: '/tools', label: 'All tools' }}
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
      <RecordsSkeleton cols={7} />
    </ListPageLayout>
  )
}
