import { useGeneratedTranslations } from '@/i18n/generated'
import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

// Streamed loading state for /documents/management-reviews.
export default function Loading() {
  const tGenerated = useGeneratedTranslations()
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_0058e514601039')}
            description={tGenerated('m_10e633a076d44d')}
            actions={<Skeleton className="h-9 w-28" />}
          />
        </>
      }
    >
      <RecordsSkeleton cols={5} />
    </ListPageLayout>
  )
}
