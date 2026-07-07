import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, eq, isNull } from 'drizzle-orm'
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
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { isUuid } from '@/lib/list-params'
import { Section } from '@/components/section'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { PersonSelectField } from '@/components/person-select-field'
import { assertNonNegativeKm, computeTotalKm } from '../_service'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'edit', 'activity'] as const
type Tab = (typeof TABS)[number]

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

async function updateEntry(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const id = String(formData.get('id') ?? '').trim()
  const entryDate = String(formData.get('entryDate') ?? '').trim()
  const equipmentItemId = String(formData.get('equipmentItemId') ?? '').trim()
  if (!id || !entryDate || !equipmentItemId) return
  const driverPersonId = safeStr(formData.get('driverPersonId'))
  if (!driverPersonId) throw new Error('Driver is required.')
  const startOdometer = safeInt(formData.get('startOdometer'))
  const endOdometer = safeInt(formData.get('endOdometer'))
  const businessKm = safeInt(formData.get('businessKm'))
  const personalKm = safeInt(formData.get('personalKm'))
  const siteOrgUnitId = safeStr(formData.get('siteOrgUnitId'))
  const hoursRaw = safeStr(formData.get('hoursOnSite'))
  const manpowerCount = safeInt(formData.get('manpowerCount'))
  const notes = safeStr(formData.get('notes'))
  assertNonNegativeKm({
    'Start odometer': startOdometer,
    'End odometer': endOdometer,
    'Business km': businessKm,
    'Personal km': personalKm,
    'Hours on site': hoursRaw,
    'Crew count': manpowerCount,
  })

  const kmDriven = await ctx.db(async (tx) => {
    const [existing] = await tx
      .select({ entryMode: truckLogEntries.entryMode })
      .from(truckLogEntries)
      .where(eq(truckLogEntries.id, id))
      .limit(1)
    if (!existing) throw new Error('Vehicle log entry not found.')
    // Mode-aware save: only the fields for the entry's mode are written and
    // the total is derived the same way the workspace grid derives it, so a
    // destination-mode entry never has its kmDriven clobbered by empty
    // odometer inputs.
    const entryMode = existing.entryMode
    const fields =
      entryMode === 'odometer'
        ? { startOdometer, endOdometer, businessKm: null, personalKm }
        : { startOdometer: null, endOdometer: null, businessKm, personalKm }
    const kmDriven = computeTotalKm({ entryMode, ...fields })
    try {
      await tx
        .update(truckLogEntries)
        .set({
          equipmentItemId,
          entryDate,
          driverPersonId,
          ...fields,
          kmDriven,
          siteOrgUnitId,
          hoursOnSite: hoursRaw as any,
          manpowerCount,
          notes,
        })
        .where(eq(truckLogEntries.id, id))
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        throw new Error(
          'An entry already exists for that vehicle, driver, and date. Edit that entry instead.',
        )
      }
      throw error
    }
    return kmDriven
  })
  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    entityId: id,
    action: 'update',
    summary: `Updated entry for ${entryDate}`,
    after: { equipmentItemId, entryDate, kmDriven, manpowerCount, hoursOnSite: hoursRaw },
  })
  revalidatePath('/equipment/vehicle-log')
  revalidatePath(`/equipment/vehicle-log/${id}`)
  revalidatePath(`/equipment/${equipmentItemId}`)
}

