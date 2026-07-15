import { useGeneratedTranslations } from '@/i18n/generated'
import { PageHeader, Skeleton } from '@beaconhs/ui'
import { ListPageLayout } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

/**
 * Streamed loading state for /my/tasks. Mirrors the real page chrome so
 * navigation feels instant — the title appears before the DB-bound table.
 */
export default function Loading() {
  const tGenerated = useGeneratedTranslations()
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title={tGenerated('m_143f41f9fb0bed')}
            description={tGenerated('m_03fda3c0adc42a')}
            actions={<Skeleton className="h-9 w-44" />}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-9 w-40" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-7 w-full max-w-2xl" />
          </div>
        </>
      }
    >
      <RecordsSkeleton cols={6} />
    </ListPageLayout>
  )
}
