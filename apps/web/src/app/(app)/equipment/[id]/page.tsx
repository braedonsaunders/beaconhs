import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  ClipboardCheck,
  FileText,
  LogIn,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  QrCode,
  Search,
  Truck,
  Wrench,
} from 'lucide-react'
import { NewWorkOrderDrawer } from './_work-order-drawer'
import { NewTruckLogEntryDrawer } from './_truck-log-drawer'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  EmptyState,
  Input,
  Label,
  Select,
  TabContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  UrlDrawer,
} from '@beaconhs/ui'
import { pickString } from '@/lib/list-params'
import {
  attachments,
  equipmentCheckouts,
  equipmentExpenses,
  equipmentItems,
  equipmentLocationHistory,
  equipmentLogEntries,
  equipmentRates,
  equipmentTypes,
  equipmentWorkOrders,
  formResponses,
  formTemplates,
  orgUnits,
  people,
  tenantUsers,
  truckLogEntries,
  user,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { ActivityFeed } from '@/components/activity-feed'
import { PageContainer } from '@/components/page-layout'
import { PersonSelectField } from '@/components/person-select-field'
import { EquipmentEditTab } from './equipment-edit-tab'

export const dynamic = 'force-dynamic'

const TABS = [
  'overview',
  'maintenance',
  'work_orders',
  'location',
  'certificates',
  'inspections',
  'rates',
  'expenses',
  'log',
  'checkouts',
  'activity',
  'edit',
] as const
type Tab = (typeof TABS)[number]

function fmtMoney(value: string | number | null | undefined, currency = 'CAD'): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(n)
}

// ---------------- Server actions ----------------

async function reportMissing(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const lastSeenDate = String(formData.get('lastSeenDate') ?? '').trim() || null
  const lastSeenLocation = String(formData.get('lastSeenLocation') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!id) return
  const now = new Date()
  await ctx.db((tx) =>
    tx
      .update(equipmentItems)
      .set({
        isMissing: true,
        // Snapshot fields specific to the missing-report workflow.
        missingReportedAt: now,
        missingReportedBy: ctx.userId,
        missingLastSeenAt: lastSeenDate,
        missingLastSeenLocation: lastSeenLocation,
        missingNotes: notes,
        missingFoundAt: null,
        // Also update the generic last-seen timestamp so existing UIs that
        // read it stay coherent.
        lastSeenAt: now,
      })
      .where(eq(equipmentItems.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: id,
    action: 'update',
    summary: 'Reported missing',
    after: {
      lastSeenDate,
      lastSeenLocation,
      notes,
    },
  })
  revalidatePath(`/equipment/${id}`)
  redirect(`/equipment/${id}`)
}

async function reportFound(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const foundNotes = String(formData.get('foundNotes') ?? '').trim() || null
  if (!id) return
  const now = new Date()
  await ctx.db((tx) =>
    tx
      .update(equipmentItems)
      .set({
        isMissing: false,
        missingFoundAt: now,
        // Append the found-time notes onto the prior missing notes for
        // posterity. If there were no prior notes, just use these.
        missingNotes: foundNotes
          ? sql`COALESCE(${equipmentItems.missingNotes}, '') || CASE WHEN COALESCE(${equipmentItems.missingNotes}, '') = '' THEN '' ELSE E'\n\n' END || ${`Found ${now.toISOString().slice(0, 10)}: ${foundNotes}`}`
          : equipmentItems.missingNotes,
        lastSeenAt: now,
      })
      .where(eq(equipmentItems.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: id,
    action: 'update',
    summary: 'Reported found',
    after: { foundAt: now.toISOString(), foundNotes },
  })
  revalidatePath(`/equipment/${id}`)
  redirect(`/equipment/${id}`)
}

async function transferLocation(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const siteOrgUnitId = String(formData.get('siteOrgUnitId') ?? '').trim() || null
  const holderPersonId = String(formData.get('holderPersonId') ?? '').trim() || null
  const note = String(formData.get('note') ?? '').trim() || null
  if (!siteOrgUnitId && !holderPersonId) return

  await ctx.db(async (tx) => {
    await tx
      .update(equipmentItems)
      .set({
        currentSiteOrgUnitId: siteOrgUnitId,
        currentHolderPersonId: holderPersonId,
        lastSeenSiteOrgUnitId: siteOrgUnitId,
        lastSeenHolderPersonId: holderPersonId,
        lastSeenAt: new Date(),
        isMissing: false,
      })
      .where(eq(equipmentItems.id, id))
    await tx.insert(equipmentLocationHistory).values({
      tenantId: ctx.tenantId,
      itemId: id,
      siteOrgUnitId,
      holderPersonId,
      recordedByTenantUserId: ctx.membership?.id,
      note,
    })
  })
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: id,
    action: 'update',
    summary: 'Equipment transferred',
    after: { siteOrgUnitId, holderPersonId, note },
  })
  revalidatePath(`/equipment/${id}`)
}

async function createWorkOrder(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '')
  const summary = String(formData.get('summary') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const status = String(formData.get('status') ?? 'open') as
    | 'open'
    | 'assigned'
    | 'in_progress'
    | 'awaiting_parts'
    | 'repaired'
    | 'verified'
    | 'closed'
    | 'cancelled'
  if (!itemId || !summary) return

  const ref = await ctx.db(async (tx) => {
    const [agg] = await tx.select({ n: sql<number>`count(*)::int` }).from(equipmentWorkOrders)
    const next = ((agg?.n ?? 0) + 1).toString().padStart(4, '0')
    const reference = `WO-${new Date().getFullYear()}-${next}`
    await tx.insert(equipmentWorkOrders).values({
      tenantId: ctx.tenantId,
      itemId,
      reference,
      status,
      summary,
      description,
      openedByTenantUserId: ctx.membership?.id,
    })
    return reference
  })
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: itemId,
    action: 'create',
    summary: `Opened work order ${ref}`,
    after: { reference: ref, summary, status },
  })
  revalidatePath(`/equipment/${itemId}`)
}

