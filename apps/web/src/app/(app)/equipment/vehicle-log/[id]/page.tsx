import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { equipmentItems, orgUnits, people, truckLogEntries } from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { activityPageForEntity, recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { isUuid, parsePrefixedListParams, pickString } from '@/lib/list-params'
import { Section } from '@/components/section'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { RemoteSelectField } from '@/components/remote-search-select'
import { updateVehicleLogEntry } from '../_service'
import { normalizeVehicleLogEntryInput } from '../_entry-input'
import { requireUuidInput } from '@/lib/mutation-input'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'edit', 'activity'] as const
type Tab = (typeof TABS)[number]
const ACTIVITY_SORTS = ['recent', 'oldest'] as const

async function updateEntry(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const id = requireUuidInput(formData.get('id'), 'Vehicle log entry')
  const input = normalizeVehicleLogEntryInput({
    equipmentItemId: formData.get('equipmentItemId'),
    entryDate: formData.get('entryDate'),
    driverPersonId: formData.get('driverPersonId'),
    entryMode: 'odometer',
    startOdometer: formData.get('startOdometer'),
    endOdometer: formData.get('endOdometer'),
    businessKm: formData.get('businessKm'),
    personalKm: formData.get('personalKm'),
    siteOrgUnitId: formData.get('siteOrgUnitId'),
    hoursOnSite: formData.get('hoursOnSite'),
    manpowerCount: formData.get('manpowerCount'),
    notes: formData.get('notes'),
  })
  await updateVehicleLogEntry(ctx, id, input)
}

async function deleteEntry(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const id = requireUuidInput(formData.get('id'), 'Vehicle log entry')
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
    const [deleted] = await tx
      .delete(truckLogEntries)
      .where(eq(truckLogEntries.id, id))
      .returning({ id: truckLogEntries.id })
    return deleted ? existing : null
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
  const activityParams = parsePrefixedListParams(sp, 'activity', {
    sort: 'recent',
    perPage: 15,
    allowedSorts: ACTIVITY_SORTS,
  })
  const activityAction = pickString(sp.activityAction)?.slice(0, 100) || undefined

  const ctx = await requireRequestContext()
  const canManage = can(ctx, 'equipment.manage')
  if (active === 'edit' && !canManage) redirect(`/equipment/vehicle-log/${id}`)
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
    return row
  })

  if (!data) notFound()
  const { entry, truck, driver, site } = data
  const activityData =
    active === 'activity'
      ? await activityPageForEntity(ctx, 'truck_log_entry', id, {
          q: activityParams.q,
          action: activityAction,
          page: activityParams.page,
          perPage: activityParams.perPage,
          dir: activityParams.sort === 'oldest' ? 'asc' : 'desc',
        })
      : { rows: [], total: 0, filteredTotal: 0, actions: [] }
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
            ...(canManage ? ([{ key: 'edit', label: 'Edit' }] as const) : []),
            { key: 'activity', label: 'Activity', count: activityData.total },
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
            {canManage ? (
              <div className="mt-6 flex justify-end">
                <form action={deleteEntry}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="outline">
                    Delete entry
                  </Button>
                </form>
              </div>
            ) : null}
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
                      <RemoteSelectField
                        name="equipmentItemId"
                        defaultValue={entry.equipmentItemId}
                        lookup="vehicle-equipment"
                        initialOption={
                          truck
                            ? {
                                value: truck.id,
                                label: `${truck.assetTag} · ${truck.name}`,
                              }
                            : undefined
                        }
                        placeholder="Select a vehicle…"
                        searchPlaceholder="Search asset tag or vehicle…"
                        sheetTitle="Select vehicle"
                        clearable={false}
                      />
                    </Field>
                    <Field label="Date" required>
                      <Input name="entryDate" type="date" required defaultValue={entry.entryDate} />
                    </Field>
                    <Field label="Driver" required>
                      <RemoteSelectField
                        name="driverPersonId"
                        defaultValue={entry.driverPersonId}
                        lookup="vehicle-drivers"
                        initialOption={
                          driver
                            ? {
                                value: driver.id,
                                label: `${driver.lastName}, ${driver.firstName}`,
                                hint: driver.employeeNo ?? undefined,
                              }
                            : undefined
                        }
                        placeholder="Select a driver…"
                        searchPlaceholder="Search active drivers…"
                        sheetTitle="Select driver"
                        clearable={false}
                      />
                    </Field>
                    <Field label="Customer / site">
                      <RemoteSelectField
                        name="siteOrgUnitId"
                        defaultValue={entry.siteOrgUnitId ?? ''}
                        lookup="vehicle-customers"
                        initialOption={
                          site
                            ? { value: site.id, label: site.name, hint: site.code ?? undefined }
                            : undefined
                        }
                        placeholder="Select a customer…"
                        searchPlaceholder="Search customers…"
                        sheetTitle="Select customer"
                        clearable
                        emptyLabel="— None —"
                      />
                    </Field>
                    {entry.entryMode === 'destination' ? (
                      <>
                        <Field label="Business km">
                          <Input
                            name="businessKm"
                            type="number"
                            min="0"
                            max="2147483647"
                            step="1"
                            defaultValue={entry.businessKm ?? ''}
                          />
                        </Field>
                        <Field label="Personal km">
                          <Input
                            name="personalKm"
                            type="number"
                            min="0"
                            max="2147483647"
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
                            max="2147483647"
                            step="1"
                            defaultValue={entry.startOdometer ?? ''}
                          />
                        </Field>
                        <Field label="End odometer (km)">
                          <Input
                            name="endOdometer"
                            type="number"
                            min="0"
                            max="2147483647"
                            step="1"
                            defaultValue={entry.endOdometer ?? ''}
                          />
                        </Field>
                        <Field label="Personal km">
                          <Input
                            name="personalKm"
                            type="number"
                            min="0"
                            max="2147483647"
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
                        max="24"
                        step="0.25"
                        defaultValue={entry.hoursOnSite ?? ''}
                      />
                    </Field>
                    <Field label="Crew count">
                      <Input
                        name="manpowerCount"
                        type="number"
                        min="0"
                        max="100000"
                        step="1"
                        defaultValue={entry.manpowerCount ?? ''}
                      />
                    </Field>
                  </div>
                  <Field label="Notes">
                    <Textarea
                      name="notes"
                      rows={3}
                      maxLength={5000}
                      defaultValue={entry.notes ?? ''}
                    />
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
          <Section title={`Activity (${activityData.total})`}>
            <TableToolbar className="mb-3">
              <SearchInput
                placeholder="Search activity…"
                paramKey="activityQ"
                pageParamKey="activityPage"
              />
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="activityAction"
                pageParamKey="activityPage"
                label="Action"
                options={activityData.actions.map((row) => ({
                  value: row.action,
                  label: row.action
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, (character) => character.toUpperCase()),
                  count: row.count,
                }))}
              />
              <FilterChips
                basePath={basePath}
                currentParams={sp}
                paramKey="activitySort"
                pageParamKey="activityPage"
                label="Order"
                defaultValue="recent"
                hideAll
                options={[
                  { value: 'recent', label: 'Newest first' },
                  { value: 'oldest', label: 'Oldest first' },
                ]}
              />
            </TableToolbar>
            <ActivityFeed entries={activityData.rows} timeZone={ctx.timezone} />
            <Pagination
              basePath={basePath}
              currentParams={sp}
              total={activityData.filteredTotal}
              page={activityParams.page}
              perPage={activityParams.perPage}
              pageParamKey="activityPage"
            />
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
