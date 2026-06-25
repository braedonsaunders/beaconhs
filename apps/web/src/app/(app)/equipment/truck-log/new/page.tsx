import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, eq } from 'drizzle-orm'
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
import { equipmentItems, orgUnits, people, truckLogEntries } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { PersonSelectField } from '@/components/person-select-field'

export const metadata = { title: 'New truck log entry' }
export const dynamic = 'force-dynamic'

function safeInt(raw: FormDataEntryValue | null): number | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function safeStr(raw: FormDataEntryValue | null): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  return s || null
}

async function createEntry(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const equipmentItemId = String(formData.get('equipmentItemId') ?? '').trim()
  const entryDate = String(formData.get('entryDate') ?? '').trim()
  if (!equipmentItemId || !entryDate) throw new Error('Truck and date are required.')

  const driverPersonId = safeStr(formData.get('driverPersonId'))
  const startOdometer = safeInt(formData.get('startOdometer'))
  const endOdometer = safeInt(formData.get('endOdometer'))
  const siteOrgUnitId = safeStr(formData.get('siteOrgUnitId'))
  const hoursRaw = safeStr(formData.get('hoursOnSite'))
  const manpowerCount = safeInt(formData.get('manpowerCount'))
  const notes = safeStr(formData.get('notes'))

  const kmDriven =
    typeof startOdometer === 'number' &&
    typeof endOdometer === 'number' &&
    endOdometer >= startOdometer
      ? endOdometer - startOdometer
      : null

  const row = await ctx.db(async (tx) => {
    const [inserted] = await tx
      .insert(truckLogEntries)
      .values({
        tenantId: ctx.tenantId,
        equipmentItemId,
        entryDate,
        driverPersonId,
        startOdometer,
        endOdometer,
        kmDriven,
        siteOrgUnitId,
        hoursOnSite: hoursRaw,
        manpowerCount,
        notes,
        createdByTenantUserId: ctx.membership?.id,
      } as any)
      .returning()
    return inserted
  })

  if (!row) redirect('/equipment/truck-log')
  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    entityId: row.id,
    action: 'create',
    summary: `Logged ${kmDriven ?? '—'} km on ${entryDate}`,
    after: { equipmentItemId, entryDate, kmDriven, manpowerCount, hoursOnSite: hoursRaw },
  })
  const monthParam = entryDate.slice(0, 7)
  revalidatePath('/equipment/truck-log')
  revalidatePath(`/equipment/${equipmentItemId}`)
  redirect(`/equipment/truck-log?month=${monthParam}`)
}

export default async function NewTruckLogEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const presetTruckId = pickString(sp.truckId) ?? ''
  const presetDate = pickString(sp.date) ?? new Date().toISOString().slice(0, 10)
  const presetMonth = pickString(sp.month)
  const initialDate =
    presetDate || (presetMonth ? `${presetMonth}-01` : new Date().toISOString().slice(0, 10))
  // If we already know the truck, prefer the drawer on the parent detail
  // page. The full-page route stays as a fallback when there is no item
  // context (e.g. linked from the truck-log calendar without a row click).
  if (presetTruckId) {
    redirect(`/equipment/${presetTruckId}?tab=log&drawer=new-truck-log-entry`)
  }
  const ctx = await requireRequestContext()

  const { trucks, sites, drivers } = await ctx.db(async (tx) => {
    const [t, s, d] = await Promise.all([
      tx
        .select({
          id: equipmentItems.id,
          assetTag: equipmentItems.assetTag,
          name: equipmentItems.name,
        })
        .from(equipmentItems)
        .orderBy(asc(equipmentItems.assetTag))
        .limit(500),
      tx
        .select({ id: orgUnits.id, name: orgUnits.name, level: orgUnits.level })
        .from(orgUnits)
        .where(eq(orgUnits.level, 'site'))
        .orderBy(asc(orgUnits.name))
        .limit(500),
      tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
        })
        .from(people)
        .where(eq(people.status, 'active'))
        .orderBy(asc(people.lastName), asc(people.firstName))
        .limit(500),
    ])
    return { trucks: t, sites: s, drivers: d }
  })

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/equipment/truck-log', label: 'Back to truck log' }}
          title="New truck log entry"
          subtitle="One row per truck per day. Odometer in/out captures kilometres driven."
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createEntry} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Truck" required>
                  <Select name="equipmentItemId" defaultValue={presetTruckId} required>
                    <option value="">— Select truck —</option>
                    {trucks.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.assetTag} · {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Date" required>
                  <Input name="entryDate" type="date" required defaultValue={initialDate} />
                </Field>
                <Field label="Driver">
                  <PersonSelectField
                    name="driverPersonId"
                    defaultValue=""
                    options={drivers.map((p) => ({
                      value: p.id,
                      label: `${p.lastName}, ${p.firstName}`,
                      hint: p.employeeNo ?? undefined,
                    }))}
                    placeholder="Select a driver…"
                    clearable
                    emptyLabel="— Not specified —"
                  />
                </Field>
                <Field label="Site">
                  <Select name="siteOrgUnitId" defaultValue="">
                    <option value="">—</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Start odometer (km)">
                  <Input name="startOdometer" type="number" min="0" step="1" />
                </Field>
                <Field label="End odometer (km)">
                  <Input name="endOdometer" type="number" min="0" step="1" />
                </Field>
                <Field label="Hours on site">
                  <Input
                    name="hoursOnSite"
                    type="number"
                    min="0"
                    step="0.25"
                    placeholder="e.g. 8.5"
                  />
                </Field>
                <Field label="Manpower count">
                  <Input name="manpowerCount" type="number" min="0" step="1" />
                </Field>
              </div>
              <Field label="Notes">
                <Textarea
                  name="notes"
                  rows={3}
                  placeholder="Anything noteworthy for this trip or maintenance."
                />
              </Field>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <Link href="/equipment/truck-log">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit">Save entry</Button>
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
