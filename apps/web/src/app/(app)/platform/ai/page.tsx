import { AI_PROVIDER_SPECS } from '@beaconhs/ai'
import { Button, Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { getPlatformAiSettings } from '@/lib/ai-config'
import { PageContainer } from '@/components/page-layout'
import { clearPlatformAi, savePlatformAi } from '@/lib/ai-settings-actions'
import { AiTestButton } from '@/components/ai-settings/test-button'
import { AiSettingsForm, type ProviderSpecLite } from '@/components/ai-settings/settings-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Platform AI' }

// Authorization is enforced once by /platform/layout.tsx (super-admin only).
export default async function PlatformAiPage() {
  const specs: ProviderSpecLite[] = AI_PROVIDER_SPECS.map((p) => ({
    value: p.value,
    label: p.label,
    baseUrl: p.baseUrl,
    requiresBaseUrl: p.requiresBaseUrl,
    fast: p.fast,
    smart: p.smart,
    keyHint: p.keyHint,
    modelHint: p.modelHint,
  }))

  const platform = await getPlatformAiSettings()

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-4">
        <DetailHeader
          back={{ href: '/platform', label: 'Back to platform' }}
          title="Platform AI"
          subtitle="The deployment-wide default AI provider plus the policy that governs whether tenants may use their own — including the global kill switch."
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
            <AiSettingsForm
              scope="platform"
              action={savePlatformAi}
              specs={specs}
              initial={{
                enabled: platform.enabled,
                provider: platform.provider,
                modelFast: platform.modelFast,
                modelSmart: platform.modelSmart,
                baseUrl: platform.baseUrl,
                hasKey: platform.hasKey,
                mode: platform.mode,
              }}
            />
            <div className="flex items-end justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
              <AiTestButton scope="platform" />
              {platform.hasKey ? (
                <form action={clearPlatformAi}>
                  <Button type="submit" variant="ghost" className="text-red-600">
                    Remove key
                  </Button>
                </form>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
