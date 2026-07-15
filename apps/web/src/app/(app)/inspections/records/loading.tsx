import { useGeneratedTranslations } from '@/i18n/generated'
import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

/**
 * Streamed loading state for /inspections/records. Renders alongside the
 * sticky list header so the chrome doesn't jump when data arrives. Record
 * detail pages have their own DetailSkeleton in [id]/loading.tsx, so this
 * table shimmer never leaks onto them.
 */
export default function Loading() {
  const tGenerated = useGeneratedTranslations()
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_189bb91aaf5565')}
            description={tGenerated('m_074b0b12b5f20c')}
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
      <RecordsSkeleton cols={9} />
    </ListPageLayout>
  )
}
