import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  Button,
  Card,
  CardContent,
  DetailHeader,
  Input,
  Label,
  Select,
  Textarea,
} from '@beaconhs/ui'
import { atmosphericSensors } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { PageContainer } from '@/components/page-layout'

export const metadata = { title: 'New sensor' }

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

async function createSensor(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const identifier = String(formData.get('identifier') ?? '').trim()
  if (!identifier) throw new Error('Identifier is required')
  const make = String(formData.get('make') ?? '').trim() || null
  const model = String(formData.get('model') ?? '').trim() || null
  const serialNumber = String(formData.get('serialNumber') ?? '').trim() || null
  const type = String(formData.get('type') ?? 'multi_gas') as (typeof TYPES)[number]['value']
  const gasesRaw = String(formData.get('gases') ?? '')
  const gases = gasesRaw
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean)
  const lastCalibrationOn = String(formData.get('lastCalibrationOn') ?? '').trim() || null
  const nextCalibrationDue = String(formData.get('nextCalibrationDue') ?? '').trim() || null
  const status = String(formData.get('status') ?? 'active') as (typeof STATUSES)[number]['value']

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(atmosphericSensors)
      .values({
        tenantId: ctx.tenantId,
        identifier,
        make,
        model,
        serialNumber,
        type,
        gases,
        lastCalibrationOn,
        nextCalibrationDue,
        status,
      })
      .returning()
    return r
  })
  if (row) {
    await recordAudit(ctx, {
      entityType: 'atmospheric_sensor',
      entityId: row.id,
      action: 'create',
      summary: `Registered sensor ${identifier}`,
      after: { identifier, make, model, type, gases, status },
    })
  }
  revalidatePath('/confined-space/sensors')
  if (row) redirect(`/confined-space/sensors/${row.id}`)
  redirect('/confined-space/sensors')
}

export default async function NewSensorPage() {
  await requireRequestContext()
  return (
    <PageContainer>
      <div className="max-w-3xl space-y-6">
        <DetailHeader
          back={{ href: '/confined-space/sensors', label: 'Back to sensors' }}
          title="New atmospheric sensor"
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createSensor} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Identifier" required>
                  <Input name="identifier" required placeholder="e.g. GASMON-04" />
                </Field>
                <Field label="Serial #">
                  <Input name="serialNumber" placeholder="manufacturer serial" />
                </Field>
                <Field label="Make">
                  <Input name="make" placeholder="e.g. BW Technologies" />
                </Field>
                <Field label="Model">
                  <Input name="model" placeholder="e.g. GasAlertMicro 5" />
                </Field>
                <Field label="Type" required>
                  <Select name="type" defaultValue="multi_gas">
                    {TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Status" required>
                  <Select name="status" defaultValue="active">
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Gases (comma or space separated)" className="sm:col-span-2">
                  <Input name="gases" placeholder="O2, LEL, H2S, CO" />
                </Field>
                <Field label="Last calibration">
                  <Input name="lastCalibrationOn" type="date" />
                </Field>
                <Field label="Next calibration due">
                  <Input name="nextCalibrationDue" type="date" />
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button type="submit">Register sensor</Button>
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
