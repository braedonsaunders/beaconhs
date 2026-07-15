import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { AI_PROVIDER_SPECS } from '@beaconhs/ai'
import { Button, Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { getPlatformAiSettings } from '@/lib/ai-config'
import { PageContainer } from '@/components/page-layout'
import { clearPlatformAi, savePlatformAi } from '@/lib/ai-settings-actions'
import { AiTestButton } from '@/components/ai-settings/test-button'
import { AiSettingsForm, type ProviderSpecLite } from '@/components/ai-settings/settings-form'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_08323e078472f2') }
}

// Authorization is enforced once by /platform/layout.tsx (super-admin only).
export default async function PlatformAiPage() {
  const tGenerated = await getGeneratedTranslations()
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
          title={tGenerated('m_08323e078472f2')}
          subtitle={tGenerated('m_0fe02a5368c97d')}
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
              <GeneratedValue
                value={
                  platform.hasKey ? (
                    <form action={clearPlatformAi}>
                      <Button type="submit" variant="ghost" className="text-red-600">
                        <GeneratedText id="m_03654054061f7d" />
                      </Button>
                    </form>
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
