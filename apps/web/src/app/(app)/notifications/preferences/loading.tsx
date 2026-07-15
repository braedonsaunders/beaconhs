import { useGeneratedTranslations } from '@/i18n/generated'
import { PageHeader, Skeleton } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'

// Preferences-shaped loading state so this page doesn't inherit the inbox
// skeleton from /notifications/loading.tsx (loading.tsx cascades into nested
// segments).
export default function Loading() {
  const tGenerated = useGeneratedTranslations()
  return (
    <PageContainer>
      <div className="space-y-4">
        <PageHeader
          title={tGenerated('m_187c665fb0445c')}
          description={tGenerated('m_0ca583c9496c13')}
          back={{ href: '/notifications', label: 'Back to inbox' }}
        />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </PageContainer>
  )
}
