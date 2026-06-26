import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
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
} from '@beaconhs/ui'
import { db, hashKioskPin, normalizeKioskPin, withSuperAdmin } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { levelLabel } from '@/lib/org-hierarchy'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Tenant settings' }
export const dynamic = 'force-dynamic'

const KNOWN_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
]
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

  const name = String(formData.get('name') ?? '').trim()
  const slug = String(formData.get('slug') ?? '').trim()
  const defaultLanguage = String(formData.get('defaultLanguage') ?? 'en')
  const enabledLanguages = KNOWN_LANGUAGES.map((l) => l.value).filter(
    (l) => formData.get(`lang_${l}`) === 'on',
  )
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
  const kioskPinInput = String(formData.get('kioskPin') ?? '').trim()
  const clearKioskPin = formData.get('clearKioskPin') === 'on'
  const normalizedKioskPin = kioskPinInput ? normalizeKioskPin(kioskPinInput) : null
  if (kioskPinInput && !normalizedKioskPin) {
    throw new Error('Kiosk PIN must be 4–12 digits.')
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

  await withSuperAdmin(db, async (tx) => {
    await tx
      .update(tenants)
      .set({
        name: name || (before?.name ?? 'Tenant'),
        slug: slug || (before?.slug ?? 'tenant'),
        defaultLanguage,
        enabledLanguages: enabledLanguages.length > 0 ? enabledLanguages : ['en'],
        hierarchy,
        branding,
        kioskPin,
      })
      .where(eq(tenants.id, ctx.tenantId))
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
          kioskEnabled: Boolean(before.kioskPin),
        }
      : null,
    after: {
      name,
      slug,
      defaultLanguage,
      enabledLanguages,
      hierarchy,
      branding,
      kioskEnabled: Boolean(kioskPin),
    },
  })

  revalidatePath('/', 'layout')
}

export default async function AdminSettingsPage() {
  const ctx = await requireSettingsAdmin()
  const tenant = await withSuperAdmin(db, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1)
    return t
  })
  if (!tenant) return null

  const enabled = new Set(tenant.enabledLanguages)
  const hierarchy = tenant.hierarchy
  const kioskUrl = tenant.kioskPin ? `${process.env.APP_URL ?? ''}/kiosk?t=${tenant.slug}` : null

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="Tenant settings"
          subtitle="Branding, languages, and hierarchy depth"
        />

        <form action={saveSettings} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Identity</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input name="name" defaultValue={tenant.name} />
              </Field>
              <Field label="Slug">
                <Input name="slug" defaultValue={tenant.slug} className="font-mono" />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>People kiosk</CardTitle>
              <CardDescription>
                Shared-tablet sign-in/out is gated by a write-only PIN.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Kiosk PIN (4–12 digits)" className="max-w-xs">
                <Input
                  name="kioskPin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4,12}"
                  maxLength={12}
                  placeholder={tenant.kioskPin ? 'Leave blank to keep current PIN' : 'e.g. 4821'}
                  className="font-mono tracking-widest"
                />
                {tenant.kioskPin ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    A PIN is configured. Enter a new PIN to rotate it.
                  </p>
                ) : null}
              </Field>
              {tenant.kioskPin ? (
                <label className="flex max-w-xs items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    name="clearKioskPin"
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  Disable public people kiosk
                </label>
              ) : null}
              {kioskUrl ? (
                <div className="max-w-xl rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900">
                  <code className="block truncate font-mono text-xs text-slate-600 dark:text-slate-300">
                    {kioskUrl}
                  </code>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Branding</CardTitle>
              <CardDescription>Shows in the app shell + on PDF outputs.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Logo URL">
                <Input
                  name="logoUrl"
                  defaultValue={tenant.branding.logoUrl ?? ''}
                  placeholder="https://…"
                />
              </Field>
              <Field label="Primary color (hex)">
                <Input
                  name="primaryColor"
                  defaultValue={tenant.branding.primaryColor ?? ''}
                  placeholder="#0f766e"
                />
              </Field>
              <Field label="PDF letterhead text" className="sm:col-span-2">
                <Input
                  name="pdfLetterhead"
                  defaultValue={tenant.branding.pdfLetterhead ?? ''}
                  placeholder="Acme Industrial · Health & Safety"
                />
              </Field>
              {tenant.branding.logoUrl ? (
                <div className="sm:col-span-2">
                  <Label className="text-xs">Preview</Label>
                  <div className="mt-1 flex items-center gap-3 rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <img src={tenant.branding.logoUrl} alt="" className="h-8" />
                    <span
                      className="font-semibold"
                      style={{ color: tenant.branding.primaryColor ?? '#0f766e' }}
                    >
                      {tenant.name}
                    </span>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Languages</CardTitle>
              <CardDescription>Which languages users can pick.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                {KNOWN_LANGUAGES.map((l) => (
                  <label
                    key={l.value}
                    className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                  >
                    <input
                      type="checkbox"
                      name={`lang_${l.value}`}
                      defaultChecked={enabled.has(l.value)}
                    />
                    {l.label}
                  </label>
                ))}
              </div>
              <Field label="Default language">
                <Select
                  name="defaultLanguage"
                  defaultValue={tenant.defaultLanguage}
                  className="h-10 w-32 pl-3 text-sm"
                >
                  {KNOWN_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Hierarchy depth</CardTitle>
              <CardDescription>Toggle the levels used in this tenant's org tree.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {LEVELS.map((lvl) => (
                <label
                  key={lvl}
                  className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
                >
                  <input type="checkbox" name={`lvl_${lvl}`} defaultChecked={hierarchy[lvl]} />
                  {levelLabel(lvl)}
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Risk matrix</CardTitle>
              <CardDescription>Configured per module.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                The severity × likelihood scale, risk bands and colours used to score hazard
                assessments are edited in{' '}
                <Link
                  href="/hazard-assessments/risk-matrix"
                  className="font-medium text-teal-700 hover:underline dark:text-teal-300"
                >
                  Hazard Assessments → Manage → Risk matrix
                </Link>
                .
              </p>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit">Save settings</Button>
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
      <Label>{label}</Label>
      {children}
    </div>
  )
}
