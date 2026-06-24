import { redirect } from 'next/navigation'
import { AI_PROVIDER_SPECS } from '@beaconhs/ai'
import { Button, Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiSettings } from '@/lib/ai-config'
import { PageContainer } from '@/components/page-layout'
import { clearAiKey, saveAiSettings } from './_actions'
import { AiTestButton } from './_test-button'
import { AiSettingsForm, type ProviderSpecLite } from './_settings-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'AI settings' }

export default async function AiSettingsPage() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')
  const s = await getTenantAiSettings(ctx)
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

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-4">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="AI settings"
          subtitle="Provider, models and API key for this tenant. The key is encrypted at rest — nothing AI-related lives in the environment."
        />
        <Card>
          <CardContent className="space-y-6 pt-6">
            <AiSettingsForm
              action={saveAiSettings}
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
              <AiTestButton />
              {s.hasKey ? (
                <form action={clearAiKey}>
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
