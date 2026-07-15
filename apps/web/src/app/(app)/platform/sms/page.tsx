import { GeneratedText } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { SMS_PROVIDER_SPECS } from '@beaconhs/sms'
import { Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { getPlatformSmsSettings } from '@/lib/sms-config'
import { PageContainer } from '@/components/page-layout'
import { savePlatformSms } from '@/lib/sms-settings-actions'
import { SmsTestButton } from '@/components/sms-settings/test-button'
import { SmsSettingsForm, type SmsProviderSpecLite } from '@/components/sms-settings/settings-form'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_053d737e4723e1') }
}

// Authorization is enforced once by /platform/layout.tsx (super-admin only).
export default async function PlatformSmsPage() {
  const tGenerated = await getGeneratedTranslations()
  const specs: SmsProviderSpecLite[] = SMS_PROVIDER_SPECS.map((p) => ({
    value: p.value,
    label: p.label,
    hasSecret: p.hasSecret,
    secretLabel: p.secretLabel,
    keyHint: p.keyHint,
    secretRequired: p.secretRequired,
    fields: p.fields,
    docsHint: p.docsHint,
  }))

  const platform = await getPlatformSmsSettings()

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-4">
        <DetailHeader
          back={{ href: '/platform', label: 'Back to platform' }}
          title={tGenerated('m_053d737e4723e1')}
          subtitle={tGenerated('m_15b148a1984169')}
        />

        <Card>
          <CardContent className="space-y-6 pt-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                <GeneratedText id="m_066667acd671a3" />
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_13275506e08cf4" />
              </p>
            </div>
            <SmsSettingsForm
              scope="platform"
              action={savePlatformSms}
              specs={specs}
              initial={{ ...platform, mode: platform.mode }}
            />
            <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                <GeneratedText id="m_1894e8eb600feb" />
              </p>
              <SmsTestButton scope="platform" />
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
