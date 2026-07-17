import { redirect } from 'next/navigation'
import { Printer } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
} from '@beaconhs/ui'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { getTenantPrintingSettings } from '@/lib/direct-printing'
import { pickString } from '@/lib/list-params'
import { savePrintingProvider } from './_actions'
import { GeneratedValue } from '@/i18n/generated'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const tGeneratedValue = await getGeneratedValueTranslations()
  return { title: tGeneratedValue('Direct printing') }
}

export default async function PrintingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')
  const [providers, sp] = await Promise.all([getTenantPrintingSettings(ctx), searchParams])
  const error = pickString(sp.error)
  const notice = pickString(sp.notice)

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title={tGeneratedValue('Direct printing')}
          subtitle={tGeneratedValue(
            'Configure the card-printer services available to this workspace. Credentials are encrypted in the database.',
          )}
        />

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
            {notice}
          </div>
        ) : null}

        <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <div className="flex gap-3">
            <Printer className="mt-0.5 shrink-0" size={18} />
            <p>
              <GeneratedValue value="Card Studio chooses the provider for each CR80 design. BeaconHS sends the rendered front and back only when that provider is enabled here. Zebra, Evolis, and HID FARGO use your organization's secured HTTPS bridge to reach locally attached printers." />
            </p>
          </div>
        </div>

        {providers.map((provider) => {
          const cardPresso = provider.provider === 'cardpresso-wps'
          return (
            <Card key={provider.provider} id={provider.provider} className="scroll-mt-6">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{provider.label}</CardTitle>
                    <CardDescription>
                      <GeneratedValue
                        value={
                          cardPresso
                            ? 'Connect directly to cardPresso Web Print Server.'
                            : 'Connect to the tenant-managed HTTPS print bridge for this SDK.'
                        }
                      />
                    </CardDescription>
                  </div>
                  <Badge variant={provider.configured ? 'success' : 'secondary'}>
                    <GeneratedValue
                      value={
                        provider.configured ? 'Ready' : provider.enabled ? 'Incomplete' : 'Disabled'
                      }
                    />
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <form action={savePrintingProvider} className="space-y-4">
                  <input type="hidden" name="provider" value={provider.provider} />
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                    <input type="checkbox" name="enabled" defaultChecked={provider.enabled} />
                    <GeneratedValue value="Enable this provider" />
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={tGeneratedValue('Service URL')} className="sm:col-span-2">
                      <Input
                        name="url"
                        type="url"
                        defaultValue={provider.url}
                        placeholder="https://printing.example.com/jobs"
                      />
                    </Field>
                    <Field label={tGeneratedValue('Printer name')}>
                      <Input name="printer" defaultValue={provider.printer} />
                    </Field>

                    {cardPresso ? (
                      <>
                        <Field label={tGeneratedValue('Basic-auth username')}>
                          <Input
                            name="basicAuthUsername"
                            defaultValue={provider.basicAuthUsername}
                          />
                        </Field>
                        <SecretField
                          name="basicAuthPassword"
                          label={tGeneratedValue('Basic-auth password')}
                          hasSecret={provider.hasBasicAuthPassword}
                          storedPlaceholder={tGeneratedValue('Stored — leave blank to keep')}
                          requiredPlaceholder={tGeneratedValue('Required when enabled')}
                        />
                        <Field label={tGeneratedValue('cardPresso login name')}>
                          <Input name="loginName" defaultValue={provider.loginName} />
                        </Field>
                        <SecretField
                          name="loginPassword"
                          label={tGeneratedValue('cardPresso login password')}
                          hasSecret={provider.hasLoginPassword}
                          storedPlaceholder={tGeneratedValue('Stored — leave blank to keep')}
                          requiredPlaceholder={tGeneratedValue('Required when enabled')}
                        />
                        <Field label={tGeneratedValue('Card document')}>
                          <Input name="cardDocument" defaultValue={provider.cardDocument} />
                        </Field>
                        <Field label={tGeneratedValue('Front image item ID')}>
                          <Input name="frontItemId" defaultValue={provider.frontItemId} />
                        </Field>
                        <Field label={tGeneratedValue('Back image item ID')}>
                          <Input name="backItemId" defaultValue={provider.backItemId} />
                        </Field>
                      </>
                    ) : (
                      <SecretField
                        name="token"
                        label={tGeneratedValue('Bridge access token')}
                        hasSecret={provider.hasToken}
                        storedPlaceholder={tGeneratedValue('Stored — leave blank to keep')}
                        requiredPlaceholder={tGeneratedValue('Required when enabled')}
                      />
                    )}
                  </div>
                  <div className="flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
                    <Button type="submit">
                      <GeneratedValue value="Save provider" />
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </PageContainer>
  )
}

function Field({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function SecretField({
  name,
  label,
  hasSecret,
  storedPlaceholder,
  requiredPlaceholder,
}: {
  name: string
  label: string
  hasSecret: boolean
  storedPlaceholder: string
  requiredPlaceholder: string
}) {
  return (
    <Field label={label}>
      <Input
        name={name}
        type="password"
        autoComplete="new-password"
        placeholder={hasSecret ? storedPlaceholder : requiredPlaceholder}
      />
      {hasSecret ? (
        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" name={`clear${name[0]?.toUpperCase()}${name.slice(1)}`} />
          <GeneratedValue value="Remove stored credential" />
        </label>
      ) : null}
    </Field>
  )
}
