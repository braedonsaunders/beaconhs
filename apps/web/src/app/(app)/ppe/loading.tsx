import { useGeneratedTranslations } from '@/i18n/generated'
import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

/**
 * Streamed loading state for the /ppe register. Renders alongside the sticky
 * list header so the chrome doesn't jump when data arrives. Detail-shaped
 * segments ([id], types/[id], banks/[id]) ship their own DetailSkeleton so
 * this table shimmer never leaks onto them.
 */
export default function Loading() {
  const tGenerated = useGeneratedTranslations()
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_18391e161b9ed6')}
            description={tGenerated('m_1b88ed46c964ad')}
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
      <RecordsSkeleton cols={8} />
    </ListPageLayout>
  )
}