async function addExpense(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const incurredOn = String(formData.get('incurredOn') ?? '').trim()
  const category = String(formData.get('category') ?? 'other').trim() || 'other'
  const vendor = String(formData.get('vendor') ?? '').trim() || null
  const description = String(formData.get('description') ?? '').trim() || null
  const amount = String(formData.get('amount') ?? '').trim()
  if (!itemId || !incurredOn || !amount) return
  const amountNum = Number(amount)
  if (!Number.isFinite(amountNum)) return

  const inserted = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(equipmentExpenses)
      .values({
        tenantId: ctx.tenantId,
        equipmentItemId: itemId,
        incurredOn,
        category,
        vendor,
        description,
        amount: amountNum.toFixed(2),
        createdByTenantUserId: ctx.membership?.id,
      })
      .returning({ id: equipmentExpenses.id })
    return row
  })
  if (inserted?.id) {
    await recordAudit(ctx, {
      entityType: 'equipment_expense',
      entityId: inserted.id,
      action: 'create',
      summary: `Logged ${amountNum.toFixed(2)} expense (${category})`,
      after: { itemId, incurredOn, category, amount: amountNum, vendor },
    })
  }
  revalidatePath(`/equipment/${itemId}`)
  // Strip the ?drawer param by redirecting to a clean URL (keep active tab).
  redirect(`/equipment/${itemId}?tab=expenses`)
}

async function addLogEntry(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const entryDate = String(formData.get('entryDate') ?? '').trim()
  const kind = String(formData.get('kind') ?? 'note').trim() || 'note'
  const title = String(formData.get('title') ?? '').trim() || null
  const details = String(formData.get('details') ?? '').trim()
  if (!itemId || !entryDate || !details) return

  const inserted = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(equipmentLogEntries)
      .values({
        tenantId: ctx.tenantId,
        equipmentItemId: itemId,
        entryDate,
        kind,
        title,
        details,
        createdByTenantUserId: ctx.membership?.id,
      })
      .returning({ id: equipmentLogEntries.id })
    return row
  })
  if (inserted?.id) {
    await recordAudit(ctx, {
      entityType: 'equipment_log_entry',
      entityId: inserted.id,
      action: 'create',
      summary: `Logged ${kind} entry`,
      after: { itemId, entryDate, kind, title, details: details.slice(0, 200) },
    })
  }
  revalidatePath(`/equipment/${itemId}`)
  redirect(`/equipment/${itemId}?tab=log`)
}

async function checkOutFromItem(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const holderPersonId = String(formData.get('holderPersonId') ?? '').trim() || null
  const destinationOrgUnitId = String(formData.get('destinationOrgUnitId') ?? '').trim() || null
  const expectedReturnOn = String(formData.get('expectedReturnOn') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!itemId) return

  const coId = await ctx.db(async (tx) => {
    const [row] = await tx
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
    return row?.id
  })
  await recordAudit(ctx, {
    entityType: 'equipment_checkout',
    entityId: coId ?? undefined,
    action: 'create',
    summary: 'Checked equipment out',
    after: { itemId, holderPersonId, destinationOrgUnitId, expectedReturnOn },
  })
  revalidatePath(`/equipment/${itemId}`)
  redirect(`/equipment/${itemId}?tab=checkouts`)
}

async function checkInFromItem(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const checkoutId = String(formData.get('checkoutId') ?? '').trim()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const condition = String(formData.get('returnedCondition') ?? 'good').trim() || 'good'
  const returnedNotes = String(formData.get('returnedNotes') ?? '').trim() || null
  if (!checkoutId || !itemId) return
  await ctx.db(async (tx) => {
    await tx
      .update(equipmentCheckouts)
      .set({
        returnedAt: new Date(),
        returnedCondition: condition as any,
        returnedNotes,
        checkedInByTenantUserId: ctx.membership?.id,
      })
      .where(eq(equipmentCheckouts.id, checkoutId))
    await tx
      .update(equipmentItems)
      .set({
        currentHolderPersonId: null,
        isAvailableForCheckout: true,
        lastSeenAt: new Date(),
      })
      .where(eq(equipmentItems.id, itemId))
  })
  await recordAudit(ctx, {
    entityType: 'equipment_checkout',
    entityId: checkoutId,
    action: 'update',
    summary: 'Checked equipment in',
    after: { condition, returnedNotes },
  })
  revalidatePath(`/equipment/${itemId}`)
  redirect(`/equipment/${itemId}?tab=checkouts`)
}

// ---------------- Typed server actions (drawer-friendly) ----------------

// Drawers `await` these and surface inline errors instead of throwing. Keep
// the bodies thin — most of the work delegates to the existing helpers /
// audit writer.

const PRIORITIES = ['low', 'med', 'high'] as const

async function createWorkOrderAction(input: {
  itemId: string
  summary: string
  description: string | null
  priority: 'low' | 'med' | 'high'
  assignedToTenantUserId: string | null
  reportedByPersonId: string | null
}): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  const { itemId, summary, description, priority, assignedToTenantUserId, reportedByPersonId } =
    input
  if (!itemId || !summary.trim()) return { ok: false, error: 'Summary is required.' }
  if (!PRIORITIES.includes(priority)) return { ok: false, error: 'Invalid priority.' }

  const row = await ctx.db(async (tx) => {
    const year = new Date().getFullYear()
    const counts = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(equipmentWorkOrders)
      .where(sql`extract(year from ${equipmentWorkOrders.openedAt}) = ${year}`)
    const c = counts[0]?.c ?? 0
    const reference = `WO-${year}-${String(Number(c) + 1).padStart(4, '0')}`
    const [inserted] = await tx
      .insert(equipmentWorkOrders)
      .values({
        tenantId: ctx.tenantId,
        itemId,
        reference,
        summary: summary.trim(),
        description,
        priority,
        status: 'open',
        reportedByPersonId,
        assignedToTenantUserId,
        openedByTenantUserId: ctx.membership?.id,
      } as any)
      .returning()
    return inserted
  })
  if (!row) return { ok: false, error: 'Failed to insert work order.' }

  await recordAudit(ctx, {
    entityType: 'equipment_work_order',
    entityId: row.id,
    action: 'create',
    summary: `Opened work order ${row.reference}: ${summary}`,
    after: { reference: row.reference, itemId, priority, summary, status: 'open' },
  })
  revalidatePath('/equipment/work-orders')
  revalidatePath(`/equipment/${itemId}`)
  return { ok: true }
}

