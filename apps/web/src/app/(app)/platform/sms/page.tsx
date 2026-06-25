import { SMS_PROVIDER_SPECS } from '@beaconhs/sms'
import { Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { getPlatformSmsSettings } from '@/lib/sms-config'
import { PageContainer } from '@/components/page-layout'
import { savePlatformSms } from '@/lib/sms-settings-actions'
import { SmsTestButton } from '@/components/sms-settings/test-button'
import { SmsSettingsForm, type SmsProviderSpecLite } from '@/components/sms-settings/settings-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Platform SMS' }

// Authorization is enforced once by /platform/layout.tsx (super-admin only).
export default async function PlatformSmsPage() {
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
          title="Platform SMS"
          subtitle="The deployment-wide default SMS provider plus the policy that governs whether tenants may use their own — including the global kill switch."
        />

        <Card>
          <CardContent className="space-y-6 pt-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Platform default — all tenants
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                The fallback provider used when a tenant has none, and the policy that governs
                tenant overrides and the global kill switch.
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
                Send a test through the platform provider
              </p>
              <SmsTestButton scope="platform" />
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
