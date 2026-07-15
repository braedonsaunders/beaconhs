import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { EMAIL_PROVIDER_SPECS } from '@beaconhs/emails'
import { Button, Card, CardContent, DetailHeader } from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getEmailPolicyMode, getTenantEmailSettings } from '@/lib/email-config'
import { PageContainer } from '@/components/page-layout'
import { NotificationsSubNav } from '@/components/notifications-sub-nav'
import { clearTenantEmail, saveTenantEmail } from '@/lib/email-settings-actions'
import { EmailTestButton } from '@/components/email-settings/test-button'
import {
  EmailSettingsForm,
  type EmailProviderSpecLite,
} from '@/components/email-settings/settings-form'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_03f0b995732567') }
}

export default async function EmailSettingsPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

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

  const tenant = await getTenantEmailSettings(ctx)
  const mode = await getEmailPolicyMode()

  return (
    <PageContainer>
      <div className="max-w-2xl space-y-4">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title={tGenerated('m_00a0ba9938bdff')}
          subtitle={tGenerated('m_0d7800fba75a0b')}
        />
        <NotificationsSubNav active="email" showBack={false} />

        <Card>
          <CardContent className="space-y-6 pt-6">
            <GeneratedValue
              value={
                mode === 'tenant_optional' ? (
                  <>
                    <EmailSettingsForm
                      scope="tenant"
                      action={saveTenantEmail}
                      specs={specs}
                      initial={tenant}
                    />
                    <div className="flex items-end justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                      <div className="flex-1 space-y-2">
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                          <GeneratedText id="m_02926c12ed3242" />
                        </p>
                        <EmailTestButton scope="tenant" />
                      </div>
                      <GeneratedValue
                        value={
                          tenant.hasKey ? (
                            <form action={clearTenantEmail}>
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
                          <GeneratedText id="m_05e0d077c8bff5" />
                        ) : (
                          <GeneratedText id="m_16a9846ccfea11" />
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
