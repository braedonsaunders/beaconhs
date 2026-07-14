import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { RemoteSelectField } from '@/components/remote-search-select'
import { upsertVehicleLogEntry } from '../_service'
import { normalizeVehicleLogEntryInput } from '../_entry-input'

export const metadata = { title: 'New vehicle log entry' }
export const dynamic = 'force-dynamic'

async function createEntry(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const input = normalizeVehicleLogEntryInput({
    equipmentItemId: formData.get('equipmentItemId'),
    entryDate: formData.get('entryDate'),
    driverPersonId: formData.get('driverPersonId'),
    entryMode: 'odometer',
    startOdometer: formData.get('startOdometer'),
    endOdometer: formData.get('endOdometer'),
    siteOrgUnitId: formData.get('siteOrgUnitId'),
    hoursOnSite: formData.get('hoursOnSite'),
    manpowerCount: formData.get('manpowerCount'),
    notes: formData.get('notes'),
  })
  await upsertVehicleLogEntry(ctx, input)
  const monthParam = input.entryDate.slice(0, 7)
  redirect(`/equipment/vehicle-log?month=${monthParam}`)
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
  assertCan(ctx, 'equipment.manage')

  return (
    <PageContainer>
      <div className="mx-auto max-w-2xl space-y-6">
        <DetailHeader
          back={{ href: '/equipment/vehicle-log', label: 'Back to vehicle log' }}
          title="New vehicle log entry"
          subtitle="One row per vehicle per day. Odometer in/out captures kilometres driven."
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createEntry} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Vehicle" required>
                  <RemoteSelectField
                    name="equipmentItemId"
                    defaultValue={presetTruckId}
                    lookup="vehicle-equipment"
                    placeholder="Select a vehicle…"
                    searchPlaceholder="Search asset tag or vehicle…"
                    sheetTitle="Select vehicle"
                    clearable={false}
                  />
                </Field>
                <Field label="Date" required>
                  <Input name="entryDate" type="date" required defaultValue={initialDate} />
                </Field>
                <Field label="Driver" required>
                  <RemoteSelectField
                    name="driverPersonId"
                    defaultValue=""
                    lookup="vehicle-drivers"
                    placeholder="Select a driver…"
                    searchPlaceholder="Search active drivers…"
                    sheetTitle="Select driver"
                    clearable={false}
                  />
                </Field>
                <Field label="Customer / site">
                  <RemoteSelectField
                    name="siteOrgUnitId"
                    defaultValue=""
                    lookup="vehicle-customers"
                    placeholder="Select a customer…"
                    searchPlaceholder="Search customers…"
                    sheetTitle="Select customer"
                    clearable
                    emptyLabel="— None —"
                  />
                </Field>
                <Field label="Start odometer (km)">
                  <Input name="startOdometer" type="number" min="0" max="2147483647" step="1" />
                </Field>
                <Field label="End odometer (km)">
                  <Input name="endOdometer" type="number" min="0" max="2147483647" step="1" />
                </Field>
                <Field label="Hours on site">
                  <Input
                    name="hoursOnSite"
                    type="number"
                    min="0"
                    max="24"
                    step="0.25"
                    placeholder="e.g. 8.5"
                  />
                </Field>
                <Field label="Crew count">
                  <Input name="manpowerCount" type="number" min="0" max="100000" step="1" />
                </Field>
              </div>
              <Field label="Notes">
                <Textarea
                  name="notes"
                  rows={3}
                  maxLength={5000}
                  placeholder="Anything noteworthy for this trip or maintenance."
                />
              </Field>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <Link href="/equipment/vehicle-log">
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
