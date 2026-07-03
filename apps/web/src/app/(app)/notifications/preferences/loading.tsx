import { PageHeader, Skeleton } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'

// Preferences-shaped loading state so this page doesn't inherit the inbox
// skeleton from /notifications/loading.tsx (loading.tsx cascades into nested
// segments).
export default function Loading() {
  return (
    <PageContainer>
      <div className="space-y-4">
        <PageHeader
          title="Notification preferences"
          description="Choose which notification categories reach you, and on which channels. In-app delivery always lands in your inbox."
          back={{ href: '/notifications', label: 'Back to inbox' }}
        />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-xl" />
      </div>
    </PageContainer>
  )
}
