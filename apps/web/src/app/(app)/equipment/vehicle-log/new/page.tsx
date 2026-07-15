import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a9195530e3b90') }
}
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
  const tGenerated = await getGeneratedTranslations()
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
          title={tGenerated('m_1a9195530e3b90')}
          subtitle={tGenerated('m_090d8c607e4724')}
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createEntry} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={tGenerated('m_1b0bc0895e7f8b')} required>
                  <RemoteSelectField
                    name="equipmentItemId"
                    defaultValue={presetTruckId}
                    lookup="vehicle-equipment"
                    placeholder={tGenerated('m_103f20f5e2c090')}
                    searchPlaceholder={tGenerated('m_0baabbbb45a63c')}
                    sheetTitle="Select vehicle"
                    clearable={false}
                  />
                </Field>
                <Field label={tGenerated('m_0285c38761c540')} required>
                  <Input name="entryDate" type="date" required defaultValue={initialDate} />
                </Field>
                <Field label={tGenerated('m_00385063252603')} required>
                  <RemoteSelectField
                    name="driverPersonId"
                    defaultValue=""
                    lookup="vehicle-drivers"
                    placeholder={tGenerated('m_16234056fc2934')}
                    searchPlaceholder={tGenerated('m_1c51de60730f68')}
                    sheetTitle="Select driver"
                    clearable={false}
                  />
                </Field>
                <Field label={tGenerated('m_09ec32e549824e')}>
                  <RemoteSelectField
                    name="siteOrgUnitId"
                    defaultValue=""
                    lookup="vehicle-customers"
                    placeholder={tGenerated('m_0be0f471b00114')}
                    searchPlaceholder={tGenerated('m_134f17a2074f34')}
                    sheetTitle="Select customer"
                    clearable
                    emptyLabel={tGenerated('m_0dd5f8a31ce3e1')}
                  />
                </Field>
                <Field label={tGenerated('m_0cec84fec3b16f')}>
                  <Input name="startOdometer" type="number" min="0" max="2147483647" step="1" />
                </Field>
                <Field label={tGenerated('m_14beb2fa6adb50')}>
                  <Input name="endOdometer" type="number" min="0" max="2147483647" step="1" />
                </Field>
                <Field label={tGenerated('m_0c5fdf4fb3e86b')}>
                  <Input
                    name="hoursOnSite"
                    type="number"
                    min="0"
                    max="24"
                    step="0.25"
                    placeholder={tGenerated('m_0d366c65426260')}
                  />
                </Field>
                <Field label={tGenerated('m_0b59683e270c38')}>
                  <Input name="manpowerCount" type="number" min="0" max="100000" step="1" />
                </Field>
              </div>
              <Field label={tGenerated('m_0b8dadcb78cd08')}>
                <Textarea
                  name="notes"
                  rows={3}
                  maxLength={5000}
                  placeholder={tGenerated('m_158b69cdcc49c0')}
                />
              </Field>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <Link href="/equipment/vehicle-log">
                  <Button type="button" variant="outline">
                    <GeneratedText id="m_112e2e8ecda428" />
                  </Button>
                </Link>
                <Button type="submit">
                  <GeneratedText id="m_0df68f8978fe0a" />
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
