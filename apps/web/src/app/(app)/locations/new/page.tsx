import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  DetailHeader,
  Input,
  Label,
} from '@beaconhs/ui'
import { orgUnits } from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0a5c0609036e6b') }
}

async function createLocation(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.org.manage')
  const name = String(formData.get('name') ?? '').trim()
  const code = String(formData.get('code') ?? '').trim() || null
  if (!name) throw new Error('Name is required')

  const address = buildAddressFromForm(formData)

  const [row] = await ctx.db((tx) =>
    tx
      .insert(orgUnits)
      .values({
        tenantId: ctx.tenantId,
        parentId: null,
        level: 'customer',
        name,
        code,
        address,
      })
      .returning(),
  )

  if (row) {
    await recordAudit(ctx, {
      entityType: 'org_unit',
      entityId: row.id,
      action: 'create',
      summary: `Added location "${name}"`,
      after: { name, code, level: 'customer', address },
    })
  }

  revalidatePath('/locations')
  if (row) redirect(`/locations/${row.id}`)
  redirect('/locations')
}

export default async function NewLocationPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.org.manage')) redirect('/locations')
  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/locations', label: 'Back to locations' }}
          title={tGenerated('m_132e3f8e42438c')}
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createLocation} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={tGenerated('m_01661ece5c876e')} required className="sm:col-span-2">
                  <Input name="name" required autoComplete="organization" />
                </Field>
                <Field label={tGenerated('m_19b1f755da0a4c')}>
                  <Input name="code" placeholder={tGenerated('m_183f551bd7d694')} />
                </Field>
              </div>

              <div className="pt-2">
                <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  <GeneratedText id="m_0c6e19aa34bf2a" />
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={tGenerated('m_13c9eb2e75e0da')} className="sm:col-span-2">
                    <Input name="addressLine1" autoComplete="address-line1" />
                  </Field>
                  <Field label={tGenerated('m_0abb02292d9133')} className="sm:col-span-2">
                    <Input name="addressLine2" autoComplete="address-line2" />
                  </Field>
                  <Field label={tGenerated('m_0f8706f757eeb9')}>
                    <Input name="addressCity" autoComplete="address-level2" />
                  </Field>
                  <Field label={tGenerated('m_1f186e5abd90ed')}>
                    <Input name="addressRegion" autoComplete="address-level1" />
                  </Field>
                  <Field label={tGenerated('m_0a022396d35be5')}>
                    <Input name="addressPostal" autoComplete="postal-code" />
                  </Field>
                  <Field label={tGenerated('m_1bcca98c4d6c29')}>
                    <Input name="addressCountry" autoComplete="country-name" />
                  </Field>
                </div>
              </div>

              <Alert variant="info">
                <AlertTitle>
                  <GeneratedText id="m_0a5e0819e9c536" />
                </AlertTitle>
                <AlertDescription>
                  <GeneratedText id="m_0c1a7bbd60a7dd" />
                </AlertDescription>
              </Alert>

              <div className="flex items-center justify-end gap-2">
                <Button type="submit">
                  <GeneratedText id="m_0fe4cdc30bb478" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label>
        <GeneratedValue value={label} />
        <GeneratedValue value={required ? <span className="text-red-600"> *</span> : null} />
      </Label>
      <GeneratedValue value={children} />
    </div>
  )
}

function buildAddressFromForm(formData: FormData): {
  line1?: string
  line2?: string
  city?: string
  region?: string
  postal?: string
  country?: string
} | null {
  const fields = {
    line1: String(formData.get('addressLine1') ?? '').trim(),
    line2: String(formData.get('addressLine2') ?? '').trim(),
    city: String(formData.get('addressCity') ?? '').trim(),
    region: String(formData.get('addressRegion') ?? '').trim(),
    postal: String(formData.get('addressPostal') ?? '').trim(),
    country: String(formData.get('addressCountry') ?? '').trim(),
  }
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, v]) => v.length > 0))
  return Object.keys(cleaned).length > 0 ? cleaned : null
}
