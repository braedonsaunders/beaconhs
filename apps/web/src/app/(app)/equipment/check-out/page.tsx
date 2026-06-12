import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { ArrowRightLeft, CheckCheck, Clock, LogIn, LogOut } from 'lucide-react'
import { and, asc, count, desc, eq, isNull, lte } from 'drizzle-orm'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@beaconhs/ui'
import {
  equipmentCheckouts,
  equipmentItems,
  equipmentLocationHistory,
  equipmentTypes,
  orgUnits,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { ListPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { PersonSelectField } from '@/components/person-select-field'

export const metadata = { title: 'Check in / out' }
export const dynamic = 'force-dynamic'

async function checkOut(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('equipmentItemId') ?? '').trim()
  const holderPersonId = String(formData.get('holderPersonId') ?? '').trim() || null
  const destinationOrgUnitId = String(formData.get('destinationOrgUnitId') ?? '').trim() || null
  const expectedReturnOn = String(formData.get('expectedReturnOn') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!itemId) return

  const checkoutId = await ctx.db(async (tx) => {
    const [co] = await tx
      .insert(equipmentCheckouts)
      .values({
        tenantId: ctx.tenantId,
        equipmentItemId: itemId,
        holderPersonId,
        destinationOrgUnitId,
        expectedReturnOn,
        notes,
        checkedOutByTenantUserId: ctx.membership?.id,
      })
      .returning({ id: equipmentCheckouts.id })
    // Update the item's current holder + site + availability flag.
    await tx
      .update(equipmentItems)
      .set({
        currentHolderPersonId: holderPersonId,
        currentSiteOrgUnitId: destinationOrgUnitId,
        lastSeenHolderPersonId: holderPersonId,
        lastSeenSiteOrgUnitId: destinationOrgUnitId,
        lastSeenAt: new Date(),
        isAvailableForCheckout: false,
        isMissing: false,
      })
      .where(eq(equipmentItems.id, itemId))
    // Mirror to location history so the existing /equipment/[id] location
    // tab continues to show movement.
    await tx.insert(equipmentLocationHistory).values({
      tenantId: ctx.tenantId,
      itemId,
      siteOrgUnitId: destinationOrgUnitId,
      holderPersonId,
      recordedByTenantUserId: ctx.membership?.id,
      note: `Checked out${notes ? ` — ${notes}` : ''}`,
    })
    return co?.id
  })

  await recordAudit(ctx, {
    entityType: 'equipment_checkout',
    entityId: checkoutId ?? undefined,
    action: 'create',
    summary: 'Checked equipment out',
    after: {
      itemId,
      holderPersonId,
      destinationOrgUnitId,
      expectedReturnOn,
      notes,
    },
  })
  revalidatePath('/equipment/check-out')
  revalidatePath(`/equipment/${itemId}`)
}

async function checkIn(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '').trim()
  const condition = String(formData.get('returnedCondition') ?? 'good').trim() || 'good'
  const returnedNotes = String(formData.get('returnedNotes') ?? '').trim() || null
  if (!id) return

  const itemId = await ctx.db(async (tx) => {
    const [co] = await tx
      .select()
      .from(equipmentCheckouts)
      .where(eq(equipmentCheckouts.id, id))
      .limit(1)
    if (!co) return null
    await tx
      .update(equipmentCheckouts)
      .set({
        returnedAt: new Date(),
        returnedCondition: condition as any,
        returnedNotes,
        checkedInByTenantUserId: ctx.membership?.id,
      })
      .where(eq(equipmentCheckouts.id, id))
    await tx
      .update(equipmentItems)
      .set({
        currentHolderPersonId: null,
        isAvailableForCheckout: true,
        lastSeenAt: new Date(),
      })
      .where(eq(equipmentItems.id, co.equipmentItemId))
    await tx.insert(equipmentLocationHistory).values({
      tenantId: ctx.tenantId,
      itemId: co.equipmentItemId,
      siteOrgUnitId: null,
      holderPersonId: null,
      recordedByTenantUserId: ctx.membership?.id,
      note: `Checked in (${condition})${returnedNotes ? ` — ${returnedNotes}` : ''}`,
    })
    return co.equipmentItemId
  })

  await recordAudit(ctx, {
    entityType: 'equipment_checkout',
    entityId: id,
    action: 'update',
    summary: 'Checked equipment in',
    after: { condition, returnedNotes },
  })
  revalidatePath('/equipment/check-out')
  if (itemId) revalidatePath(`/equipment/${itemId}`)
}

