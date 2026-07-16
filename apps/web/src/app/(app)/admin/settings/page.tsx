import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'
import { GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import Image from 'next/image'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { and, eq, isNotNull, notInArray } from 'drizzle-orm'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { db, hashKioskPin, normalizeKioskPin, withSuperAdmin } from '@beaconhs/db'
import { tenantUsers, tenants } from '@beaconhs/db/schema'
import { LOCALE_OPTIONS, normalizeLocalePolicy } from '@beaconhs/i18n'
import { resolveTenantLogoUrl } from '@beaconhs/storage'
import { can, resolveRegulatoryTerminology } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { levelLabel } from '@/lib/org-hierarchy'
import { appBaseUrl } from '@/lib/app-base-url'
import { PageContainer } from '@/components/page-layout'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_03121a3f188759') }
}
export const dynamic = 'force-dynamic'

const LEVELS = ['customer', 'project', 'site', 'area'] as const

// Tenant settings is admin configuration. saveSettings bypasses RLS to write
// the global tenants row, so it must self-gate (a POST endpoint isn't protected
// by the page render gate). `can` returns true for super-admins.
async function requireSettingsAdmin() {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.settings.manage')) redirect('/admin')
  return ctx
}

async function saveSettings(formData: FormData) {
  'use server'
  const ctx = await requireSettingsAdmin()
  const t = await getTranslations('TenantSettings')

  const name = String(formData.get('name') ?? '').trim()
  const slug = String(formData.get('slug') ?? '').trim()
  const defaultLanguage = String(formData.get('defaultLanguage') ?? 'en')
  const enabledLanguages = LOCALE_OPTIONS.map((l) => l.value).filter(
    (l) => formData.get(`lang_${l}`) === 'on',
  )
  const languagePolicy = normalizeLocalePolicy({
    defaultLocale: defaultLanguage,
    enabledLocales: enabledLanguages,
  })
  const hierarchy = {
    customer: formData.get('lvl_customer') === 'on',
    project: formData.get('lvl_project') === 'on',
    site: formData.get('lvl_site') === 'on',
    area: formData.get('lvl_area') === 'on',
  }
  const branding = {
    logoUrl: String(formData.get('logoUrl') ?? '').trim() || undefined,
    primaryColor: String(formData.get('primaryColor') ?? '').trim() || undefined,
    pdfLetterhead: String(formData.get('pdfLetterhead') ?? '').trim() || undefined,
  }
  const regulatoryTerminology = resolveRegulatoryTerminology({
    regulatoryTerminology: {
      authorityName: formData.get('authorityName'),
      authorityAbbreviation: formData.get('authorityAbbreviation'),
      legislationName: formData.get('legislationName'),
      legislationAbbreviation: formData.get('legislationAbbreviation'),
      otherApplicableLegislation: formData.get('otherApplicableLegislation'),
    },
  })
  const kioskPinInput = String(formData.get('kioskPin') ?? '').trim()
  const clearKioskPin = formData.get('clearKioskPin') === 'on'
  const normalizedKioskPin = kioskPinInput ? normalizeKioskPin(kioskPinInput) : null
  if (kioskPinInput && !normalizedKioskPin) {
    throw new Error(t('invalidKioskPin'))
  }

  const before = await withSuperAdmin(db, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1)
    return t
  })
  const kioskPin = clearKioskPin
    ? null
    : normalizedKioskPin
      ? await hashKioskPin(normalizedKioskPin)
      : (before?.kioskPin ?? null)

  const clearedOverrides = await withSuperAdmin(db, async (tx) => {
    await tx
      .update(tenants)
      .set({
        name: name || (before?.name ?? 'Tenant'),
        slug: slug || (before?.slug ?? 'tenant'),
        defaultLanguage: languagePolicy.defaultLocale,
        enabledLanguages: languagePolicy.enabledLocales,
        hierarchy,
        branding,
        settings: { ...(before?.settings ?? {}), regulatoryTerminology },
        kioskPin,
      })
      .where(eq(tenants.id, ctx.tenantId))
    return tx
      .update(tenantUsers)
      .set({ localeOverride: null, updatedAt: new Date() })
      .where(
        and(
          eq(tenantUsers.tenantId, ctx.tenantId),
          isNotNull(tenantUsers.localeOverride),
          notInArray(tenantUsers.localeOverride, languagePolicy.enabledLocales),
        ),
      )
      .returning({ id: tenantUsers.id })
  })

  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Tenant settings updated',
    before: before
      ? {
          name: before.name,
          slug: before.slug,
          defaultLanguage: before.defaultLanguage,
          enabledLanguages: before.enabledLanguages,
          hierarchy: before.hierarchy,
          branding: before.branding,
          regulatoryTerminology: resolveRegulatoryTerminology(before.settings),
          kioskEnabled: Boolean(before.kioskPin),
        }
      : null,
    after: {
      name,
      slug,
      defaultLanguage: languagePolicy.defaultLocale,
      enabledLanguages: languagePolicy.enabledLocales,
      hierarchy,
      branding,
      regulatoryTerminology,
      kioskEnabled: Boolean(kioskPin),
    },
    metadata: { clearedLocaleOverrides: clearedOverrides.length },
  })

  revalidatePath('/', 'layout')
}

