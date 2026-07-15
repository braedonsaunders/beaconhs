import { useGeneratedTranslations } from '@/i18n/generated'
import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

// Streamed loading state for /documents/books.
export default function Loading() {
  const tGenerated = useGeneratedTranslations()
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_14e667fd8661b7')}
            description={tGenerated('m_02e3eb8a280b9a')}
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