async function createTruckLogEntryAction(input: {
  equipmentItemId: string
  entryDate: string
  driverPersonId: string | null
  startOdometer: number | null
  endOdometer: number | null
  siteOrgUnitId: string | null
  hoursOnSite: string | null
  manpowerCount: number | null
  notes: string | null
}): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  const {
    equipmentItemId,
    entryDate,
    driverPersonId,
    startOdometer,
    endOdometer,
    siteOrgUnitId,
    hoursOnSite,
    manpowerCount,
    notes,
  } = input
  if (!equipmentItemId || !entryDate.trim())
    return { ok: false, error: 'Truck and date are required.' }

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
        hoursOnSite,
        manpowerCount,
        notes,
        createdByTenantUserId: ctx.membership?.id,
      } as any)
      .returning()
    return inserted
  })
  if (!row) return { ok: false, error: 'Failed to insert log entry.' }

  await recordAudit(ctx, {
    entityType: 'truck_log_entry',
    entityId: row.id,
    action: 'create',
    summary: `Logged ${kmDriven ?? '—'} km on ${entryDate}`,
    after: { equipmentItemId, entryDate, kmDriven, manpowerCount, hoursOnSite },
  })
  revalidatePath('/equipment/truck-log')
  revalidatePath(`/equipment/${equipmentItemId}`)
  return { ok: true }
}

