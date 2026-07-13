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
export const metadata = { title: 'Email settings' }

export default async function EmailSettingsPage() {
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
          title="Email"
          subtitle="This tenant's email provider, sender and encrypted credentials. The platform-wide default and policy are set by your platform administrator."
        />
        <NotificationsSubNav active="email" showBack={false} />

        <Card>
          <CardContent className="space-y-6 pt-6">
            {mode === 'tenant_optional' ? (
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
                      Send a test through this tenant&rsquo;s provider
                    </p>
                    <EmailTestButton scope="tenant" />
                  </div>
                  {tenant.hasKey ? (
                    <form action={clearTenantEmail}>
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
                  ? 'Email sending is currently disabled across the whole platform by your administrator.'
                  : 'Email is managed centrally by your platform administrator — all tenants send through the platform default provider.'}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