export default async function CheckInOutPage() {
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)

  const { available, openCheckouts, sites, peopleList, openCount, overdueCount } = await ctx.db(
    async (tx) => {
      const av = await tx
        .select({
          item: equipmentItems,
          type: equipmentTypes,
          site: orgUnits,
        })
        .from(equipmentItems)
        .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
        .where(and(eq(equipmentItems.isAvailableForCheckout, true)))
        .orderBy(asc(equipmentItems.assetTag))
        .limit(200)
      const open = await tx
        .select({
          co: equipmentCheckouts,
          item: equipmentItems,
          type: equipmentTypes,
          holder: people,
          dest: orgUnits,
        })
        .from(equipmentCheckouts)
        .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentCheckouts.equipmentItemId))
        .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
        .leftJoin(people, eq(people.id, equipmentCheckouts.holderPersonId))
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentCheckouts.destinationOrgUnitId))
        .where(isNull(equipmentCheckouts.returnedAt))
        .orderBy(asc(equipmentCheckouts.checkedOutAt))
        .limit(200)
      const allSites = await tx
        .select({ id: orgUnits.id, name: orgUnits.name, level: orgUnits.level })
        .from(orgUnits)
        .orderBy(asc(orgUnits.name))
        .limit(500)
      const allPeople = await tx
        .select({
          id: people.id,
          first: people.firstName,
          last: people.lastName,
          employeeNo: people.employeeNo,
        })
        .from(people)
        .where(eq(people.status, 'active'))
        .orderBy(asc(people.lastName), asc(people.firstName))
        .limit(500)
      const [openC] = await tx
        .select({ c: count() })
        .from(equipmentCheckouts)
        .where(isNull(equipmentCheckouts.returnedAt))
      const [overC] = await tx
        .select({ c: count() })
        .from(equipmentCheckouts)
        .where(
          and(
            isNull(equipmentCheckouts.returnedAt),
            lte(equipmentCheckouts.expectedReturnOn, today),
          ),
        )
      return {
        available: av,
        openCheckouts: open,
        sites: allSites,
        peopleList: allPeople,
        openCount: Number(openC?.c ?? 0),
        overdueCount: Number(overC?.c ?? 0),
      }
    },
  )

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="check-out" />
          <PageHeader
            title="Check in / out"
            description="Hand a piece of equipment to a person + destination. Returns clear the holder and mark it available again."
          />
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge variant={openCount > 0 ? 'warning' : 'secondary'}>
              {openCount} currently out
            </Badge>
            <Badge variant={overdueCount > 0 ? 'destructive' : 'secondary'}>
              {overdueCount} overdue
            </Badge>
            <Badge variant="success">{available.length} available</Badge>
          </div>
        </>
      }
    >
      <div className="space-y-6">
        {overdueCount > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>
              <Clock size={14} className="mr-1 inline" /> Overdue returns
            </AlertTitle>
            <AlertDescription>
              {overdueCount} item{overdueCount === 1 ? '' : 's'} past their expected return date.
              Reach out to the holder or update the expected return.
            </AlertDescription>
          </Alert>
        ) : null}

        <Section
          title={`Currently out (${openCheckouts.length})`}
          defaultOpen
          subtitle="One row per active checkout. Use the Check in form to record a return."
        >
          {openCheckouts.length === 0 ? (
            <EmptyState
              icon={<CheckCheck size={28} />}
              title="Nothing checked out"
              description="Every asset is at base."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Equipment</TableHead>
                    <TableHead>Held by</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Out since</TableHead>
                    <TableHead>Expected back</TableHead>
                    <TableHead>Check in</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openCheckouts.map(({ co, item, type, holder, dest }) => {
                    const overdue = co.expectedReturnOn !== null && co.expectedReturnOn <= today
                    return (
                      <TableRow key={co.id}>
                        <TableCell>
                          {item ? (
                            <Link href={`/equipment/${item.id}`} className="hover:underline">
                              <div className="font-mono text-xs text-slate-500">
                                {item.assetTag}
                              </div>
                              <div className="text-sm font-medium">{item.name}</div>
                              {type ? (
                                <div className="text-xs text-slate-500">{type.name}</div>
                              ) : null}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {holder ? `${holder.firstName} ${holder.lastName}` : '—'}
                        </TableCell>
                        <TableCell className="text-slate-600">{dest?.name ?? '—'}</TableCell>
                        <TableCell className="text-slate-600">
                          {new Date(co.checkedOutAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className={overdue ? 'text-red-700' : 'text-slate-600'}>
                          {co.expectedReturnOn ?? '—'}
                          {overdue ? (
                            <Badge variant="destructive" className="ml-1">
                              overdue
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <form action={checkIn} className="flex items-center gap-2">
                            <input type="hidden" name="id" value={co.id} />
                            <Select
                              name="returnedCondition"
                              defaultValue="good"
                              className="h-8 w-28"
                            >
                              <option value="good">Good</option>
                              <option value="fair">Fair</option>
                              <option value="damaged">Damaged</option>
                              <option value="unusable">Unusable</option>
                            </Select>
                            <Input name="returnedNotes" placeholder="notes…" className="h-8 w-40" />
                            <Button type="submit" size="sm">
                              <LogIn size={12} /> Check in
                            </Button>
                          </form>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

        <Section title="Check out equipment" defaultOpen>
          <form action={checkOut} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-3">
              <Label>Equipment *</Label>
              <Select name="equipmentItemId" required defaultValue="">
                <option value="">— Select available equipment —</option>
                {available.map(({ item, type, site }) => (
                  <option key={item.id} value={item.id}>
                    {item.assetTag} — {item.name}
                    {type ? ` (${type.name})` : ''}
                    {site ? ` @ ${site.name}` : ''}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-slate-500">
                Only items flagged available are shown ({available.length}).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Hand to person</Label>
              <PersonSelectField
                name="holderPersonId"
                defaultValue=""
                options={peopleList.map((p) => ({
                  value: p.id,
                  label: `${p.last}, ${p.first}`,
                  hint: p.employeeNo ?? undefined,
                }))}
                placeholder="Select a person…"
                clearable
                emptyLabel="— No specific holder —"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Destination site / project</Label>
              <Select name="destinationOrgUnitId" defaultValue="">
                <option value="">— Unassigned —</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.level})
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Expected return on</Label>
              <Input name="expectedReturnOn" type="date" />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label>Notes</Label>
              <Textarea
                name="notes"
                rows={2}
                placeholder="Context for the checkout (purpose, accessories, etc)"
              />
            </div>
            <div className="flex justify-end sm:col-span-3">
              <Button type="submit">
                <LogOut size={12} /> Check out
              </Button>
            </div>
          </form>
        </Section>

        <Section title="Available equipment" defaultOpen={false}>
          {available.length === 0 ? (
            <EmptyState
              icon={<ArrowRightLeft size={28} />}
              title="No available equipment"
              description="All items are checked out or out of service."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset tag</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Current site</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {available.map(({ item, type, site }) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/equipment/${item.id}`} className="hover:underline">
                          {item.assetTag}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-slate-600">{type?.name ?? '—'}</TableCell>
                      <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>
      </div>
    </ListPageLayout>
  )
}
