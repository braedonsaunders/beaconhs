import { PageHeader } from '@beaconhs/ui'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { PageContainer } from '@/components/page-layout'
import { AppTypePicker } from './_app-type-picker'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a050bcb668962') }
}

export default async function NewTemplatePage() {
  const tGeneratedValue = await getGeneratedValueTranslations()
  return (
    <PageContainer>
      <div className="mx-auto max-w-4xl space-y-6">
        <PageHeader
          title={tGeneratedValue('Create app')}
          description={tGeneratedValue(
            'Choose one starting point, name the app, and continue into the designer.',
          )}
          back={{ href: '/apps', label: 'Back to Builder' }}
        />
        <AppTypePicker />
      </div>
    </PageContainer>
  )
}
