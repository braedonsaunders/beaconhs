import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
import { db } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Tenant settings' }
export const dynamic = 'force-dynamic'

const KNOWN_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
]
const LEVELS = ['customer', 'project', 'site', 'area'] as const

async function saveSettings(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()

  const name = String(formData.get('name') ?? '').trim()
  const slug = String(formData.get('slug') ?? '').trim()
  const defaultLanguage = String(formData.get('defaultLanguage') ?? 'en')
  const enabledLanguages = KNOWN_LANGUAGES
    .map((l) => l.value)
    .filter((l) => formData.get(`lang_${l}`) === 'on')
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

  const before = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1)
    return t
  })

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    await tx
      .update(tenants)
      .set({
        name: name || (before?.name ?? 'Tenant'),
        slug: slug || (before?.slug ?? 'tenant'),
        defaultLanguage,
        enabledLanguages: enabledLanguages.length > 0 ? enabledLanguages : ['en'],
        hierarchy,
        branding,
      })
      .where(eq(tenants.id, ctx.tenantId))
  })

  await recordAudit(ctx, {
    entityType: 'tenant',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Tenant settings updated',
    before: before as unknown as Record<string, unknown>,
    after: { name, slug, defaultLanguage, enabledLanguages, hierarchy, branding },
  })

  revalidatePath('/', 'layout')
}

export default async function AdminSettingsPage() {
  const ctx = await requireRequestContext()
  const tenant = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1)
    return t
  })
  if (!tenant) return null

  const enabled = new Set(tenant.enabledLanguages)
  const hierarchy = tenant.hierarchy

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/admin', label: 'Back to admin' }}
          title="Tenant settings"
          subtitle="Branding, languages, hierarchy depth, risk matrix"
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
              <CardTitle>Branding</CardTitle>
              <CardDescription>Shows in the app shell + on PDF outputs.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Logo URL">
                <Input name="logoUrl" defaultValue={tenant.branding.logoUrl ?? ''} placeholder="https://…" />
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
                  <div className="mt-1 flex items-center gap-3 rounded-md border border-slate-200 bg-white p-3">
                    <img src={tenant.branding.logoUrl} alt="" className="h-8" />
                    <span className="font-semibold" style={{ color: tenant.branding.primaryColor ?? '#0f766e' }}>
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
                  <label key={l.value} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
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
                <select
                  name="defaultLanguage"
                  defaultValue={tenant.defaultLanguage}
                  className="h-10 w-32 rounded-md border border-slate-300 bg-white px-3 text-sm"
                >
                  {KNOWN_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
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
                <label key={lvl} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <input type="checkbox" name={`lvl_${lvl}`} defaultChecked={hierarchy[lvl]} />
                  {lvl}
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Risk matrix</CardTitle>
              <CardDescription>Currently configured matrix. (Editor pending.)</CardDescription>
            </CardHeader>
            <CardContent>
              {tenant.riskMatrix ? (
                <RiskMatrixPreview matrix={tenant.riskMatrix} />
              ) : (
                <Alert variant="info">
                  <AlertTitle>No matrix configured</AlertTitle>
                  <AlertDescription>JSHAs that reference a matrix won't render scores.</AlertDescription>
                </Alert>
              )}
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

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function RiskMatrixPreview({ matrix }: { matrix: NonNullable<typeof tenants.$inferSelect.riskMatrix> }) {
  const sev = matrix.axes.severity.values
  const lik = matrix.axes.likelihood.values
  return (
    <div className="overflow-x-auto">
      <table className="text-xs">
        <thead>
          <tr>
            <th className="border-b border-slate-200 p-2" />
            {lik.map((l) => (
              <th key={l} className="border-b border-slate-200 p-2 text-left text-slate-500">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sev.map((s, sIdx) => (
            <tr key={s}>
              <th className="border-r border-slate-200 p-2 text-left text-slate-500">{s}</th>
              {lik.map((_, lIdx) => {
                const cell = matrix.cells[`${sIdx}:${lIdx}`]
                return (
                  <td
                    key={lIdx}
                    className="p-2 text-center text-white"
                    style={{ background: cell?.color ?? '#cbd5e1' }}
                    title={cell?.label}
                  >
                    {cell?.score ?? ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
