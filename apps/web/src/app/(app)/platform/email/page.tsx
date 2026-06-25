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
export const metadata = { title: 'Platform email' }

// Authorization is enforced once by /platform/layout.tsx (super-admin only).
export default async function PlatformEmailPage() {
  const specs: EmailProviderSpecLite[] = EMAIL_PROVIDER_SPECS.map((p) => ({
    value: p.value,
    label: p.label,
    transport: p.transport,
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
          title="Platform email"
          subtitle="The deployment-wide default email provider plus the policy that governs whether tenants may use their own — including the global kill switch."
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
            <EmailSettingsForm
              scope="platform"
              action={savePlatformEmail}
              specs={specs}
              initial={{ ...platform, mode: platform.mode }}
            />
            <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Send a test through the platform provider
              </p>
              <EmailTestButton scope="platform" />
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
