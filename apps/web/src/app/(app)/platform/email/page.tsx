import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { EMAIL_PROVIDER_SPECS } from '@beaconhs/emails'
import { Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { getPlatformEmailSettings } from '@/lib/email-config'
import { PageContainer } from '@/components/page-layout'
import { savePlatformEmail } from '@/lib/email-settings-actions'
import { EmailTestButton } from '@/components/email-settings/test-button'
import {
  EmailSettingsForm,
  type EmailProviderSpecLite,
} from '@/components/email-settings/settings-form'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0cf5298bd5ae73') }
}

// Authorization is enforced once by /platform/layout.tsx (super-admin only).
export default async function PlatformEmailPage() {
  const tGenerated = await getGeneratedTranslations()
  const specs: EmailProviderSpecLite[] = EMAIL_PROVIDER_SPECS.map((p) => ({
    value: p.value,
    label: p.label,
    hasSecret: p.hasSecret,
    secretLabel: p.secretLabel,
    keyHint: p.keyHint,
    secretRequired: p.secretRequired,
    fields: p.fields,
    docsHint: p.docsHint,
  }))

  const platform = await getPlatformEmailSettings()

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-4">
        <DetailHeader
          back={{ href: '/platform', label: 'Back to platform' }}
          title={tGenerated('m_0cf5298bd5ae73')}
          subtitle={tGenerated('m_0f378ad8e2b24e')}
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
            <EmailSettingsForm
              scope="platform"
              action={savePlatformEmail}
              specs={specs}
              initial={{ ...platform, mode: platform.mode }}
            />
            <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                <GeneratedText id="m_1894e8eb600feb" />
              </p>
              <EmailTestButton scope="platform" disabled={platform.mode === 'disabled'} />
              <GeneratedValue
                value={
                  platform.mode === 'disabled' ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      <GeneratedText id="m_186b423443dd47" />
                    </p>
                  ) : null
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
