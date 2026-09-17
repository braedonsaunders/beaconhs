import { getTranslations } from 'next-intl/server'
import { Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { getPlatformFeedbackSettings } from '@/lib/feedback-config'
import { PlatformFeedbackForm } from './_form'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('Feedback')
  return { title: t('settingsTitle') }
}

export default async function PlatformFeedbackPage() {
  const t = await getTranslations('Feedback')
  const settings = await getPlatformFeedbackSettings()

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-4">
        <DetailHeader
          back={{ href: '/platform', label: 'Back to platform' }}
          title={t('settingsTitle')}
          subtitle={t('settingsSubtitle')}
        />
        <Card>
          <CardContent className="pt-6">
            <PlatformFeedbackForm settings={settings} />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
