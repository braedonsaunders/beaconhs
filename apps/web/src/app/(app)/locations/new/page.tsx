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
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export const metadata = { title: 'New customer' }

async function createCustomer(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
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
      summary: `Added customer "${name}"`,
      after: { name, code, level: 'customer', address },
    })
  }

  revalidatePath('/locations')
  if (row) redirect(`/locations/${row.id}`)
  redirect('/locations')
}

export default function NewCustomerPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <DetailHeader
        back={{ href: '/locations', label: 'Back to locations' }}
        title="Add customer"
      />
      <Card>
        <CardContent className="pt-6">
          <form action={createCustomer} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Customer name" required className="sm:col-span-2">
                <Input name="name" required autoComplete="organization" />
              </Field>
              <Field label="Customer code">
                <Input name="code" placeholder="e.g. ACME-01" />
              </Field>
            </div>

            <div className="pt-2">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Mailing address</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Address line 1" className="sm:col-span-2">
                  <Input name="addressLine1" autoComplete="address-line1" />
                </Field>
                <Field label="Address line 2" className="sm:col-span-2">
                  <Input name="addressLine2" autoComplete="address-line2" />
                </Field>
                <Field label="City">
                  <Input name="addressCity" autoComplete="address-level2" />
                </Field>
                <Field label="Region / Province">
                  <Input name="addressRegion" autoComplete="address-level1" />
                </Field>
                <Field label="Postal / Zip">
                  <Input name="addressPostal" autoComplete="postal-code" />
                </Field>
                <Field label="Country">
                  <Input name="addressCountry" autoComplete="country-name" />
                </Field>
              </div>
            </div>

            <Alert variant="info">
              <AlertTitle>Hierarchy</AlertTitle>
              <AlertDescription>
                Customers live at the top of the location tree. Add projects and sites underneath
                from the customer detail page.
              </AlertDescription>
            </Alert>

            <div className="flex items-center justify-end gap-2">
              <Button type="submit">Create customer</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
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
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
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
