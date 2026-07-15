import { useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'
import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

/**
 * Streamed loading state for /my/training. Mirrors the real page chrome —
 * header plus tab strip — so navigation feels instant.
 */
export default function Loading() {
  const tGenerated = useGeneratedTranslations()
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title={tGenerated('m_1eac86f811af44')}
            description={tGenerated('m_146848d60c1c35')}
            actions={<Skeleton className="h-9 w-40" />}
          />
          <div className="flex flex-wrap gap-2">
            <GeneratedValue
              value={Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-28" />
              ))}
            />
          </div>
        </>
      }
    >
      <RecordsSkeleton cols={6} />
    </ListPageLayout>
  )
}