// ---------------- Page ----------------

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Equipment · ${id.slice(0, 8)}` }
}

export default async function EquipmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')

  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        item: equipmentItems,
        type: equipmentTypes,
        site: orgUnits,
        holder: people,
        missingReporter: { id: user.id, name: user.name },
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .leftJoin(user, eq(user.id, equipmentItems.missingReportedBy))
      .where(eq(equipmentItems.id, id))
      .limit(1)
    if (!row) return null

    const [
      history,
      workOrders,
      sites,
      holders,
      assignees,
      certAttachments,
      inspectionResponses,
      rateRow,
      expenseRows,
      logRows,
      checkoutRows,
    ] = await Promise.all([
      tx
        .select({ history: equipmentLocationHistory, site: orgUnits, holder: people })
        .from(equipmentLocationHistory)
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentLocationHistory.siteOrgUnitId))
        .leftJoin(people, eq(people.id, equipmentLocationHistory.holderPersonId))
        .where(eq(equipmentLocationHistory.itemId, id))
        .orderBy(desc(equipmentLocationHistory.recordedAt))
        .limit(50),
      tx
        .select()
        .from(equipmentWorkOrders)
        .where(eq(equipmentWorkOrders.itemId, id))
        .orderBy(desc(equipmentWorkOrders.openedAt))
        .limit(50),
      tx.select().from(orgUnits).orderBy(asc(orgUnits.name)).limit(200),
      tx
        .select()
        .from(people)
        .where(eq(people.status, 'active'))
        .orderBy(asc(people.lastName), asc(people.firstName))
        .limit(200),
      // Active tenant members for the work-order assignee dropdown.
      tx
        .select({
          id: tenantUsers.id,
          displayName: tenantUsers.displayName,
          userName: user.name,
          email: user.email,
        })
        .from(tenantUsers)
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(tenantUsers.status, 'active'))
        .orderBy(asc(tenantUsers.displayName))
        .limit(500),
      // "Certificates" — document-kind attachments linked to this equipment via metadata->>equipmentId
      tx
        .select()
        .from(attachments)
        .where(
          and(eq(attachments.kind, 'document'), sql`${attachments.exif}->>'equipmentId' = ${id}`),
        )
        .orderBy(desc(attachments.createdAt))
        .limit(50),
      tx
        .select({ response: formResponses, template: formTemplates })
        .from(formResponses)
        .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
        .where(
          and(
            eq(formResponses.sourceEntityType, 'equipment'),
            eq(formResponses.sourceEntityId, id),
          ),
        )
        .orderBy(desc(formResponses.submittedAt))
        .limit(50),
      // Rate for this item's type (one-row-per-type).
      row.type
        ? tx.select().from(equipmentRates).where(eq(equipmentRates.typeId, row.type.id)).limit(1)
        : Promise.resolve([]),
      // Per-item expense ledger.
      tx
        .select()
        .from(equipmentExpenses)
        .where(eq(equipmentExpenses.equipmentItemId, id))
        .orderBy(desc(equipmentExpenses.incurredOn))
        .limit(100),
      // Per-item freeform log.
      tx
        .select({ log: equipmentLogEntries, person: people })
        .from(equipmentLogEntries)
        .leftJoin(people, eq(people.id, equipmentLogEntries.personPersonId))
        .where(eq(equipmentLogEntries.equipmentItemId, id))
        .orderBy(desc(equipmentLogEntries.entryDate))
        .limit(100),
      // Per-item check-out history.
      tx
        .select({ co: equipmentCheckouts, holder: people, dest: orgUnits })
        .from(equipmentCheckouts)
        .leftJoin(people, eq(people.id, equipmentCheckouts.holderPersonId))
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentCheckouts.destinationOrgUnitId))
        .where(eq(equipmentCheckouts.equipmentItemId, id))
        .orderBy(desc(equipmentCheckouts.checkedOutAt))
        .limit(100),
    ])

    return {
      ...row,
      history,
      workOrders,
      sites,
      holders,
      assignees,
      certAttachments,
      inspectionResponses,
      rate: rateRow[0] ?? null,
      expenses: expenseRows,
      logEntries: logRows,
      checkouts: checkoutRows,
    }
  })

  if (!data) notFound()
  const {
    item,
    type,
    site,
    holder,
    missingReporter,
    history,
    workOrders,
    sites,
    holders,
    assignees,
    certAttachments,
    inspectionResponses,
    rate,
    expenses,
    logEntries,
    checkouts,
  } = data
  const openCheckout = checkouts.find((c) => c.co.returnedAt === null) ?? null
  const expensesYtd = expenses
    .filter((e) => {
      const yearStart = new Date()
      yearStart.setMonth(0, 1)
      yearStart.setHours(0, 0, 0, 0)
      return new Date(e.incurredOn) >= yearStart
    })
    .reduce((s, e) => s + (Number(e.amount) || 0), 0)

  const openWOs = workOrders.filter((w) => !['closed', 'cancelled'].includes(w.status))
  const basePath = `/equipment/${id}`
  // Drawer state is URL-driven; the active tab is preserved in the close URL
  // so that closing the drawer doesn't kick you back to the Overview tab.
  const drawerKey = pickString(sp.drawer)
  const closeHref = `${basePath}?tab=${active}`

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'equipment', id, 50) : []

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/equipment', label: 'Back to equipment' }}
          title={item.name}
          subtitle={`${item.assetTag}${item.serialNumber ? ` · ${item.serialNumber}` : ''}`}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={item.status === 'in_service' ? 'success' : 'warning'}>
                {item.status.replace('_', ' ')}
              </Badge>
              {item.isMissing ? <Badge variant="destructive">Missing</Badge> : null}
              {item.isDraft ? <Badge variant="outline">Draft</Badge> : null}
            </div>
          }
          actions={
            <>
              <Link href={`${basePath}?tab=edit` as any}>
                <Button variant="outline">
                  <Pencil size={14} />
                  Edit
                </Button>
              </Link>
              <Link href={`${basePath}?tab=work_orders&drawer=new-work-order` as any}>
                <Button variant="outline">
                  <Wrench size={14} />
                  New work order
                </Button>
              </Link>
              <Link href={`${basePath}?tab=log&drawer=new-truck-log-entry` as any}>
                <Button variant="outline">
                  <Truck size={14} />
                  Log entry
                </Button>
              </Link>
              <Link href={`/equipment/${id}/roi`}>
                <Button variant="outline">
                  <BarChart3 size={14} />
                  View ROI
                </Button>
              </Link>
              <Link href={`/equipment/${id}/qr`}>
                <Button variant="outline">
                  <QrCode size={14} />
                  QR
                </Button>
              </Link>
              {item.isMissing ? (
                <Link href={`${basePath}?drawer=report-found` as any}>
                  <Button variant="outline">
                    <Search size={14} />
                    Mark as found
                  </Button>
                </Link>
              ) : (
                <Link href={`${basePath}?drawer=report-missing` as any}>
                  <Button variant="outline">
                    <Search size={14} />
                    Report missing
                  </Button>
                </Link>
              )}
            </>
          }
        />

        {item.isMissing ? (
          <Alert variant="destructive">
            <AlertTitle>Reported missing</AlertTitle>
            <AlertDescription>
              {(() => {
                const parts: string[] = []
                if (item.missingReportedAt) {
                  parts.push(`Reported on ${new Date(item.missingReportedAt).toLocaleDateString()}`)
                }
                if (missingReporter?.name) {
                  parts.push(`by ${missingReporter.name}`)
                }
                if (item.missingLastSeenAt) {
                  parts.push(`— last seen ${item.missingLastSeenAt}`)
                }
                if (item.missingLastSeenLocation) {
                  parts.push(`at ${item.missingLastSeenLocation}`)
                }
                const headline = parts.length
                  ? parts.join(' ')
                  : `Last seen ${item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString() : '—'}`
                return (
                  <>
                    <div>{headline}.</div>
                    {item.missingNotes ? (
                      <div className="mt-1 text-xs whitespace-pre-wrap">{item.missingNotes}</div>
                    ) : null}
                    <div className="mt-1 text-xs">
                      Use <strong>Mark as found</strong> when the asset is recovered.
                    </div>
                  </>
                )
              })()}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-3">
            <Card>
              <CardContent className="space-y-3 p-5 text-sm">
                <div className="flex h-32 items-center justify-center rounded-md bg-slate-100 text-slate-400">
                  <Truck size={48} />
                </div>
                <div className="text-center">
                  <div className="text-base font-semibold">{item.name}</div>
                  <div className="text-xs text-slate-500">{type?.name ?? '—'}</div>
                </div>
                <div className="space-y-1.5 border-t border-slate-100 pt-3">
                  <SidebarRow label="Asset tag">{item.assetTag}</SidebarRow>
                  <SidebarRow label="Serial #">{item.serialNumber ?? '—'}</SidebarRow>
                  <SidebarRow label="Category">{type?.category ?? '—'}</SidebarRow>
                  <SidebarRow label="Site">{site?.name ?? '—'}</SidebarRow>
                  <SidebarRow label="Holder">
                    {holder ? `${holder.firstName} ${holder.lastName}` : '—'}
                  </SidebarRow>
                  <SidebarRow label="Billing">{item.billingRateCategory ?? '—'}</SidebarRow>
                  <SidebarRow label="Purchased">{item.purchaseDate ?? '—'}</SidebarRow>
                  <SidebarRow label="Warranty">{item.warrantyExpiresOn ?? '—'}</SidebarRow>
                </div>
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-4">
            <TabNav
              basePath={basePath}
              currentParams={sp}
              active={active}
              tabs={[
                { key: 'overview', label: 'Overview' },
                { key: 'maintenance', label: 'Maintenance' },
                { key: 'work_orders', label: 'Work orders', count: openWOs.length },
                { key: 'location', label: 'Location', count: history.length },
                { key: 'certificates', label: 'Certificates', count: certAttachments.length },
                {
                  key: 'inspections',
                  label: 'Inspections',
                  count: inspectionResponses.length,
                },
                { key: 'rates', label: 'Rates' },
                { key: 'expenses', label: 'Expenses', count: expenses.length },
                { key: 'log', label: 'Log', count: logEntries.length },
                { key: 'checkouts', label: 'Check-outs', count: checkouts.length },
                { key: 'activity', label: 'Activity' },
                { key: 'edit', label: 'Edit' },
              ]}
            />

            {/*
             * Tab body crossfade. The `key={active}` on TabContent means each
             * server-rendered swap triggers an AnimatePresence cycle so the
             * outgoing panel fades while the incoming one slides in.
             */}
            <TabContent tabKey={active}>
              {active === 'overview' ? (
                <Section title="General">
                  <DetailGrid
                    rows={[
                      { label: 'Name', value: item.name },
                      {
                        label: 'Asset tag',
                        value: <span className="font-mono">{item.assetTag}</span>,
                      },
                      { label: 'Serial #', value: item.serialNumber ?? '—' },
                      { label: 'Type', value: type?.name ?? '—' },
                      { label: 'Category', value: type?.category ?? '—' },
                      { label: 'Description', value: item.description ?? '—' },
                      { label: 'Current site', value: site?.name ?? '—' },
                      {
                        label: 'Current holder',
                        value: holder ? (
                          <Link
                            href={`/people/${holder.id}`}
                            className="text-teal-700 hover:underline"
                          >
                            {holder.firstName} {holder.lastName}
                          </Link>
                        ) : (
                          '—'
                        ),
                      },
                      { label: 'Purchased', value: item.purchaseDate ?? '—' },
                      { label: 'Warranty expires', value: item.warrantyExpiresOn ?? '—' },
                      { label: 'Billing category', value: item.billingRateCategory ?? '—' },
                      {
                        label: 'Last seen',
                        value: item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString() : '—',
                      },
                    ]}
                  />
                </Section>
              ) : null}

              {active === 'maintenance' ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Inspection settings</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <DetailGrid
                        rows={[
                          {
                            label: 'Requires pre-use inspection',
                            value: item.requiresPreUseInspection ? (
                              <Badge variant="success">Yes</Badge>
                            ) : (
                              <Badge variant="secondary">No</Badge>
                            ),
                          },
                          {
                            label: 'Pre-use template',
                            value: item.preUseInspectionTemplateKey ?? '—',
                          },
                          {
                            label: 'Last pre-use inspection',
                            value: item.lastPreUseInspectionAt
                              ? new Date(item.lastPreUseInspectionAt).toLocaleString()
                              : '—',
                          },
                          {
                            label: 'Requires annual inspection',
                            value: item.requiresAnnualInspection ? (
                              <Badge variant="success">Yes</Badge>
                            ) : (
                              <Badge variant="secondary">No</Badge>
                            ),
                          },
                          { label: 'Last annual', value: item.lastAnnualInspectionOn ?? '—' },
                          { label: 'Next annual due', value: item.nextAnnualInspectionDue ?? '—' },
                        ]}
                      />
                    </CardContent>
                  </Card>
                  <Section title="Start a new inspection">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <p className="text-slate-600">
                        Choose a form template bound to equipment inspection to start a new
                        inspection. The completed form will appear under the Inspections tab.
                      </p>
                      <Link
                        href={`/apps?category=inspection&sourceEntityType=equipment&sourceEntityId=${id}`}
                      >
                        <Button>
                          <ClipboardCheck size={14} /> Browse inspection forms
                        </Button>
                      </Link>
                    </div>
                  </Section>
                </div>
              ) : null}

              {active === 'work_orders' ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Work orders ({workOrders.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {workOrders.length === 0 ? (
                        <EmptyState
                          icon={<Wrench size={24} />}
                          title="No work orders"
                          description="Open a work order below to track repairs or scheduled service."
                        />
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Ref</TableHead>
                              <TableHead>Summary</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Opened</TableHead>
                              <TableHead>Closed</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {workOrders.map((w) => (
                              <TableRow key={w.id}>
                                <TableCell className="font-mono text-xs">{w.reference}</TableCell>
                                <TableCell>{w.summary}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      w.status === 'closed'
                                        ? 'success'
                                        : w.status === 'cancelled'
                                          ? 'secondary'
                                          : 'warning'
                                    }
                                  >
                                    {w.status.replace('_', ' ')}
                                  </Badge>
                                </TableCell>
                                <TableCell>{new Date(w.openedAt).toLocaleDateString()}</TableCell>
                                <TableCell>
                                  {w.closedAt ? new Date(w.closedAt).toLocaleDateString() : '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                  <Section title="Open a new work order">
                    <form
                      action={createWorkOrder}
                      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                    >
                      <input type="hidden" name="itemId" value={id} />
                      <Field label="Summary" required className="sm:col-span-2">
                        <Input
                          name="summary"
                          required
                          placeholder="e.g. Brake lights inoperative"
                        />
                      </Field>
                      <Field label="Initial status">
                        <Select name="status" defaultValue="open">
                          <option value="open">Open</option>
                          <option value="assigned">Assigned</option>
                          <option value="in_progress">In progress</option>
                          <option value="awaiting_parts">Awaiting parts</option>
                        </Select>
                      </Field>
                      <Field label="Description" className="sm:col-span-2">
                        <Textarea name="description" rows={3} placeholder="What's wrong?" />
                      </Field>
                      <div className="flex justify-end sm:col-span-2">
                        <Button type="submit">
                          <Wrench size={14} /> Create work order
                        </Button>
                      </div>
                    </form>
                  </Section>
                </div>
              ) : null}

              {active === 'location' ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Current location</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <MapPin size={16} className="text-slate-400" />
                        {site?.name ?? 'Unassigned'}
                      </div>
                      {holder ? (
                        <div className="text-slate-600">
                          Held by{' '}
                          <Link
                            href={`/people/${holder.id}`}
                            className="text-teal-700 hover:underline"
                          >
                            {holder.firstName} {holder.lastName}
                          </Link>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Location history ({history.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {history.length === 0 ? (
                        <p className="text-sm text-slate-500">No movement recorded.</p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>When</TableHead>
                              <TableHead>Site</TableHead>
                              <TableHead>Holder</TableHead>
                              <TableHead>Note</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {history.map((row) => (
                              <TableRow key={row.history.id}>
                                <TableCell>
                                  {new Date(row.history.recordedAt).toLocaleString()}
                                </TableCell>
                                <TableCell>{row.site?.name ?? '—'}</TableCell>
                                <TableCell>
                                  {row.holder
                                    ? `${row.holder.firstName} ${row.holder.lastName}`
                                    : '—'}
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  {row.history.note ?? '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                  <Section title="Transfer to a new location or holder">
                    <form
                      action={transferLocation}
                      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                    >
                      <input type="hidden" name="id" value={id} />
                      <Field label="Move to site">
                        <Select name="siteOrgUnitId" defaultValue={item.currentSiteOrgUnitId ?? ''}>
                          <option value="">— Unassigned —</option>
                          {sites.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Assign to person">
                        <PersonSelectField
                          name="holderPersonId"
                          defaultValue={item.currentHolderPersonId ?? ''}
                          options={holders.map((p) => ({
                            value: p.id,
                            label: `${p.lastName}, ${p.firstName}`,
                            hint: p.employeeNo ?? undefined,
                          }))}
                          placeholder="Select a person…"
                          clearable
                          emptyLabel="— No holder —"
                        />
                      </Field>
                      <Field label="Note" className="sm:col-span-2">
                        <Input name="note" placeholder="Optional context for the audit log" />
                      </Field>
                      <div className="flex justify-end sm:col-span-2">
                        <Button type="submit">
                          <ArrowLeftRight size={14} /> Record transfer
                        </Button>
                      </div>
                    </form>
                  </Section>
                </div>
              ) : null}

              {active === 'certificates' ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Certificates ({certAttachments.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {certAttachments.length === 0 ? (
                      <EmptyState
                        icon={<FileText size={24} />}
                        title="No certificates attached"
                        description="Upload calibration, inspection, or warranty certificates tagged to this equipment."
                      />
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>File</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Size</TableHead>
                            <TableHead>Uploaded</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {certAttachments.map((a) => (
                            <TableRow key={a.id}>
                              <TableCell className="font-medium">{a.filename}</TableCell>
                              <TableCell className="text-slate-600">{a.contentType}</TableCell>
                              <TableCell className="text-slate-600">
                                {humanSize(a.sizeBytes)}
                              </TableCell>
                              <TableCell>{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                              <TableCell>
                                <a
                                  href={publicUrl(a.r2Key)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-teal-700 hover:underline"
                                >
                                  Open →
                                </a>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              {active === 'inspections' ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Inspection history ({inspectionResponses.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {inspectionResponses.length === 0 ? (
                      <EmptyState
                        icon={<ClipboardCheck size={24} />}
                        title="No inspections recorded"
                        description="Pre-use, scheduled, and ad-hoc inspections (any form pinned to this equipment) appear here."
                        action={
                          <Link
                            href={`/apps?category=inspection&sourceEntityType=equipment&sourceEntityId=${id}`}
                          >
                            <Button variant="outline" size="sm">
                              Start an inspection →
                            </Button>
                          </Link>
                        }
                      />
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Form</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Submitted</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {inspectionResponses.map((r) => (
                            <TableRow key={r.response.id}>
                              <TableCell className="font-medium">{r.template.name}</TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    r.response.status === 'closed' ||
                                    r.response.status === 'submitted'
                                      ? 'success'
                                      : 'warning'
                                  }
                                >
                                  {r.response.status.replace('_', ' ')}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {r.response.submittedAt
                                  ? new Date(r.response.submittedAt).toLocaleDateString()
                                  : '—'}
                              </TableCell>
                              <TableCell>
                                <Link
                                  href={`/apps/responses/${r.response.id}`}
                                  className="text-xs text-teal-700 hover:underline"
                                >
                                  View →
                                </Link>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              {active === 'rates' ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Rates {type ? `(${type.name})` : ''}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {rate ? (
                      <div className="space-y-3">
                        <DetailGrid
                          rows={[
                            { label: 'Hourly', value: fmtMoney(rate.hourly, rate.currency) },
                            { label: 'Daily', value: fmtMoney(rate.daily, rate.currency) },
                            { label: 'Weekly', value: fmtMoney(rate.weekly, rate.currency) },
                            { label: 'Monthly', value: fmtMoney(rate.monthly, rate.currency) },
                            { label: 'Currency', value: rate.currency },
                            { label: 'Category', value: rate.category ?? '—' },
                          ]}
                        />
                        <div>
                          <Link
                            href="/equipment/rates"
                            className="text-xs text-teal-700 hover:underline"
                          >
                            Edit rate matrix →
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <EmptyState
                        title="No rate set for this type"
                        description={
                          type
                            ? `Set hourly / daily / weekly / monthly rates for ${type.name}.`
                            : 'Assign this item to an equipment type first.'
                        }
                        action={
                          <Link href="/equipment/rates">
                            <Button size="sm">Open rate matrix</Button>
                          </Link>
                        }
                      />
                    )}
                  </CardContent>
                </Card>
              ) : null}

              {active === 'expenses' ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                      <CardTitle>
                        Expenses ({expenses.length}) ·{' '}
                        <span className="text-sm font-normal text-slate-500">
                          {fmtMoney(expensesYtd.toFixed(2))} YTD
                        </span>
                      </CardTitle>
                      <Link href={`${basePath}?tab=expenses&drawer=add-expense` as any}>
                        <Button size="sm">
                          <Plus size={14} /> Add expense
                        </Button>
                      </Link>
                    </CardHeader>
                    <CardContent>
                      {expenses.length === 0 ? (
                        <EmptyState
                          title="No expenses logged"
                          description="Log fuel, repairs, parts, and registration against this item."
                          action={
                            <Link href={`${basePath}?tab=expenses&drawer=add-expense` as any}>
                              <Button size="sm" variant="outline">
                                <Plus size={14} /> Add expense
                              </Button>
                            </Link>
                          }
                        />
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Category</TableHead>
                              <TableHead>Vendor</TableHead>
                              <TableHead>Description</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {expenses.map((e) => (
                              <TableRow key={e.id}>
                                <TableCell className="font-mono text-xs">{e.incurredOn}</TableCell>
                                <TableCell>
                                  <Badge variant="secondary">{e.category}</Badge>
                                </TableCell>
                                <TableCell className="text-slate-600">{e.vendor ?? '—'}</TableCell>
                                <TableCell className="text-slate-600">
                                  {e.description ?? '—'}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {fmtMoney(e.amount, e.currency)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </div>
              ) : null}

              {active === 'log' ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                      <CardTitle>Log entries ({logEntries.length})</CardTitle>
                      <Link href={`${basePath}?tab=log&drawer=add-log` as any}>
                        <Button size="sm">
                          <Plus size={14} /> Add log entry
                        </Button>
                      </Link>
                    </CardHeader>
                    <CardContent>
                      {logEntries.length === 0 ? (
                        <EmptyState
                          title="No log entries"
                          description="Capture observations, fuel-ups, modifications, and other notes against this asset."
                          action={
                            <Link href={`${basePath}?tab=log&drawer=add-log` as any}>
                              <Button size="sm" variant="outline">
                                <Plus size={14} /> Add the first entry
                              </Button>
                            </Link>
                          }
                        />
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Kind</TableHead>
                              <TableHead>Title / details</TableHead>
                              <TableHead>Person</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {logEntries.map(({ log, person }) => (
                              <TableRow key={log.id}>
                                <TableCell className="font-mono text-xs">{log.entryDate}</TableCell>
                                <TableCell>
                                  <Badge variant="secondary">{log.kind}</Badge>
                                </TableCell>
                                <TableCell>
                                  {log.title ? (
                                    <div className="font-medium">{log.title}</div>
                                  ) : null}
                                  <div className="text-xs whitespace-pre-wrap text-slate-600">
                                    {log.details}
                                  </div>
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  {person ? `${person.firstName} ${person.lastName}` : '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </div>
              ) : null}

              {active === 'checkouts' ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                      <CardTitle>Check-out history ({checkouts.length})</CardTitle>
                      <div className="flex items-center gap-2">
                        {openCheckout ? (
                          <Link href={`${basePath}?tab=checkouts&drawer=check-in` as any}>
                            <Button size="sm">
                              <LogIn size={14} /> Check in
                            </Button>
                          </Link>
                        ) : (
                          <Link href={`${basePath}?tab=checkouts&drawer=check-out` as any}>
                            <Button size="sm">
                              <LogOut size={14} /> Check out
                            </Button>
                          </Link>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {checkouts.length === 0 ? (
                        <EmptyState
                          title="No checkout history"
                          description="This item has never been checked out. Use Check out to issue it to a person or site."
                          action={
                            <Link href={`${basePath}?tab=checkouts&drawer=check-out` as any}>
                              <Button size="sm" variant="outline">
                                <LogOut size={14} /> Check out
                              </Button>
                            </Link>
                          }
                        />
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Held by</TableHead>
                              <TableHead>Destination</TableHead>
                              <TableHead>Out</TableHead>
                              <TableHead>Expected</TableHead>
                              <TableHead>Returned</TableHead>
                              <TableHead>Condition</TableHead>
                              <TableHead>Notes</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {checkouts.map(({ co, holder, dest }) => (
                              <TableRow key={co.id}>
                                <TableCell>
                                  {holder ? `${holder.firstName} ${holder.lastName}` : '—'}
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  {dest?.name ?? '—'}
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  {new Date(co.checkedOutAt).toLocaleDateString()}
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  {co.expectedReturnOn ?? '—'}
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  {co.returnedAt
                                    ? new Date(co.returnedAt).toLocaleDateString()
                                    : '—'}
                                </TableCell>
                                <TableCell>
                                  {co.returnedCondition ? (
                                    <Badge
                                      variant={
                                        co.returnedCondition === 'damaged' ||
                                        co.returnedCondition === 'unusable'
                                          ? 'destructive'
                                          : co.returnedCondition === 'fair'
                                            ? 'warning'
                                            : 'success'
                                      }
                                    >
                                      {co.returnedCondition}
                                    </Badge>
                                  ) : co.returnedAt ? (
                                    '—'
                                  ) : (
                                    <Badge variant="warning">out</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="max-w-xs truncate text-xs text-slate-600">
                                  {co.returnedNotes ?? co.notes ?? '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                  {openCheckout ? (
                    <Alert>
                      <AlertTitle>Currently checked out</AlertTitle>
                      <AlertDescription>
                        Held by{' '}
                        {openCheckout.holder
                          ? `${openCheckout.holder.firstName} ${openCheckout.holder.lastName}`
                          : '—'}
                        {openCheckout.co.expectedReturnOn
                          ? ` · expected back ${openCheckout.co.expectedReturnOn}`
                          : ''}
                        . Use the Check in button above to record the return.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              ) : null}

              {active === 'activity' ? (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <Activity size={14} className="mr-2 inline" /> Activity
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ActivityFeed entries={activity} />
                  </CardContent>
                </Card>
              ) : null}

              {active === 'edit' ? <EquipmentEditTab itemId={id} /> : null}
            </TabContent>
          </div>
        </div>
      </div>

      {/*
       * Sub-entity drawers. Mounted once per page; only one renders open at
       * a time based on `?drawer=…`. Each form has an id so the sticky
       * footer's submit button can target it via the `form` attribute.
       * Closing (X / backdrop / Esc) pops back to closeHref preserving the
       * active tab.
       */}
      <UrlDrawer
        open={drawerKey === 'add-expense'}
        closeHref={closeHref}
        title="Log expense"
        description="Vendor invoice, fuel, repair, parts, etc — recorded against this asset's ledger."
        size="md"
        footer={
          <Button type="submit" form="equipment-add-expense-form">
            <Plus size={14} /> Log expense
          </Button>
        }
      >
        <form
          id="equipment-add-expense-form"
          action={addExpense}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="itemId" value={id} />
          <Field label="Date" required>
            <Input
              name="incurredOn"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Field label="Category" required>
            <Select name="category" defaultValue="other">
              <option value="fuel">Fuel</option>
              <option value="repair">Repair</option>
              <option value="maintenance">Maintenance</option>
              <option value="insurance">Insurance</option>
              <option value="registration">Registration</option>
              <option value="parts">Parts</option>
              <option value="tires">Tires</option>
              <option value="oil_change">Oil change</option>
              <option value="inspection">Inspection</option>
              <option value="other">Other</option>
            </Select>
          </Field>
          <Field label="Amount" required>
            <Input name="amount" type="number" step="0.01" min="0" required />
          </Field>
          <Field label="Vendor">
            <Input name="vendor" placeholder="e.g. Acme Auto" />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Input name="description" placeholder="Optional short description" />
          </Field>
        </form>
      </UrlDrawer>

      <UrlDrawer
        open={drawerKey === 'add-log'}
        closeHref={closeHref}
        title="Add log entry"
        description="Capture an observation, fuel-up, modification, or anything else worth recording against this asset."
        size="md"
        footer={
          <Button type="submit" form="equipment-add-log-form">
            <Plus size={14} /> Add entry
          </Button>
        }
      >
        <form
          id="equipment-add-log-form"
          action={addLogEntry}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="itemId" value={id} />
          <Field label="Date" required>
            <Input
              name="entryDate"
              type="date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Field label="Kind" required>
            <Select name="kind" defaultValue="note">
              <option value="note">Note</option>
              <option value="maintenance">Maintenance</option>
              <option value="fuel">Fuel</option>
              <option value="incident">Incident</option>
              <option value="modification">Modification</option>
            </Select>
          </Field>
          <Field label="Title" className="sm:col-span-2">
            <Input name="title" placeholder="Short summary (optional)" />
          </Field>
          <Field label="Details" required className="sm:col-span-2">
            <Textarea name="details" rows={5} required />
          </Field>
        </form>
      </UrlDrawer>

      <UrlDrawer
        open={drawerKey === 'report-missing' && !item.isMissing}
        closeHref={closeHref}
        title="Report missing"
        description="Capture when and where the asset was last seen so a follow-up search has context. The detail page will switch to a missing alert until someone marks it as found."
        size="md"
        footer={
          <Button type="submit" form="equipment-report-missing-form" variant="destructive">
            <Search size={14} /> Report missing
          </Button>
        }
      >
        <form
          id="equipment-report-missing-form"
          action={reportMissing}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="id" value={id} />
          <Field label="Last seen date">
            <Input
              name="lastSeenDate"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Field label="Last seen location">
            <Input
              name="lastSeenLocation"
              placeholder={site?.name ?? 'e.g. North yard, Truck 12, Apex shop'}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              name="notes"
              rows={3}
              placeholder="Anything to help the search — who had it last, suspected loss vs theft, etc."
            />
          </Field>
        </form>
      </UrlDrawer>

      <UrlDrawer
        open={drawerKey === 'report-found' && item.isMissing}
        closeHref={closeHref}
        title="Mark as found"
        description="Clear the missing flag and optionally note where the asset was recovered. The original missing report is retained for audit."
        size="md"
        footer={
          <Button type="submit" form="equipment-report-found-form">
            <Search size={14} /> Mark as found
          </Button>
        }
      >
        <form
          id="equipment-report-found-form"
          action={reportFound}
          className="grid grid-cols-1 gap-3"
        >
          <input type="hidden" name="id" value={id} />
          <Field label="Found notes (optional)">
            <Textarea
              name="foundNotes"
              rows={3}
              placeholder="Where was it recovered? Any damage to flag?"
            />
          </Field>
          <p className="text-xs text-slate-500">
            The found timestamp is set to now. Use the Location tab to record the current site /
            holder once the asset is back in place.
          </p>
        </form>
      </UrlDrawer>

      <UrlDrawer
        open={drawerKey === 'check-out' && !openCheckout}
        closeHref={closeHref}
        title="Check out"
        description="Hand this item to a person, pin it to a site, and optionally set an expected return date."
        size="md"
        footer={
          <Button type="submit" form="equipment-check-out-form">
            <LogOut size={14} /> Check out
          </Button>
        }
      >
        <form
          id="equipment-check-out-form"
          action={checkOutFromItem}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="itemId" value={id} />
          <Field label="Hand to person">
            <PersonSelectField
              name="holderPersonId"
              defaultValue=""
              options={holders.map((p) => ({
                value: p.id,
                label: `${p.lastName}, ${p.firstName}`,
                hint: p.employeeNo ?? undefined,
              }))}
              placeholder="Select a person…"
              clearable
              emptyLabel="— No specific holder —"
            />
          </Field>
          <Field label="Destination site">
            <Select name="destinationOrgUnitId" defaultValue="">
              <option value="">— Unassigned —</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Expected return on">
            <Input name="expectedReturnOn" type="date" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea name="notes" rows={3} placeholder="Optional context for this checkout" />
          </Field>
        </form>
      </UrlDrawer>

      <NewWorkOrderDrawer
        open={drawerKey === 'new-work-order'}
        closeHref={closeHref}
        itemId={id}
        assignees={assignees}
        reporters={holders}
        action={createWorkOrderAction}
      />

      <NewTruckLogEntryDrawer
        open={drawerKey === 'new-truck-log-entry'}
        closeHref={closeHref}
        itemId={id}
        drivers={holders}
        sites={sites.filter((s) => s.level === 'site')}
        defaultDate={new Date().toISOString().slice(0, 10)}
        action={createTruckLogEntryAction}
      />

      <UrlDrawer
        open={drawerKey === 'check-in' && !!openCheckout}
        closeHref={closeHref}
        title="Check in (return)"
        description={
          openCheckout
            ? `Record return from ${
                openCheckout.holder
                  ? `${openCheckout.holder.firstName} ${openCheckout.holder.lastName}`
                  : 'the current holder'
              }.`
            : 'This item is not currently checked out.'
        }
        size="md"
        footer={
          openCheckout ? (
            <Button type="submit" form="equipment-check-in-form">
              <LogIn size={14} /> Check in
            </Button>
          ) : null
        }
      >
        {openCheckout ? (
          <form
            id="equipment-check-in-form"
            action={checkInFromItem}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          >
            <input type="hidden" name="itemId" value={id} />
            <input type="hidden" name="checkoutId" value={openCheckout.co.id} />
            <Field label="Returned condition">
              <Select name="returnedCondition" defaultValue="good">
                <option value="good">Good</option>
                <option value="fair">Fair</option>
                <option value="damaged">Damaged</option>
                <option value="unusable">Unusable</option>
              </Select>
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea
                name="returnedNotes"
                rows={3}
                placeholder="Anything to note about this return"
              />
            </Field>
          </form>
        ) : (
          <p className="text-sm text-slate-500">
            There's no open check-out for this item right now.
          </p>
        )}
      </UrlDrawer>
    </PageContainer>
  )
}

function SidebarRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-xs tracking-wide text-slate-500 uppercase">{label}</span>
      <span>{children}</span>
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

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
