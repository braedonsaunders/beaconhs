import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { AI_PROVIDER_SPECS } from '@beaconhs/ai'
import { Button, Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getAiPolicyMode, getTenantAiSettings } from '@/lib/ai-config'
import { PageContainer } from '@/components/page-layout'
import { clearTenantAi, saveTenantAi } from '@/lib/ai-settings-actions'
import { AiTestButton } from '@/components/ai-settings/test-button'
import { AiSettingsForm, type ProviderSpecLite } from '@/components/ai-settings/settings-form'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_037a53472f4289') }
}

export default async function AiSettingsPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

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

  const s = await getTenantAiSettings(ctx)
  const mode = await getAiPolicyMode()

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-4">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title={tGenerated('m_037a53472f4289')}
          subtitle={tGenerated('m_01f771b5a5af6f')}
        />
        <Card>
          <CardContent className="space-y-6 pt-6">
            <GeneratedValue
              value={
                mode === 'tenant_optional' ? (
                  <>
                    <AiSettingsForm
                      scope="tenant"
                      action={saveTenantAi}
                      specs={specs}
                      initial={{
                        enabled: s.enabled,
                        provider: s.provider,
                        modelFast: s.modelFast,
                        modelSmart: s.modelSmart,
                        baseUrl: s.baseUrl,
                        hasKey: s.hasKey,
                        autoJournalAi: s.autoJournalAi,
                      }}
                    />
                    <div className="flex items-end justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
                      <AiTestButton scope="tenant" />
                      <GeneratedValue
                        value={
                          s.hasKey ? (
                            <form action={clearTenantAi}>
                              <Button type="submit" variant="ghost" className="text-red-600">
                                <GeneratedText id="m_03654054061f7d" />
                              </Button>
                            </form>
                          ) : null
                        }
                      />
                    </div>
                  </>
                ) : (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                    <GeneratedValue
                      value={
                        mode === 'disabled' ? (
                          <GeneratedText id="m_03421cb3d5ffb5" />
                        ) : (
                          <GeneratedText id="m_0b94f9c7896ab3" />
                        )
                      }
                    />
                  </div>
                )
              }
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
