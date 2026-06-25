import Link from 'next/link'
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
export const metadata = { title: 'AI settings' }

export default async function AiSettingsPage() {
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
          title="AI settings"
          subtitle="This tenant's AI provider, models and encrypted key. The platform-wide default and policy are set by your platform administrator."
        />
        <Card>
          <CardContent className="space-y-6 pt-6">
            {mode === 'tenant_optional' ? (
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
                  {s.hasKey ? (
                    <form action={clearTenantAi}>
                      <Button type="submit" variant="ghost" className="text-red-600">
                        Remove key
                      </Button>
                    </form>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                {mode === 'disabled'
                  ? 'AI is currently disabled across the whole platform by your administrator.'
                  : 'AI is managed centrally by your platform administrator — all tenants use the platform default provider.'}
              </div>
            )}
          </CardContent>
        </Card>

        {ctx.isSuperAdmin ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Platform-wide AI defaults &amp; policy live in{' '}
            <Link
              href="/platform/ai"
              className="font-medium text-teal-700 hover:underline dark:text-teal-300"
            >
              Platform → AI
            </Link>
            .
          </p>
        ) : null}
      </div>
    </PageContainer>
  )
}
