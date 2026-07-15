import { useGeneratedTranslations } from '@/i18n/generated'
import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

/**
 * Streamed loading state for /equipment.
 */
export default function Loading() {
  const tGenerated = useGeneratedTranslations()
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_17f17df74f7e69')}
            description={tGenerated('m_10c9f7b796bbeb')}
            actions={<Skeleton className="h-9 w-44" />}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-72" />
          </div>
        </>
      }
    >
      <RecordsSkeleton cols={7} />
    </ListPageLayout>
  )
}