export default async function AdminSettingsPage() {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireSettingsAdmin()
  const [t, languages] = await Promise.all([
    getTranslations('TenantSettings'),
    getTranslations('Languages'),
  ])
  const tenant = await withSuperAdmin(db, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1)
    return t
  })
  if (!tenant) return null

  const enabled = new Set(tenant.enabledLanguages)
  const hierarchy = tenant.hierarchy
  const regulatory = resolveRegulatoryTerminology(tenant.settings)
  const kioskUrl = tenant.kioskPin ? `${appBaseUrl()}/kiosk?t=${tenant.slug}` : null
  const tenantLogoUrl = await resolveTenantLogoUrl({
    tenantId: tenant.id,
    logoUrl: tenant.branding.logoUrl,
  })

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: t('backToAdmin') }}
          title={tGeneratedValue(t('title'))}
          subtitle={tGeneratedValue(t('subtitle'))}
        />

        <form action={saveSettings} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedValue value={t('identity')} />
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={tGeneratedValue(t('name'))}>
                <Input name="name" defaultValue={tenant.name} />
              </Field>
              <Field label={tGeneratedValue(t('slug'))}>
                <Input name="slug" defaultValue={tenant.slug} className="font-mono" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedValue value={t('regulatoryTerminology')} />
              </CardTitle>
              <CardDescription>
                <GeneratedValue value={t('regulatoryTerminologyDescription')} />
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={tGeneratedValue(t('authorityName'))}>
                <Input
                  name="authorityName"
                  required
                  maxLength={160}
                  defaultValue={regulatory.authorityName}
                />
              </Field>
              <Field label={tGeneratedValue(t('authorityAbbreviation'))}>
                <Input
                  name="authorityAbbreviation"
                  required
                  maxLength={24}
                  defaultValue={regulatory.authorityAbbreviation}
                />
              </Field>
              <Field label={tGeneratedValue(t('legislationName'))}>
                <Input
                  name="legislationName"
                  required
                  maxLength={200}
                  defaultValue={regulatory.legislationName}
                />
              </Field>
              <Field label={tGeneratedValue(t('legislationAbbreviation'))}>
                <Input
                  name="legislationAbbreviation"
                  required
                  maxLength={24}
                  defaultValue={regulatory.legislationAbbreviation}
                />
              </Field>
              <Field
                label={tGeneratedValue(t('otherApplicableLegislation'))}
                className="sm:col-span-2"
              >
                <Textarea
                  name="otherApplicableLegislation"
                  rows={3}
                  maxLength={2000}
                  defaultValue={regulatory.otherApplicableLegislation}
                  placeholder={tGeneratedValue(t('otherApplicableLegislationPlaceholder'))}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedValue value={t('peopleKiosk')} />
              </CardTitle>
              <CardDescription>
                <GeneratedValue value={t('peopleKioskDescription')} />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label={tGeneratedValue(t('kioskPin'))} className="max-w-xs">
                <Input
                  name="kioskPin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4,12}"
                  maxLength={12}
                  placeholder={tGeneratedValue(
                    tenant.kioskPin ? t('keepKioskPin') : t('kioskPinExample'),
                  )}
                  className="font-mono tracking-widest"
                />
                <GeneratedValue
                  value={
                    tenant.kioskPin ? (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedValue value={t('kioskConfigured')} />
                      </p>
                    ) : null
                  }
                />
              </Field>
              <GeneratedValue
                value={
                  tenant.kioskPin ? (
                    <label className="flex max-w-xs items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <input
                        type="checkbox"
                        name="clearKioskPin"
                        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <GeneratedValue value={t('disableKiosk')} />
                    </label>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  kioskUrl ? (
                    <div className="max-w-xl rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
                      <code className="block truncate font-mono text-xs text-slate-600 dark:text-slate-300">
                        {kioskUrl}
                      </code>
                    </div>
                  ) : null
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedValue value={t('branding')} />
              </CardTitle>
              <CardDescription>
                <GeneratedValue value={t('brandingDescription')} />
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={tGeneratedValue(t('logoUrl'))}>
                <Input
                  name="logoUrl"
                  defaultValue={tenant.branding.logoUrl ?? ''}
                  placeholder="https://…"
                />
              </Field>
              <Field label={tGeneratedValue(t('primaryColor'))}>
                <Input
                  name="primaryColor"
                  defaultValue={tenant.branding.primaryColor ?? ''}
                  placeholder={tGenerated('m_15e421af604eae')}
                />
              </Field>
              <Field label={tGeneratedValue(t('pdfLetterhead'))} className="sm:col-span-2">
                <Input
                  name="pdfLetterhead"
                  defaultValue={tenant.branding.pdfLetterhead ?? ''}
                  placeholder={tGenerated('m_0a8cab85b1e5ec')}
                />
              </Field>
              <GeneratedValue
                value={
                  tenantLogoUrl ? (
                    <div className="sm:col-span-2">
                      <Label className="text-xs">
                        <GeneratedValue value={t('preview')} />
                      </Label>
                      <div className="mt-1 flex items-center gap-3 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                        <Image
                          src={tenantLogoUrl}
                          alt=""
                          width={160}
                          height={32}
                          unoptimized
                          className="h-8 w-auto"
                        />
                        <span
                          className="font-semibold"
                          style={{ color: tenant.branding.primaryColor ?? '#0f766e' }}
                        >
                          <GeneratedValue value={tenant.name} />
                        </span>
                      </div>
                    </div>
                  ) : null
                }
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedValue value={t('languages')} />
              </CardTitle>
              <CardDescription>
                <GeneratedValue value={t('languagesDescription')} />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <GeneratedValue
                  value={LOCALE_OPTIONS.map((l) => (
                    <label
                      key={l.value}
                      className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                    >
                      <input
                        type="checkbox"
                        name={`lang_${l.value}`}
                        defaultChecked={enabled.has(l.value)}
                      />
                      <GeneratedValue value={languages(l.value)} />
                    </label>
                  ))}
                />
              </div>
              <Field label={tGeneratedValue(t('defaultLanguage'))}>
                <Select
                  name="defaultLanguage"
                  defaultValue={tenant.defaultLanguage}
                  className="h-10 w-32 pl-3 text-sm"
                >
                  {LOCALE_OPTIONS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {languages(l.value)}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={t('defaultLanguageHelp')} />
                </p>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedValue value={t('hierarchyDepth')} />
              </CardTitle>
              <CardDescription>
                <GeneratedValue value={t('hierarchyDescription')} />
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <GeneratedValue
                value={LEVELS.map((lvl) => (
                  <label
                    key={lvl}
                    className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                  >
                    <input type="checkbox" name={`lvl_${lvl}`} defaultChecked={hierarchy[lvl]} />
                    <GeneratedValue value={levelLabel(lvl)} />
                  </label>
                ))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedValue value={t('riskMatrix')} />
              </CardTitle>
              <CardDescription>
                <GeneratedValue value={t('riskMatrixDescription')} />
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                <GeneratedValue value={t('riskMatrixBody')} />
                <GeneratedValue value={' '} />
                <Link
                  href="/hazard-assessments/risk-matrix"
                  className="font-medium text-teal-700 hover:underline dark:text-teal-300"
                >
                  <GeneratedValue value={t('riskMatrixLink')} />
                </Link>
                .
              </p>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit">
              <GeneratedValue value={t('saveSettings')} />
            </Button>
          </div>
        </form>
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
      <Label>
        <GeneratedValue value={label} />
      </Label>
      <GeneratedValue value={children} />
    </div>
  )
}
