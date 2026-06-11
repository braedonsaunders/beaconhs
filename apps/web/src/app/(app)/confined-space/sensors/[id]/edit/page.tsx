import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { Button, Card, CardContent, DetailHeader, Input, Label, Select } from '@beaconhs/ui'
import { atmosphericSensors } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'Edit sensor' }

const TYPES = [
  { value: 'multi_gas', label: 'Multi-gas' },
  { value: '4_gas', label: '4-gas' },
  { value: 'single_gas', label: 'Single-gas' },
] as const

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'out_of_service', label: 'Out of service' },
  { value: 'retired', label: 'Retired' },
] as const

async function updateSensor(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const identifier = String(formData.get('identifier') ?? '').trim()
  if (!identifier) throw new Error('Identifier is required')
  const make = String(formData.get('make') ?? '').trim() || null
  const model = String(formData.get('model') ?? '').trim() || null
  const serialNumber = String(formData.get('serialNumber') ?? '').trim() || null
  const type = String(formData.get('type') ?? 'multi_gas') as (typeof TYPES)[number]['value']
  const gases = String(formData.get('gases') ?? '')
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean)
  const status = String(formData.get('status') ?? 'active') as (typeof STATUSES)[number]['value']

  await ctx.db((tx) =>
    tx
      .update(atmosphericSensors)
      .set({ identifier, make, model, serialNumber, type, gases, status })
      .where(eq(atmosphericSensors.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'atmospheric_sensor',
    entityId: id,
    action: 'update',
    summary: 'Sensor details updated',
    after: { identifier, make, model, type, gases, status },
  })
  revalidatePath(`/confined-space/sensors/${id}`)
  revalidatePath('/confined-space/sensors')
  redirect(`/confined-space/sensors/${id}`)
}

export default async function EditSensorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const sensor = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(atmosphericSensors)
      .where(eq(atmosphericSensors.id, id))
      .limit(1)
    return row ?? null
  })
  if (!sensor) notFound()

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: `/confined-space/sensors/${id}`, label: 'Back to sensor' }}
          title={`Edit ${sensor.identifier}`}
        />
        <Card>
          <CardContent className="pt-6">
            <form action={updateSensor} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Identifier" required>
                  <Input name="identifier" required defaultValue={sensor.identifier} />
                </Field>
                <Field label="Serial #">
                  <Input name="serialNumber" defaultValue={sensor.serialNumber ?? ''} />
                </Field>
                <Field label="Make">
                  <Input name="make" defaultValue={sensor.make ?? ''} />
                </Field>
                <Field label="Model">
                  <Input name="model" defaultValue={sensor.model ?? ''} />
                </Field>
                <Field label="Type" required>
                  <Select name="type" defaultValue={sensor.type}>
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status" required>
                  <Select name="status" defaultValue={sensor.status}>
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Gases (comma or space separated)" className="sm:col-span-2">
                  <Input name="gases" defaultValue={sensor.gases.join(', ')} />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Save changes</Button>
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
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </Label>
      {children}
    </div>
  )
}
