import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import {
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

export const metadata = { title: 'Edit location' }
export const dynamic = 'force-dynamic'

async function updateLocation(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return

  const before = await ctx.db(async (tx) => {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    return u
  })
  if (!before) return

  const latRaw = String(formData.get('lat') ?? '').trim()
  const lngRaw = String(formData.get('lng') ?? '').trim()
  const geofenceRaw = String(formData.get('geofenceMeters') ?? '').trim()

  const patch = {
    name: String(formData.get('name') ?? '').trim(),
    code: String(formData.get('code') ?? '').trim() || null,
    lat: latRaw.length > 0 ? Number(latRaw) : null,
    lng: lngRaw.length > 0 ? Number(lngRaw) : null,
    geofenceMeters: geofenceRaw.length > 0 ? Number(geofenceRaw) : null,
    address: buildAddressFromForm(formData),
  }

  await ctx.db((tx) => tx.update(orgUnits).set(patch).where(eq(orgUnits.id, id)))
  await recordAudit(ctx, {
    entityType: 'org_unit',
    entityId: id,
    action: 'update',
    summary: `Edited ${before.level} "${patch.name}"`,
    before: before as unknown as Record<string, unknown>,
    after: patch as unknown as Record<string, unknown>,
  })
  revalidatePath(`/locations/${id}`)
  revalidatePath('/locations')
  redirect(`/locations/${id}`)
}

export default async function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const unit = await ctx.db(async (tx) => {
    const [u] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).limit(1)
    return u
  })
  if (!unit) notFound()

  const addr = unit.address ?? {}

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <DetailHeader
        back={{ href: `/locations/${id}`, label: 'Back to location' }}
        title={`Edit ${unit.level}`}
        subtitle={unit.name}
      />
      <Card>
        <CardContent className="pt-6">
          <form action={updateLocation} className="space-y-4">
            <input type="hidden" name="id" value={id} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Name" required className="sm:col-span-2">
                <Input name="name" required defaultValue={unit.name} />
              </Field>
              <Field label="Code">
                <Input name="code" defaultValue={unit.code ?? ''} />
              </Field>
            </div>

            <div className="pt-2">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Address</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Address line 1" className="sm:col-span-2">
                  <Input name="addressLine1" defaultValue={addr.line1 ?? ''} />
                </Field>
                <Field label="Address line 2" className="sm:col-span-2">
                  <Input name="addressLine2" defaultValue={addr.line2 ?? ''} />
                </Field>
                <Field label="City">
                  <Input name="addressCity" defaultValue={addr.city ?? ''} />
                </Field>
                <Field label="Region / Province">
                  <Input name="addressRegion" defaultValue={addr.region ?? ''} />
                </Field>
                <Field label="Postal / Zip">
                  <Input name="addressPostal" defaultValue={addr.postal ?? ''} />
                </Field>
                <Field label="Country">
                  <Input name="addressCountry" defaultValue={addr.country ?? ''} />
                </Field>
              </div>
            </div>

            <div className="pt-2">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Geolocation</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Latitude">
                  <Input
                    name="lat"
                    type="number"
                    step="any"
                    defaultValue={unit.lat != null ? String(unit.lat) : ''}
                  />
                </Field>
                <Field label="Longitude">
                  <Input
                    name="lng"
                    type="number"
                    step="any"
                    defaultValue={unit.lng != null ? String(unit.lng) : ''}
                  />
                </Field>
                <Field label="Geofence (m)">
                  <Input
                    name="geofenceMeters"
                    type="number"
                    min={0}
                    defaultValue={unit.geofenceMeters != null ? String(unit.geofenceMeters) : ''}
                  />
                </Field>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="submit">Save changes</Button>
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

function buildAddressFromForm(
  formData: FormData,
): {
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