async function deleteEntry(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const id = String(formData.get('id') ?? '').trim()
  if (!id) return
  const removed = await ctx.db(async (tx) => {
    const [existing] = await tx
      .select({
        entryDate: truckLogEntries.entryDate,
        equipmentItemId: truckLogEntries.equipmentItemId,
      })
      .from(truckLogEntries)
      .where(eq(truckLogEntries.id, id))
      .limit(1)
    if (!existing) return null
    await tx.delete(truckLogEntries).where(eq(truckLogEntries.id, id))
    return existing
  })
  if (!removed) redirect('/equipment/vehicle-log')
  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    entityId: id,
    action: 'delete',
    summary: `Deleted entry for ${removed.entryDate}`,
    before: { entryDate: removed.entryDate, equipmentItemId: removed.equipmentItemId },
  })
  revalidatePath('/equipment/vehicle-log')
  revalidatePath(`/equipment/${removed.equipmentItemId}`)
  redirect(`/equipment/vehicle-log?month=${removed.entryDate.slice(0, 7)}`)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Vehicle log · ${id.slice(0, 8)}` }
}

export default async function TruckLogDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  // Non-uuid segments (stale bookmarks like the removed /manage sub-route)
  // must 404, not crash the uuid cast in Postgres.
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')

  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        entry: truckLogEntries,
        truck: equipmentItems,
        driver: people,
        site: orgUnits,
      })
      .from(truckLogEntries)
      .leftJoin(equipmentItems, eq(equipmentItems.id, truckLogEntries.equipmentItemId))
      .leftJoin(people, eq(people.id, truckLogEntries.driverPersonId))
      .leftJoin(orgUnits, eq(orgUnits.id, truckLogEntries.siteOrgUnitId))
      .where(eq(truckLogEntries.id, id))
      .limit(1)
    if (!row) return null
    const [trucks, sites, drivers] = await Promise.all([
      tx
        .select({
          id: equipmentItems.id,
          assetTag: equipmentItems.assetTag,
          name: equipmentItems.name,
        })
        .from(equipmentItems)
        .where(isNull(equipmentItems.deletedAt))
        .orderBy(asc(equipmentItems.assetTag))
        .limit(500),
      tx
        .select({ id: orgUnits.id, name: orgUnits.name })
        .from(orgUnits)
        .where(eq(orgUnits.level, 'customer'))
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
    return { ...row, trucks, sites, drivers }
  })

  if (!data) notFound()
  const { entry, truck, driver, site, trucks, sites, drivers } = data
  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'truck_log_entry', id, 50) : []
  const basePath = `/equipment/vehicle-log/${id}`

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{
            href: `/equipment/vehicle-log?month=${entry.entryDate.slice(0, 7)}`,
            label: 'Back to vehicle log',
          }}
          title={`${truck?.assetTag ?? '—'} · ${entry.entryDate}`}
          subtitle={truck ? truck.name : 'Equipment removed'}
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'edit', label: 'Edit' },
            { key: 'activity', label: 'Activity', count: activity.length },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <Section title="Entry">
            <DetailGrid
              rows={[
                {
                  label: 'Truck',
                  value: truck ? (
                    <Link href={`/equipment/${truck.id}`} className="text-teal-700 hover:underline">
                      <span className="font-mono text-xs">{truck.assetTag}</span> · {truck.name}
                    </Link>
                  ) : (
                    '—'
                  ),
                },
                { label: 'Date', value: entry.entryDate },
                {
                  label: 'Driver',
                  value: driver ? (
                    <Link href={`/people/${driver.id}`} className="text-teal-700 hover:underline">
                      {driver.firstName} {driver.lastName}
                    </Link>
                  ) : (
                    '—'
                  ),
                },
                { label: 'Customer / site', value: site?.name ?? '—' },
                ...(entry.entryMode === 'destination'
                  ? [
                      { label: 'Business km', value: entry.businessKm ?? '—' },
                      { label: 'Personal km', value: entry.personalKm ?? '—' },
                    ]
                  : [
                      { label: 'Start odometer', value: entry.startOdometer ?? '—' },
                      { label: 'End odometer', value: entry.endOdometer ?? '—' },
                      { label: 'Personal km', value: entry.personalKm ?? '—' },
                    ]),
                { label: 'Km driven', value: entry.kmDriven ?? '—' },
                { label: 'Hours on site', value: entry.hoursOnSite ?? '—' },
                { label: 'Crew count', value: entry.manpowerCount ?? '—' },
              ]}
            />
            {entry.notes ? (
              <div className="mt-4">
                <div className="text-xs tracking-wide text-slate-500 uppercase">Notes</div>
                <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">{entry.notes}</p>
              </div>
            ) : null}
            <div className="mt-6 flex justify-end">
              <form action={deleteEntry}>
                <input type="hidden" name="id" value={id} />
                <Button type="submit" variant="outline">
                  Delete entry
                </Button>
              </form>
            </div>
          </Section>
        ) : null}

        {active === 'edit' ? (
          <Section title="Edit entry">
            <Card>
              <CardContent className="pt-6">
                <form action={updateEntry} className="space-y-4">
                  <input type="hidden" name="id" value={id} />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Truck" required>
                      <Select name="equipmentItemId" defaultValue={entry.equipmentItemId} required>
                        {trucks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.assetTag} · {t.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Date" required>
                      <Input name="entryDate" type="date" required defaultValue={entry.entryDate} />
                    </Field>
                    <Field label="Driver" required>
                      <PersonSelectField
                        name="driverPersonId"
                        defaultValue={entry.driverPersonId}
                        options={drivers.map((p) => ({
                          value: p.id,
                          label: `${p.lastName}, ${p.firstName}`,
                          hint: p.employeeNo ?? undefined,
                        }))}
                        placeholder="Select a driver…"
                        clearable={false}
                      />
                    </Field>
                    <Field label="Customer / site">
                      <Select name="siteOrgUnitId" defaultValue={entry.siteOrgUnitId ?? ''}>
                        <option value="">—</option>
                        {sites.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {entry.entryMode === 'destination' ? (
                      <>
                        <Field label="Business km">
                          <Input
                            name="businessKm"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={entry.businessKm ?? ''}
                          />
                        </Field>
                        <Field label="Personal km">
                          <Input
                            name="personalKm"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={entry.personalKm ?? ''}
                          />
                        </Field>
                      </>
                    ) : (
                      <>
                        <Field label="Start odometer (km)">
                          <Input
                            name="startOdometer"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={entry.startOdometer ?? ''}
                          />
                        </Field>
                        <Field label="End odometer (km)">
                          <Input
                            name="endOdometer"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={entry.endOdometer ?? ''}
                          />
                        </Field>
                        <Field label="Personal km">
                          <Input
                            name="personalKm"
                            type="number"
                            min="0"
                            step="1"
                            defaultValue={entry.personalKm ?? ''}
                          />
                        </Field>
                      </>
                    )}
                    <Field label="Hours on site">
                      <Input
                        name="hoursOnSite"
                        type="number"
                        min="0"
                        step="0.25"
                        defaultValue={entry.hoursOnSite ?? ''}
                      />
                    </Field>
                    <Field label="Crew count">
                      <Input
                        name="manpowerCount"
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={entry.manpowerCount ?? ''}
                      />
                    </Field>
                  </div>
                  <Field label="Notes">
                    <Textarea name="notes" rows={3} defaultValue={entry.notes ?? ''} />
                  </Field>
                  <div className="flex justify-end">
                    <Button type="submit">Save changes</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </Section>
        ) : null}

        {active === 'activity' ? (
          <Section title={`Activity (${activity.length})`}>
            <ActivityFeed entries={activity} />
          </Section>
        ) : null}
      </div>
    </DetailPageLayout>
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
