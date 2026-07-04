import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import {
  Activity,
  ArrowLeftRight,
  BellRing,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  LogIn,
  LogOut,
  MapPin,
  Plus,
  QrCode,
  Search,
  Trash2,
  Truck,
  Wrench,
} from 'lucide-react'
import { NewWorkOrderDrawer } from './_work-order-drawer'
import { NewTruckLogEntryDrawer } from './_truck-log-drawer'
import { EquipmentFileDrawer } from './_files-drawer'
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
import { clamp, mergeHref, pickString } from '@/lib/list-params'
import {
  LiveField,
  LivePersonSelect,
  LiveRichText,
  LiveSelect,
  LiveToggle,
} from '@/components/live-field'
import {
  attachments,
  equipmentCategories,
  equipmentCheckouts,
  equipmentInspectionRecords,
  equipmentInspectionSchedules,
  equipmentInspectionTypes,
  equipmentItems,
  equipmentLocationHistory,
  equipmentLogEntries,
  equipmentReminders,
  equipmentTypes,
  equipmentWorkOrders,
  orgUnits,
  people,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import type { Database } from '@beaconhs/db'
import { deleteObject, publicUrl } from '@beaconhs/storage'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { ActivityFeed } from '@/components/activity-feed'
import { PageContainer } from '@/components/page-layout'
import { PersonSelectField } from '@/components/person-select-field'
import { SearchInput } from '@/components/search-input'
import { readCustomFieldValues } from '@beaconhs/forms-core'
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section'
import { CustomFieldInput } from '@/components/custom-fields/custom-field-input'
import { loadVisibleCustomFieldDefs, type CustomFieldDefRow } from '@/lib/custom-fields/queries'
import { updateCustomFieldValueAction } from '@/lib/custom-fields/actions'
import {
  EQUIPMENT_FIELD_GROUPS,
  resolveEnabledFieldGroups,
  type EquipmentNativeField,
} from '@/lib/equipment/field-groups'
import { formatInterval } from '@/lib/equipment/intervals'
import { upsertVehicleLogEntry } from '../vehicle-log/_service'
import { checkInEquipment } from '../_actions'
import { completeEquipmentReminder } from '../_maintenance-actions'
import {
  ReminderDrawer,
  ScheduleDrawer,
  type ReminderEditing,
  type ScheduleEditing,
} from '../_maintenance-drawers'
import { createEquipmentWorkOrder } from '../work-orders/_lib'

export const dynamic = 'force-dynamic'

const TABS = [
  'overview',
  'location',
  'inspections',
  'work_orders',
  'log',
  'files',
  'activity',
] as const
type Tab = (typeof TABS)[number]

const EQUIPMENT_STATUSES = ['in_service', 'out_of_service', 'in_repair', 'lost', 'retired'] as const

// Field-group registry fields, keyed by column name — the autosave action
// validates registry-driven inputs against this map so the Overview's
// per-category sections and the server allowlist can never drift.
const REGISTRY_FIELDS = new Map<string, EquipmentNativeField>(
  EQUIPMENT_FIELD_GROUPS.flatMap((g) => g.fields.map((f) => [f.field, f] as const)),
)

// Sub-tables share one page; each gets prefixed search/pagination params
// (e.g. ?wo_q=&wo_p=2) so filtering work orders never resets the log table.
const SUB_PER_PAGE = 15
type SubParams = { q: string | undefined; page: number; offset: number }
function subParams(sp: Record<string, string | string[] | undefined>, prefix: string): SubParams {
  const q = pickString(sp[`${prefix}_q`])?.trim() || undefined
  const page = clamp(Number(pickString(sp[`${prefix}_p`]) ?? '1'), 1, 10_000)
  return { q, page, offset: (page - 1) * SUB_PER_PAGE }
}

// Recompute the cached availability flag from its inputs (see the schema note
// on equipment_items.is_available_for_checkout): available ⇔ no holder AND
// in service AND not missing AND no open checkout. Every action here that can
// change one of those inputs calls this so the register's availability filter
// and the station's available count never drift.
async function refreshAvailability(tx: Database, itemId: string) {
  const [item] = await tx
    .select({
      status: equipmentItems.status,
      holder: equipmentItems.currentHolderPersonId,
      isMissing: equipmentItems.isMissing,
    })
    .from(equipmentItems)
    .where(eq(equipmentItems.id, itemId))
    .limit(1)
  if (!item) return
  const [open] = await tx
    .select({ id: equipmentCheckouts.id })
    .from(equipmentCheckouts)
    .where(
      and(eq(equipmentCheckouts.equipmentItemId, itemId), isNull(equipmentCheckouts.returnedAt)),
    )
    .limit(1)
  const available = item.holder === null && item.status === 'in_service' && !item.isMissing && !open
  await tx
    .update(equipmentItems)
    .set({ isAvailableForCheckout: available })
    .where(eq(equipmentItems.id, itemId))
}

// ---------------- Server actions ----------------

// Inline field editor — the single-page form's workhorse. Each Live* field
// posts {id, field, value}; this validates the field against an allowlist,
// coerces it for its column, persists, audits, and revalidates. Editing any
// field commits a draft item (clears the Draft badge), mirroring the old save.
async function updateEquipmentField(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const raw = formData.get('value')
  const value = typeof raw === 'string' ? raw : ''
  if (!id || !field) throw new Error('Missing id/field')

  const TEXT = new Set(['name', 'assetTag', 'serialNumber', 'description', 'notes'])
  const TEXT_NOTNULL = new Set(['name', 'assetTag'])
  const NULLABLE_IDS = new Set([
    'typeId',
    'categoryId',
    'currentSiteOrgUnitId',
    'currentHolderPersonId',
    'preUseInspectionTypeId',
  ])
  const BOOLS = new Set(['requiresPreUseInspection'])
  const ENUMS: Record<string, readonly string[]> = { status: EQUIPMENT_STATUSES }
  const registryField = REGISTRY_FIELDS.get(field)

  const allowed =
    field in ENUMS ||
    TEXT.has(field) ||
    NULLABLE_IDS.has(field) ||
    BOOLS.has(field) ||
    registryField != null
  if (!allowed) throw new Error('Field not allowed')

  let val: unknown
  if (field in ENUMS) {
    if (!ENUMS[field]!.includes(value)) throw new Error('Invalid value')
    val = value
  } else if (NULLABLE_IDS.has(field)) {
    val = value || null
  } else if (BOOLS.has(field)) {
    val = value === 'true' || value === 'on' || value === '1'
  } else if (TEXT.has(field)) {
    const trimmed = value.trim()
    if (TEXT_NOTNULL.has(field) && trimmed === '') throw new Error('This field is required')
    val = trimmed === '' ? null : trimmed
  } else {
    // Field-group registry field — coerce per its declared type.
    const trimmed = value.trim()
    if (registryField!.type === 'date') {
      val = trimmed || null
    } else if (registryField!.type === 'select') {
      const options = registryField!.options ?? []
      if (trimmed && !options.some((o) => o.value === trimmed)) throw new Error('Invalid value')
      val = trimmed || null
    } else if (registryField!.type === 'number') {
      if (trimmed === '') {
        val = null
      } else if (registryField!.numeric === 'int') {
        const n = Number(trimmed)
        if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error('Enter a whole number')
        val = Math.trunc(n)
      } else {
        // numeric column — persisted as a decimal string.
        if (!/^-?\d{1,10}(\.\d{1,4})?$/.test(trimmed)) throw new Error('Enter a valid number')
        val = trimmed
      }
    } else {
      val = trimmed || null
    }
  }

  await ctx.db(async (tx) => {
    await tx
      .update(equipmentItems)
      .set({
        [field]: val,
        // Editing the asset commits a draft (clears the Draft badge).
        isDraft: false,
        // Meter readings carry a read-at timestamp so staleness is visible.
        ...(field === 'currentHours' || field === 'currentOdometer'
          ? { metersUpdatedAt: new Date() }
          : {}),
      } as any)
      .where(eq(equipmentItems.id, id))
    // Holder/status feed the cached availability flag.
    if (field === 'currentHolderPersonId' || field === 'status') {
      await refreshAvailability(tx, id)
    }
  })
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: id,
    action: 'update',
    summary: `Updated ${field}`,
    after: { [field]: val },
  })
  revalidatePath(`/equipment/${id}`)
  revalidatePath('/equipment')
}

async function reportMissing(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
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
        // A missing item is never available for check-out.
        isAvailableForCheckout: false,
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
  assertCan(ctx, 'equipment.manage')
  const id = String(formData.get('id') ?? '')
  const foundNotes = String(formData.get('foundNotes') ?? '').trim() || null
  if (!id) return
  const now = new Date()
  await ctx.db(async (tx) => {
    await tx
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
      .where(eq(equipmentItems.id, id))
    await refreshAvailability(tx, id)
  })
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
  assertCan(ctx, 'equipment.manage')
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
    await refreshAvailability(tx, id)
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

async function addLogEntry(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
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
  assertCan(ctx, 'equipment.manage')
  const itemId = String(formData.get('itemId') ?? '').trim()
  const holderPersonId = String(formData.get('holderPersonId') ?? '').trim() || null
  const destinationOrgUnitId = String(formData.get('destinationOrgUnitId') ?? '').trim() || null
  const expectedReturnOn = String(formData.get('expectedReturnOn') ?? '').trim() || null
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!itemId) return

  const coId = await ctx.db(async (tx) => {
    // Server-side guards mirroring the station core — the UI hides the button
    // while a checkout is open, but a double submit / second tab must not
    // create two open checkouts or check out an unserviceable asset.
    const [item] = await tx
      .select({ status: equipmentItems.status })
      .from(equipmentItems)
      .where(and(eq(equipmentItems.id, itemId), isNull(equipmentItems.deletedAt)))
      .limit(1)
    if (!item) throw new Error('Equipment item not found')
    if (item.status !== 'in_service') {
      throw new Error(`Cannot check out: item is ${item.status.replace(/_/g, ' ')}`)
    }
    const [open] = await tx
      .select({ id: equipmentCheckouts.id })
      .from(equipmentCheckouts)
      .where(
        and(eq(equipmentCheckouts.equipmentItemId, itemId), isNull(equipmentCheckouts.returnedAt)),
      )
      .limit(1)
    if (open) throw new Error('This item is already checked out')

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
    await tx.insert(equipmentLocationHistory).values({
      tenantId: ctx.tenantId,
      itemId,
      siteOrgUnitId: destinationOrgUnitId,
      holderPersonId,
      recordedByTenantUserId: ctx.membership?.id,
      note: `Checked out${notes ? ` — ${notes}` : ''}`,
    })
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
  redirect(`/equipment/${itemId}?tab=location`)
}

// Delegates to the shared checkInEquipment action, which verifies the checkout
// is still open, validates the condition, writes the location-history row,
// audits, and derives availability from the item's status.
async function checkInFromItem(formData: FormData) {
  'use server'
  const checkoutId = String(formData.get('checkoutId') ?? '').trim()
  const itemId = String(formData.get('itemId') ?? '').trim()
  if (!checkoutId || !itemId) return
  const fd = new FormData()
  fd.set('id', checkoutId)
  fd.set('returnedCondition', String(formData.get('returnedCondition') ?? 'good'))
  fd.set('returnedNotes', String(formData.get('returnedNotes') ?? ''))
  await checkInEquipment(fd)
  redirect(`/equipment/${itemId}?tab=location`)
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
  assertCan(ctx, 'equipment.workorder.create')
  const { itemId, summary, description, priority, assignedToTenantUserId, reportedByPersonId } =
    input
  if (!itemId || !summary.trim()) return { ok: false, error: 'Summary is required.' }
  if (!PRIORITIES.includes(priority)) return { ok: false, error: 'Invalid priority.' }

  // Shared creator: reference generation + audit + on_create module flows +
  // revalidation live in one place with the full-page /work-orders/new form.
  const row = await createEquipmentWorkOrder(ctx, {
    itemId,
    summary: summary.trim(),
    description,
    priority,
    assignedToTenantUserId,
    reportedByPersonId,
  })
  if (!row) return { ok: false, error: 'Failed to insert work order.' }
  return { ok: true }
}

async function createTruckLogEntryAction(input: {
  equipmentItemId: string
  entryDate: string
  driverPersonId: string
  startOdometer: number | null
  endOdometer: number | null
  siteOrgUnitId: string | null
  hoursOnSite: string | null
  manpowerCount: number | null
  notes: string | null
}): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
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
    return { ok: false, error: 'Vehicle and date are required.' }
  if (!driverPersonId) return { ok: false, error: 'Driver is required.' }

  await upsertVehicleLogEntry(ctx, {
    equipmentItemId,
    entryDate,
    driverPersonId,
    entryMode: 'odometer',
    startOdometer,
    endOdometer,
    siteOrgUnitId,
    hoursOnSite,
    manpowerCount,
    notes,
  })
  return { ok: true }
}

const EQUIPMENT_FILE_KINDS = ['certificate', 'manual', 'photo', 'receipt', 'warranty', 'other']

// Tag an already-uploaded attachment as a file for this asset. The file is
// uploaded via the shared FileUploader (which inserts the `attachments` row);
// this stamps `exif.equipmentId` (plus category + optional label) so it surfaces
// under the Files tab.
async function attachEquipmentFile(input: {
  itemId: string
  attachmentId: string
  kind: string
  label: string | null
}): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const itemId = input.itemId.trim()
  const attachmentId = input.attachmentId.trim()
  if (!itemId || !attachmentId) return { ok: false, error: 'Missing file.' }
  const kind = EQUIPMENT_FILE_KINDS.includes(input.kind) ? input.kind : 'other'

  const att = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1)
    return row
  })
  if (!att) return { ok: false, error: 'Uploaded file not found.' }

  const label = input.label?.trim() || null
  await ctx.db((tx) =>
    tx
      .update(attachments)
      .set({
        exif: { ...(att.exif ?? {}), equipmentId: itemId, kind, ...(label ? { label } : {}) },
      })
      .where(eq(attachments.id, attachmentId)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: itemId,
    action: 'update',
    summary: `Uploaded file ${label ?? att.filename}`,
    after: { attachmentId, filename: att.filename, kind, label },
  })
  revalidatePath(`/equipment/${itemId}`)
  return { ok: true }
}

async function deleteEquipmentFile(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const itemId = String(formData.get('itemId') ?? '').trim()
  const attachmentId = String(formData.get('attachmentId') ?? '').trim()
  if (!itemId || !attachmentId) return

  const att = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1)
    return row
  })
  // Only delete a document actually tagged to this asset (defence in depth).
  if (!att || (att.exif as Record<string, unknown> | null)?.equipmentId !== itemId) return

  await ctx.db((tx) => tx.delete(attachments).where(eq(attachments.id, attachmentId)))
  // Best-effort removal of the underlying object; the DB row is the record of truth.
  try {
    await deleteObject({ key: att.r2Key })
  } catch {
    // Orphaned object is harmless; the file no longer appears in the app.
  }
  await recordAudit(ctx, {
    entityType: 'equipment',
    entityId: itemId,
    action: 'delete',
    summary: `Removed file ${att.filename}`,
    before: { attachmentId, filename: att.filename },
  })
  revalidatePath(`/equipment/${itemId}`)
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

  // Per-table search + pagination state (URL-driven, prefixed per table).
  const woP = subParams(sp, 'wo')
  const coP = subParams(sp, 'co')
  const lhP = subParams(sp, 'lh')
  const insP = subParams(sp, 'ins')
  const logP = subParams(sp, 'log')
  const fP = subParams(sp, 'f')

  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        item: equipmentItems,
        type: equipmentTypes,
        category: equipmentCategories,
        site: orgUnits,
        holder: people,
        missingReporter: { id: user.id, name: user.name },
        photoKey: attachments.r2Key,
      })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentItems.categoryId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .leftJoin(user, eq(user.id, equipmentItems.missingReportedBy))
      .leftJoin(attachments, eq(attachments.id, equipmentItems.photoAttachmentId))
      .where(and(eq(equipmentItems.id, id), isNull(equipmentItems.deletedAt)))
      .limit(1)
    if (!row) return null

    // Read-tier scope (mirrors the list): read.all → any asset; read.site →
    // assets at the caller's sites; neither → only assets they currently hold.
    // Closes the view-by-URL gap for site/no-tier users.
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'equipment',
      siteId: row.item.currentSiteOrgUnitId,
      personId: row.item.currentHolderPersonId,
    })
    if (!visible) return null

    // Per-table filters: item scope + optional ilike search.
    const woWhere = and(
      eq(equipmentWorkOrders.itemId, id),
      woP.q
        ? or(
            ilike(equipmentWorkOrders.reference, `%${woP.q}%`),
            ilike(equipmentWorkOrders.summary, `%${woP.q}%`),
            ilike(equipmentWorkOrders.description, `%${woP.q}%`),
          )
        : undefined,
    )
    const coWhere = and(
      eq(equipmentCheckouts.equipmentItemId, id),
      coP.q
        ? or(
            ilike(people.firstName, `%${coP.q}%`),
            ilike(people.lastName, `%${coP.q}%`),
            ilike(orgUnits.name, `%${coP.q}%`),
            ilike(equipmentCheckouts.notes, `%${coP.q}%`),
            ilike(equipmentCheckouts.returnedNotes, `%${coP.q}%`),
          )
        : undefined,
    )
    const lhWhere = and(
      eq(equipmentLocationHistory.itemId, id),
      lhP.q
        ? or(
            ilike(orgUnits.name, `%${lhP.q}%`),
            ilike(people.firstName, `%${lhP.q}%`),
            ilike(people.lastName, `%${lhP.q}%`),
            ilike(equipmentLocationHistory.note, `%${lhP.q}%`),
          )
        : undefined,
    )
    const insWhere = and(
      eq(equipmentInspectionRecords.equipmentItemId, id),
      isNull(equipmentInspectionRecords.deletedAt),
      insP.q
        ? or(
            ilike(equipmentInspectionRecords.reference, `%${insP.q}%`),
            ilike(equipmentInspectionTypes.name, `%${insP.q}%`),
            ilike(equipmentInspectionRecords.intervalLabel, `%${insP.q}%`),
          )
        : undefined,
    )
    const logWhere = and(
      eq(equipmentLogEntries.equipmentItemId, id),
      logP.q
        ? or(
            ilike(equipmentLogEntries.title, `%${logP.q}%`),
            ilike(equipmentLogEntries.details, `%${logP.q}%`),
            ilike(equipmentLogEntries.kind, `%${logP.q}%`),
          )
        : undefined,
    )
    const fWhere = and(
      eq(attachments.kind, 'document'),
      sql`${attachments.exif}->>'equipmentId' = ${id}`,
      fP.q
        ? or(
            ilike(attachments.filename, `%${fP.q}%`),
            sql`${attachments.exif}->>'label' ILIKE ${`%${fP.q}%`}`,
            sql`${attachments.exif}->>'kind' ILIKE ${`%${fP.q}%`}`,
          )
        : undefined,
    )

    const [
      history,
      historyTotal,
      workOrders,
      workOrdersTotal,
      openWoCountRow,
      sites,
      holders,
      assignees,
      certAttachments,
      certTotal,
      inspectionRecords,
      inspectionsTotal,
      logRows,
      logTotal,
      checkoutRows,
      checkoutsTotal,
      openCheckoutRow,
      schedules,
      openReminders,
      itemInspectionTypes,
      allTypes,
      allCategories,
    ] = await Promise.all([
      tx
        .select({ history: equipmentLocationHistory, site: orgUnits, holder: people })
        .from(equipmentLocationHistory)
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentLocationHistory.siteOrgUnitId))
        .leftJoin(people, eq(people.id, equipmentLocationHistory.holderPersonId))
        .where(lhWhere)
        .orderBy(desc(equipmentLocationHistory.recordedAt))
        .limit(SUB_PER_PAGE)
        .offset(lhP.offset),
      tx
        .select({ c: count() })
        .from(equipmentLocationHistory)
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentLocationHistory.siteOrgUnitId))
        .leftJoin(people, eq(people.id, equipmentLocationHistory.holderPersonId))
        .where(lhWhere)
        .then((r) => Number(r[0]?.c ?? 0)),
      tx
        .select()
        .from(equipmentWorkOrders)
        .where(woWhere)
        .orderBy(desc(equipmentWorkOrders.openedAt))
        .limit(SUB_PER_PAGE)
        .offset(woP.offset),
      tx
        .select({ c: count() })
        .from(equipmentWorkOrders)
        .where(woWhere)
        .then((r) => Number(r[0]?.c ?? 0)),
      tx
        .select({ c: count() })
        .from(equipmentWorkOrders)
        .where(
          and(
            eq(equipmentWorkOrders.itemId, id),
            sql`${equipmentWorkOrders.status} NOT IN ('closed', 'cancelled')`,
          ),
        )
        .then((r) => Number(r[0]?.c ?? 0)),
      tx
        .select()
        .from(orgUnits)
        .where(isNull(orgUnits.deletedAt))
        .orderBy(asc(orgUnits.name))
        .limit(500),
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
        .where(fWhere)
        .orderBy(desc(attachments.createdAt))
        .limit(SUB_PER_PAGE)
        .offset(fP.offset),
      tx
        .select({ c: count() })
        .from(attachments)
        .where(fWhere)
        .then((r) => Number(r[0]?.c ?? 0)),
      tx
        .select({ record: equipmentInspectionRecords, type: equipmentInspectionTypes })
        .from(equipmentInspectionRecords)
        .leftJoin(
          equipmentInspectionTypes,
          eq(equipmentInspectionTypes.id, equipmentInspectionRecords.inspectionTypeId),
        )
        .where(insWhere)
        .orderBy(desc(equipmentInspectionRecords.occurredAt))
        .limit(SUB_PER_PAGE)
        .offset(insP.offset),
      tx
        .select({ c: count() })
        .from(equipmentInspectionRecords)
        .leftJoin(
          equipmentInspectionTypes,
          eq(equipmentInspectionTypes.id, equipmentInspectionRecords.inspectionTypeId),
        )
        .where(insWhere)
        .then((r) => Number(r[0]?.c ?? 0)),
      // Per-item freeform log.
      tx
        .select({ log: equipmentLogEntries, person: people })
        .from(equipmentLogEntries)
        .leftJoin(people, eq(people.id, equipmentLogEntries.personPersonId))
        .where(logWhere)
        .orderBy(desc(equipmentLogEntries.entryDate))
        .limit(SUB_PER_PAGE)
        .offset(logP.offset),
      tx
        .select({ c: count() })
        .from(equipmentLogEntries)
        .where(logWhere)
        .then((r) => Number(r[0]?.c ?? 0)),
      // Per-item check-out history.
      tx
        .select({ co: equipmentCheckouts, holder: people, dest: orgUnits })
        .from(equipmentCheckouts)
        .leftJoin(people, eq(people.id, equipmentCheckouts.holderPersonId))
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentCheckouts.destinationOrgUnitId))
        .where(coWhere)
        .orderBy(desc(equipmentCheckouts.checkedOutAt))
        .limit(SUB_PER_PAGE)
        .offset(coP.offset),
      tx
        .select({ c: count() })
        .from(equipmentCheckouts)
        .leftJoin(people, eq(people.id, equipmentCheckouts.holderPersonId))
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentCheckouts.destinationOrgUnitId))
        .where(coWhere)
        .then((r) => Number(r[0]?.c ?? 0)),
      // The open checkout (if any) — independent of the paginated history.
      tx
        .select({ co: equipmentCheckouts, holder: people })
        .from(equipmentCheckouts)
        .leftJoin(people, eq(people.id, equipmentCheckouts.holderPersonId))
        .where(
          and(eq(equipmentCheckouts.equipmentItemId, id), isNull(equipmentCheckouts.returnedAt)),
        )
        .limit(1)
        .then((r) => r[0] ?? null),
      // Recurring inspection schedules for this unit.
      tx
        .select({ schedule: equipmentInspectionSchedules, type: equipmentInspectionTypes })
        .from(equipmentInspectionSchedules)
        .leftJoin(
          equipmentInspectionTypes,
          eq(equipmentInspectionTypes.id, equipmentInspectionSchedules.inspectionTypeId),
        )
        .where(eq(equipmentInspectionSchedules.equipmentItemId, id))
        .orderBy(asc(equipmentInspectionSchedules.nextDueOn)),
      // Open ad-hoc reminders for this unit.
      tx
        .select({ reminder: equipmentReminders, assignee: people })
        .from(equipmentReminders)
        .leftJoin(people, eq(people.id, equipmentReminders.assignedToPersonId))
        .where(
          and(eq(equipmentReminders.equipmentItemId, id), isNull(equipmentReminders.completedAt)),
        )
        .orderBy(asc(equipmentReminders.dueOn))
        .limit(50),
      // Active inspection types applicable to this item (schedule drawer picker).
      tx
        .select({
          id: equipmentInspectionTypes.id,
          name: equipmentInspectionTypes.name,
          intervalValue: equipmentInspectionTypes.intervalValue,
          intervalUnit: equipmentInspectionTypes.intervalUnit,
          isPreUse: equipmentInspectionTypes.isPreUse,
          appliesToTypeId: equipmentInspectionTypes.appliesToTypeId,
        })
        .from(equipmentInspectionTypes)
        .where(eq(equipmentInspectionTypes.isActive, true))
        .orderBy(asc(equipmentInspectionTypes.name)),
      // Full type list for the Overview type picker.
      tx
        .select({ id: equipmentTypes.id, name: equipmentTypes.name })
        .from(equipmentTypes)
        .orderBy(asc(equipmentTypes.name)),
      // Category list for the Overview category picker.
      tx
        .select({ id: equipmentCategories.id, name: equipmentCategories.name })
        .from(equipmentCategories)
        .orderBy(asc(equipmentCategories.sortOrder), asc(equipmentCategories.name)),
    ])

    return {
      ...row,
      photoUrl: row.photoKey ? publicUrl(row.photoKey) : null,
      history,
      historyTotal,
      workOrders,
      workOrdersTotal,
      openWoCount: openWoCountRow,
      sites,
      holders,
      assignees,
      certAttachments,
      certTotal,
      inspectionRecords,
      inspectionsTotal,
      logEntries: logRows,
      logTotal,
      checkouts: checkoutRows,
      checkoutsTotal,
      openCheckout: openCheckoutRow,
      schedules,
      openReminders,
      itemInspectionTypes,
      allTypes,
      allCategories,
    }
  })

  if (!data) notFound()
  const {
    item,
    type,
    category,
    site,
    holder,
    missingReporter,
    photoUrl,
    history,
    historyTotal,
    workOrders,
    workOrdersTotal,
    openWoCount,
    sites,
    holders,
    assignees,
    certAttachments,
    certTotal,
    inspectionRecords,
    inspectionsTotal,
    logEntries,
    logTotal,
    checkouts,
    checkoutsTotal,
    openCheckout,
    schedules,
    openReminders,
    itemInspectionTypes,
    allTypes,
    allCategories,
  } = data

  // Read-only unless the viewer can manage equipment. The autosave action
  // re-asserts the permission server-side; this only gates the inputs.
  const locked = !can(ctx, 'equipment.manage')

  // Category-driven field groups + tenant custom fields. Custom fields that
  // target an enabled native group render inside it; the rest render in their
  // own sections below (so a field aimed at a disabled group never vanishes).
  const fieldGroups = resolveEnabledFieldGroups(category?.enabledFieldGroups ?? null)
  const enabledGroupKeys = new Set(fieldGroups.map((g) => g.key))
  const customFieldDefs = await loadVisibleCustomFieldDefs(ctx, 'equipment', item.typeId)
  const customByGroup = new Map<string, CustomFieldDefRow[]>()
  const standaloneCustomDefs: CustomFieldDefRow[] = []
  for (const def of customFieldDefs) {
    if (def.groupKey && enabledGroupKeys.has(def.groupKey)) {
      const list = customByGroup.get(def.groupKey) ?? []
      list.push(def)
      customByGroup.set(def.groupKey, list)
    } else {
      standaloneCustomDefs.push(def)
    }
  }
  const customValues = readCustomFieldValues(item.metadata)

  const todayIso = new Date().toISOString().slice(0, 10)
  const activeSchedules = schedules.filter((s) => s.schedule.isActive)
  const nextInspectionDue = activeSchedules[0]?.schedule.nextDueOn ?? null

  // Schedule-drawer type options, scoped to templates that apply to this item.
  const scheduleTypeOptions = itemInspectionTypes
    .filter((t) => !t.appliesToTypeId || t.appliesToTypeId === item.typeId)
    .map((t) => ({
      value: t.id,
      label: `${t.name} — ${formatInterval(t.intervalValue, t.intervalUnit, { preUse: t.isPreUse })}`,
      // Picking a type seeds the schedule's repeat interval from its default.
      intervalValue: t.intervalValue,
      intervalUnit: t.intervalUnit,
    }))
  // Pre-use checklist picker: pre-use templates that apply to this item.
  const preUseTypeOptions = itemInspectionTypes
    .filter((t) => t.isPreUse && (!t.appliesToTypeId || t.appliesToTypeId === item.typeId))
    .map((t) => ({ value: t.id, label: t.name }))

  // Live* option lists.
  const siteOptions = sites
    .filter((s) => s.level === 'site')
    .map((s) => ({ value: s.id, label: s.name }))
  const typeOptions = allTypes.map((t) => ({ value: t.id, label: t.name }))
  const categoryOptions = allCategories.map((c) => ({ value: c.id, label: c.name }))
  const personOptions = holders.map((p) => ({
    value: p.id,
    label: `${p.lastName}, ${p.firstName}`,
    hint: p.employeeNo ?? undefined,
  }))

  const basePath = `/equipment/${id}`
  // Drawer state is URL-driven; the active tab is preserved in the close URL
  // so that closing the drawer doesn't kick you back to the Overview tab.
  const drawerKey = pickString(sp.drawer)
  const closeHref = `${basePath}?tab=${active}`

  // Schedule / reminder edit drawers address their row by id in the drawer key.
  const editingScheduleRow =
    drawerKey?.startsWith('schedule-') && drawerKey !== 'schedule-new'
      ? (schedules.find((s) => `schedule-${s.schedule.id}` === drawerKey) ?? null)
      : null
  const scheduleEditing: ScheduleEditing | null = editingScheduleRow
    ? {
        id: editingScheduleRow.schedule.id,
        inspectionTypeId: editingScheduleRow.schedule.inspectionTypeId,
        label: editingScheduleRow.schedule.label,
        intervalValue: editingScheduleRow.schedule.intervalValue,
        intervalUnit: editingScheduleRow.schedule.intervalUnit,
        nextDueOn: editingScheduleRow.schedule.nextDueOn,
        notes: editingScheduleRow.schedule.notes,
        isActive: editingScheduleRow.schedule.isActive,
      }
    : null
  const editingReminderRow =
    drawerKey?.startsWith('reminder-') && drawerKey !== 'reminder-new'
      ? (openReminders.find((r) => `reminder-${r.reminder.id}` === drawerKey) ?? null)
      : null
  const reminderEditing: ReminderEditing | null = editingReminderRow
    ? {
        id: editingReminderRow.reminder.id,
        equipmentItemId: id,
        title: editingReminderRow.reminder.title,
        details: editingReminderRow.reminder.details,
        dueOn: editingReminderRow.reminder.dueOn,
        repeatIntervalValue: editingReminderRow.reminder.repeatIntervalValue,
        repeatIntervalUnit: editingReminderRow.reminder.repeatIntervalUnit,
        assignedToPersonId: editingReminderRow.reminder.assignedToPersonId,
      }
    : null

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
                {photoUrl ? (
                  <a
                    href={photoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                    title="View full size"
                  >
                    {/* object-contain + a capped height shows portrait and
                        landscape photos in full without cropping; the neutral
                        backdrop fills the letterbox gap. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photoUrl}
                      alt={item.name}
                      className="max-h-56 w-full rounded-md bg-slate-100 object-contain dark:bg-slate-800"
                    />
                  </a>
                ) : (
                  <div className="flex h-32 items-center justify-center rounded-md bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                    <Truck size={48} />
                  </div>
                )}
                <div className="text-center">
                  <div className="text-base font-semibold">{item.name}</div>
                  <div className="text-xs text-slate-500">{type?.name ?? '—'}</div>
                </div>
                <div className="space-y-1.5 border-t border-slate-100 pt-3">
                  <SidebarRow label="Asset tag">{item.assetTag}</SidebarRow>
                  <SidebarRow label="Serial #">{item.serialNumber ?? '—'}</SidebarRow>
                  <SidebarRow label="Category">{category?.name ?? '—'}</SidebarRow>
                  <SidebarRow label="Site">{site?.name ?? '—'}</SidebarRow>
                  <SidebarRow label="Holder">
                    {holder ? `${holder.firstName} ${holder.lastName}` : '—'}
                  </SidebarRow>
                  <SidebarRow label="Purchased">{item.purchaseDate ?? '—'}</SidebarRow>
                  <SidebarRow label="Warranty">{item.warrantyExpiresOn ?? '—'}</SidebarRow>
                  <SidebarRow label="Next inspection">
                    {nextInspectionDue ? (
                      <span
                        className={
                          nextInspectionDue < todayIso
                            ? 'font-medium text-rose-600 dark:text-rose-400'
                            : undefined
                        }
                      >
                        {nextInspectionDue}
                      </span>
                    ) : (
                      '—'
                    )}
                  </SidebarRow>
                </div>
              </CardContent>
            </Card>
          </aside>

          <div className="space-y-4">
            <TabNav
              basePath={basePath}
              currentParams={sp}
              active={active}
              variant="pills"
              tabs={[
                { key: 'overview', label: 'Overview' },
                { key: 'location', label: 'Location & custody', count: checkoutsTotal },
                {
                  key: 'inspections',
                  label: 'Inspections',
                  count: activeSchedules.length + openReminders.length,
                },
                { key: 'work_orders', label: 'Work orders', count: openWoCount },
                { key: 'log', label: 'Log', count: logTotal },
                { key: 'files', label: 'Files', count: certTotal },
                { key: 'activity', label: 'Activity' },
              ]}
            />

            {/*
             * Tab body crossfade. The `key={active}` on TabContent means each
             * server-rendered swap triggers an AnimatePresence cycle so the
             * outgoing panel fades while the incoming one slides in.
             */}
            <TabContent tabKey={active}>
              {active === 'overview' ? (
                <div className="space-y-4">
                  <Section title="General">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <LiveField
                        id={id}
                        field="name"
                        label="Name"
                        initialValue={item.name}
                        disabled={locked}
                        updateAction={updateEquipmentField}
                      />
                      <LiveField
                        id={id}
                        field="assetTag"
                        label="Asset tag"
                        initialValue={item.assetTag}
                        disabled={locked}
                        updateAction={updateEquipmentField}
                      />
                      <LiveField
                        id={id}
                        field="serialNumber"
                        label="Serial #"
                        initialValue={item.serialNumber}
                        disabled={locked}
                        updateAction={updateEquipmentField}
                      />
                      <LiveSelect
                        id={id}
                        field="typeId"
                        label="Type"
                        initialValue={item.typeId}
                        options={typeOptions}
                        disabled={locked}
                        updateAction={updateEquipmentField}
                      />
                      <LiveSelect
                        id={id}
                        field="categoryId"
                        label="Category"
                        initialValue={item.categoryId}
                        options={categoryOptions}
                        emptyLabel="— No category —"
                        disabled={locked}
                        updateAction={updateEquipmentField}
                      />
                      <LiveSelect
                        id={id}
                        field="status"
                        label="Status"
                        initialValue={item.status}
                        allowEmpty={false}
                        options={EQUIPMENT_STATUSES.map((s) => ({
                          value: s,
                          label: s.replace('_', ' '),
                        }))}
                        disabled={locked}
                        updateAction={updateEquipmentField}
                      />
                      <div className="sm:col-span-2">
                        <LiveField
                          id={id}
                          field="description"
                          label="Description"
                          initialValue={item.description}
                          multiline
                          disabled={locked}
                          updateAction={updateEquipmentField}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <LiveRichText
                          id={id}
                          field="notes"
                          label="Notes"
                          initialValue={item.notes}
                          placeholder="Maintenance / status notes"
                          disabled={locked}
                          updateAction={updateEquipmentField}
                        />
                      </div>
                    </div>
                  </Section>

                  {/*
                   * Category-driven field groups. Which sections appear is
                   * configured per equipment category (Manage → Categories),
                   * so a hand tool shows only what applies while a truck gets
                   * registration, meters, and specs. Tenant custom fields
                   * targeting a group render inside it.
                   */}
                  {fieldGroups.map((group) => (
                    <Section key={group.key} title={group.label}>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {group.fields.map((f) =>
                          f.type === 'select' ? (
                            <LiveSelect
                              key={f.field}
                              id={id}
                              field={f.field}
                              label={f.label}
                              initialValue={
                                (item as unknown as Record<string, unknown>)[f.field] == null
                                  ? null
                                  : String((item as unknown as Record<string, unknown>)[f.field])
                              }
                              options={f.options ?? []}
                              allowEmpty={false}
                              disabled={locked}
                              updateAction={updateEquipmentField}
                            />
                          ) : (
                            <LiveField
                              key={f.field}
                              id={id}
                              field={f.field}
                              label={
                                f.field === 'currentHours' || f.field === 'currentOdometer'
                                  ? `${f.label}${item.metersUpdatedAt ? ` · read ${new Date(item.metersUpdatedAt).toLocaleDateString()}` : ''}`
                                  : f.label
                              }
                              type={f.type}
                              placeholder={f.placeholder}
                              initialValue={
                                (item as unknown as Record<string, unknown>)[f.field] == null
                                  ? null
                                  : String((item as unknown as Record<string, unknown>)[f.field])
                              }
                              disabled={locked}
                              updateAction={updateEquipmentField}
                            />
                          ),
                        )}
                        {(customByGroup.get(group.key) ?? []).map((def) => (
                          <CustomFieldInput
                            key={def.id}
                            entityKind="equipment"
                            recordId={id}
                            def={{
                              key: def.key,
                              label: def.label,
                              helpText: def.helpText,
                              fieldType: def.fieldType,
                              required: def.required,
                              config: def.config,
                            }}
                            initialValue={customValues[def.key] ?? null}
                            disabled={locked}
                            updateAction={updateCustomFieldValueAction}
                          />
                        ))}
                      </div>
                    </Section>
                  ))}

                  <CustomFieldsSection
                    ctx={ctx}
                    entityKind="equipment"
                    recordId={id}
                    subtypeId={item.typeId}
                    metadata={item.metadata}
                    locked={locked}
                    defs={standaloneCustomDefs}
                  />
                </div>
              ) : null}

              {active === 'work_orders' ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                      <CardTitle>Work orders ({workOrdersTotal})</CardTitle>
                      <Link href={`${basePath}?tab=work_orders&drawer=new-work-order` as any}>
                        <Button size="sm">
                          <Wrench size={14} /> New work order
                        </Button>
                      </Link>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <SearchInput
                        paramKey="wo_q"
                        pageParamKey="wo_p"
                        placeholder="Search reference, summary…"
                      />
                      {workOrders.length === 0 ? (
                        <EmptyState
                          icon={<Wrench size={24} />}
                          title={woP.q ? 'No work orders match your search' : 'No work orders'}
                          description="Open a work order to track repairs or scheduled service."
                          action={
                            <Link href={`${basePath}?tab=work_orders&drawer=new-work-order` as any}>
                              <Button size="sm" variant="outline">
                                <Wrench size={14} /> New work order
                              </Button>
                            </Link>
                          }
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
                      <SubPagination
                        basePath={basePath}
                        sp={sp}
                        prefix="wo"
                        total={workOrdersTotal}
                        page={woP.page}
                      />
                    </CardContent>
                  </Card>
                </div>
              ) : null}

              {active === 'location' ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                      <CardTitle>Current custody</CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`${basePath}?tab=location&drawer=transfer` as any}>
                          <Button size="sm" variant="outline">
                            <ArrowLeftRight size={14} /> Transfer
                          </Button>
                        </Link>
                        {openCheckout ? (
                          <Link href={`${basePath}?tab=location&drawer=check-in` as any}>
                            <Button size="sm">
                              <LogIn size={14} /> Check in
                            </Button>
                          </Link>
                        ) : (
                          <Link href={`${basePath}?tab=location&drawer=check-out` as any}>
                            <Button size="sm">
                              <LogOut size={14} /> Check out
                            </Button>
                          </Link>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 text-sm">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <MapPin size={16} className="text-slate-400" />
                          {site?.name ?? 'Unassigned'}
                        </div>
                        {holder ? (
                          <div className="text-slate-600 dark:text-slate-400">
                            Held by{' '}
                            <Link
                              href={`/people/${holder.id}`}
                              className="text-teal-700 hover:underline dark:text-teal-400"
                            >
                              {holder.firstName} {holder.lastName}
                            </Link>
                          </div>
                        ) : null}
                        {openCheckout ? (
                          <div className="text-slate-600 dark:text-slate-400">
                            Currently checked out
                            {openCheckout.co.expectedReturnOn
                              ? ` · expected back ${openCheckout.co.expectedReturnOn}`
                              : ''}
                            .
                          </div>
                        ) : null}
                      </div>
                      {/* Assignment editors — site + holder live here with the
                          rest of the custody picture (moved off the Overview). */}
                      <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 dark:border-slate-800">
                        <LiveSelect
                          id={id}
                          field="currentSiteOrgUnitId"
                          label="Current site"
                          initialValue={item.currentSiteOrgUnitId}
                          options={siteOptions}
                          emptyLabel="— Unassigned —"
                          disabled={locked}
                          updateAction={updateEquipmentField}
                        />
                        <LivePersonSelect
                          id={id}
                          field="currentHolderPersonId"
                          label="Current holder"
                          initialValue={item.currentHolderPersonId}
                          options={personOptions}
                          placeholder="Select a holder…"
                          disabled={locked}
                          updateAction={updateEquipmentField}
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Check-out history ({checkoutsTotal})</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <SearchInput
                        paramKey="co_q"
                        pageParamKey="co_p"
                        placeholder="Search holder, destination, notes…"
                      />
                      {checkouts.length === 0 ? (
                        <EmptyState
                          icon={<LogOut size={24} />}
                          title="No checkout history"
                          description="This item has never been checked out. Use Check out to issue it to a person or site."
                          action={
                            <Link href={`${basePath}?tab=location&drawer=check-out` as any}>
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
                                <TableCell className="text-slate-600 dark:text-slate-300">
                                  {dest?.name ?? '—'}
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-300">
                                  {new Date(co.checkedOutAt).toLocaleDateString()}
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-300">
                                  {co.expectedReturnOn ?? '—'}
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-300">
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
                                <TableCell className="max-w-xs truncate text-xs text-slate-600 dark:text-slate-300">
                                  {co.returnedNotes ?? co.notes ?? '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                      <SubPagination
                        basePath={basePath}
                        sp={sp}
                        prefix="co"
                        total={checkoutsTotal}
                        page={coP.page}
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Location history ({historyTotal})</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <SearchInput
                        paramKey="lh_q"
                        pageParamKey="lh_p"
                        placeholder="Search site, holder, note…"
                      />
                      {history.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          {lhP.q ? 'No movements match your search.' : 'No movement recorded.'}
                        </p>
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
                                <TableCell className="text-slate-600 dark:text-slate-300">
                                  {row.history.note ?? '—'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                      <SubPagination
                        basePath={basePath}
                        sp={sp}
                        prefix="lh"
                        total={historyTotal}
                        page={lhP.page}
                      />
                    </CardContent>
                  </Card>
                </div>
              ) : null}

              {active === 'files' ? (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                    <CardTitle>Files ({certTotal})</CardTitle>
                    {locked ? null : (
                      <Link href={`${basePath}?tab=files&drawer=upload-file` as any}>
                        <Button size="sm">
                          <Plus size={14} /> Upload file
                        </Button>
                      </Link>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <SearchInput
                      paramKey="f_q"
                      pageParamKey="f_p"
                      placeholder="Search filename, label, category…"
                    />
                    {certAttachments.length === 0 ? (
                      <EmptyState
                        icon={<FileText size={24} />}
                        title={fP.q ? 'No files match your search' : 'No files attached'}
                        description="Upload certificates, manuals, photos, receipts, and other documents tagged to this asset."
                        action={
                          locked ? undefined : (
                            <Link href={`${basePath}?tab=files&drawer=upload-file` as any}>
                              <Button size="sm" variant="outline">
                                <Plus size={14} /> Upload file
                              </Button>
                            </Link>
                          )
                        }
                      />
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>File</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Size</TableHead>
                            <TableHead>Uploaded</TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {certAttachments.map((a) => {
                            const exif = a.exif as Record<string, unknown> | null
                            const fileLabel = exif?.label
                            const fileKind = typeof exif?.kind === 'string' ? exif.kind : null
                            return (
                              <TableRow key={a.id}>
                                <TableCell className="font-medium">
                                  {typeof fileLabel === 'string' && fileLabel ? (
                                    <>
                                      <div>{fileLabel}</div>
                                      <div className="text-xs font-normal text-slate-500 dark:text-slate-400">
                                        {a.filename}
                                      </div>
                                    </>
                                  ) : (
                                    a.filename
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary">
                                    {(fileKind ?? 'document').replace('_', ' ')}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-300">
                                  {humanSize(a.sizeBytes)}
                                </TableCell>
                                <TableCell>{new Date(a.createdAt).toLocaleDateString()}</TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end gap-3">
                                    <a
                                      href={publicUrl(a.r2Key)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                                    >
                                      Open →
                                    </a>
                                    {locked ? null : (
                                      <form action={deleteEquipmentFile} className="inline">
                                        <input type="hidden" name="itemId" value={id} />
                                        <input type="hidden" name="attachmentId" value={a.id} />
                                        <button
                                          type="submit"
                                          title="Remove file"
                                          className="text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </form>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    )}
                    <SubPagination
                      basePath={basePath}
                      sp={sp}
                      prefix="f"
                      total={certTotal}
                      page={fP.page}
                    />
                  </CardContent>
                </Card>
              ) : null}

              {active === 'inspections' ? (
                <div className="space-y-4">
                  {/*
                   * Recurring schedules — the per-unit cadences (any interval:
                   * daily, monthly, every 3 months, annual, 5-year, …) that
                   * drive the maintenance cockpit and overdue tracking.
                   */}
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                      <CardTitle>Inspection schedules ({activeSchedules.length})</CardTitle>
                      {locked ? null : (
                        <Link href={`${basePath}?tab=inspections&drawer=schedule-new` as any}>
                          <Button size="sm">
                            <CalendarClock size={14} /> Add schedule
                          </Button>
                        </Link>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {schedules.length === 0 ? (
                        <EmptyState
                          icon={<CalendarClock size={24} />}
                          title="No recurring inspections"
                          description="Add a schedule to track when this unit's next inspection is due — daily, monthly, every 3 months, annual, 5-year, or any other cadence."
                          action={
                            locked ? undefined : (
                              <Link href={`${basePath}?tab=inspections&drawer=schedule-new` as any}>
                                <Button size="sm" variant="outline">
                                  <CalendarClock size={14} /> Add schedule
                                </Button>
                              </Link>
                            )
                          }
                        />
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Inspection</TableHead>
                              <TableHead>Interval</TableHead>
                              <TableHead>Last completed</TableHead>
                              <TableHead>Next due</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {schedules.map(({ schedule, type: schedType }) => {
                              const overdue = schedule.isActive && schedule.nextDueOn < todayIso
                              const dueSoon =
                                schedule.isActive &&
                                !overdue &&
                                schedule.nextDueOn <=
                                  new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
                              return (
                                <TableRow key={schedule.id}>
                                  <TableCell className="font-medium">
                                    {schedType?.name ?? schedule.label ?? 'Inspection'}
                                    {!schedule.isActive ? (
                                      <Badge variant="secondary" className="ml-2">
                                        inactive
                                      </Badge>
                                    ) : null}
                                    {schedule.notes ? (
                                      <div className="text-xs font-normal text-slate-500 dark:text-slate-400">
                                        {schedule.notes}
                                      </div>
                                    ) : null}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="secondary">
                                      {formatInterval(
                                        schedule.intervalValue,
                                        schedule.intervalUnit,
                                      )}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-slate-600 dark:text-slate-300">
                                    {schedule.lastCompletedOn ?? '—'}
                                  </TableCell>
                                  <TableCell>
                                    <span className="flex items-center gap-2">
                                      {schedule.nextDueOn}
                                      {overdue ? (
                                        <Badge variant="destructive">overdue</Badge>
                                      ) : dueSoon ? (
                                        <Badge variant="warning">due soon</Badge>
                                      ) : null}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center justify-end gap-3">
                                      {schedule.inspectionTypeId ? (
                                        <Link
                                          href={`/equipment/inspections/new?itemId=${id}&typeId=${schedule.inspectionTypeId}`}
                                          className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                                        >
                                          Start →
                                        </Link>
                                      ) : null}
                                      {locked ? null : (
                                        <Link
                                          href={
                                            `${basePath}?tab=inspections&drawer=schedule-${schedule.id}` as any
                                          }
                                          className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                                        >
                                          Edit
                                        </Link>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      )}
                      <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3 dark:border-slate-800">
                        <LiveToggle
                          id={id}
                          field="requiresPreUseInspection"
                          label="Requires pre-use inspection"
                          initialValue={item.requiresPreUseInspection}
                          disabled={locked}
                          updateAction={updateEquipmentField}
                        />
                        <LiveSelect
                          id={id}
                          field="preUseInspectionTypeId"
                          label="Pre-use checklist"
                          initialValue={item.preUseInspectionTypeId}
                          options={preUseTypeOptions}
                          emptyLabel="— No checklist —"
                          disabled={locked}
                          updateAction={updateEquipmentField}
                        />
                        <ReadOnlyStat
                          label="Last pre-use inspection"
                          value={
                            item.lastPreUseInspectionAt
                              ? new Date(item.lastPreUseInspectionAt).toLocaleString()
                              : '—'
                          }
                        />
                        {item.requiresPreUseInspection && item.preUseInspectionTypeId ? (
                          <div className="sm:col-span-3">
                            <Link
                              href={`/equipment/inspections/new?itemId=${id}&typeId=${item.preUseInspectionTypeId}`}
                              className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                            >
                              Start pre-use inspection →
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Ad-hoc reminders — one-off (or repeating) to-dos for this unit. */}
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                      <CardTitle>Reminders ({openReminders.length})</CardTitle>
                      {locked ? null : (
                        <Link href={`${basePath}?tab=inspections&drawer=reminder-new` as any}>
                          <Button size="sm" variant="outline">
                            <BellRing size={14} /> Add reminder
                          </Button>
                        </Link>
                      )}
                    </CardHeader>
                    <CardContent>
                      {openReminders.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          No open reminders. Add one for ad-hoc maintenance — e.g. check the roof
                          membrane in March.
                        </p>
                      ) : (
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                          {openReminders.map(({ reminder, assignee }) => {
                            const overdue = reminder.dueOn < todayIso
                            return (
                              <li
                                key={reminder.id}
                                className="flex items-center justify-between gap-3 py-2.5"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                                    {reminder.title}
                                    {reminder.repeatIntervalValue && reminder.repeatIntervalUnit ? (
                                      <Badge variant="secondary">
                                        {formatInterval(
                                          reminder.repeatIntervalValue,
                                          reminder.repeatIntervalUnit,
                                        )}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400">
                                    Due{' '}
                                    <span
                                      className={
                                        overdue
                                          ? 'font-medium text-rose-600 dark:text-rose-400'
                                          : undefined
                                      }
                                    >
                                      {reminder.dueOn}
                                    </span>
                                    {assignee
                                      ? ` · ${assignee.firstName} ${assignee.lastName}`
                                      : ''}
                                    {reminder.details ? ` · ${reminder.details}` : ''}
                                  </div>
                                </div>
                                {locked ? null : (
                                  <div className="flex shrink-0 items-center gap-2">
                                    <Link
                                      href={
                                        `${basePath}?tab=inspections&drawer=reminder-${reminder.id}` as any
                                      }
                                      className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                                    >
                                      Edit
                                    </Link>
                                    <form action={completeEquipmentReminder}>
                                      <input type="hidden" name="id" value={reminder.id} />
                                      <Button size="sm" variant="outline" type="submit">
                                        <Check size={14} /> Done
                                      </Button>
                                    </form>
                                  </div>
                                )}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                      <CardTitle>Inspection history ({inspectionsTotal})</CardTitle>
                      <Link href={`/equipment/inspections/new?itemId=${id}`}>
                        <Button size="sm">
                          <ClipboardCheck size={14} /> New inspection
                        </Button>
                      </Link>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <SearchInput
                        paramKey="ins_q"
                        pageParamKey="ins_p"
                        placeholder="Search reference, type…"
                      />
                      {inspectionRecords.length === 0 ? (
                        <EmptyState
                          icon={<ClipboardCheck size={24} />}
                          title={
                            insP.q ? 'No inspections match your search' : 'No inspections recorded'
                          }
                          description="Pre-use, scheduled, and ad-hoc inspections for this asset appear here."
                          action={
                            <Link href={`/equipment/inspections/new?itemId=${id}`}>
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
                              <TableHead>Reference</TableHead>
                              <TableHead>Type</TableHead>
                              <TableHead>Performed</TableHead>
                              <TableHead>Result</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {inspectionRecords.map(({ record, type }) => (
                              <TableRow key={record.id}>
                                <TableCell className="font-medium">
                                  <Link
                                    href={`/equipment/inspections/${record.id}`}
                                    className="text-teal-700 hover:underline dark:text-teal-400"
                                  >
                                    {record.reference}
                                  </Link>
                                </TableCell>
                                <TableCell className="text-slate-600 dark:text-slate-300">
                                  {type?.name ?? '—'}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-slate-600 dark:text-slate-300">
                                  {record.occurredAt
                                    ? new Date(record.occurredAt).toLocaleDateString()
                                    : '—'}
                                </TableCell>
                                <TableCell>
                                  {record.result ? (
                                    <Badge
                                      variant={
                                        record.result === 'pass'
                                          ? 'success'
                                          : record.result === 'fail'
                                            ? 'destructive'
                                            : 'secondary'
                                      }
                                    >
                                      {record.result}
                                    </Badge>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      record.status === 'closed' || record.status === 'submitted'
                                        ? 'success'
                                        : 'warning'
                                    }
                                  >
                                    {record.status.replace('_', ' ')}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <Link
                                    href={`/equipment/inspections/${record.id}`}
                                    className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                                  >
                                    View →
                                  </Link>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                      <SubPagination
                        basePath={basePath}
                        sp={sp}
                        prefix="ins"
                        total={inspectionsTotal}
                        page={insP.page}
                      />
                    </CardContent>
                  </Card>
                </div>
              ) : null}

              {active === 'log' ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                      <CardTitle>Log entries ({logTotal})</CardTitle>
                      <Link href={`${basePath}?tab=log&drawer=add-log` as any}>
                        <Button size="sm">
                          <Plus size={14} /> Add log entry
                        </Button>
                      </Link>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <SearchInput
                        paramKey="log_q"
                        pageParamKey="log_p"
                        placeholder="Search title, details, kind…"
                      />
                      {logEntries.length === 0 ? (
                        <EmptyState
                          title={logP.q ? 'No entries match your search' : 'No log entries'}
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
                      <SubPagination
                        basePath={basePath}
                        sp={sp}
                        prefix="log"
                        total={logTotal}
                        page={logP.page}
                      />
                    </CardContent>
                  </Card>
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
              {siteOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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

      <UrlDrawer
        open={drawerKey === 'transfer'}
        closeHref={closeHref}
        title="Transfer"
        description="Move this asset to a new site or holder. The change is recorded in the location history."
        size="md"
        footer={
          <Button type="submit" form="equipment-transfer-form">
            <ArrowLeftRight size={14} /> Record transfer
          </Button>
        }
      >
        <form
          id="equipment-transfer-form"
          action={transferLocation}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="id" value={id} />
          <Field label="Move to site">
            <Select name="siteOrgUnitId" defaultValue={item.currentSiteOrgUnitId ?? ''}>
              <option value="">— Unassigned —</option>
              {siteOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
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

      <EquipmentFileDrawer
        open={drawerKey === 'upload-file' && !locked}
        closeHref={closeHref}
        itemId={id}
        attachAction={attachEquipmentFile}
      />

      <ScheduleDrawer
        open={!locked && (drawerKey === 'schedule-new' || scheduleEditing != null)}
        closeHref={`${basePath}?tab=inspections`}
        itemId={id}
        editing={scheduleEditing}
        typeOptions={scheduleTypeOptions}
      />

      <ReminderDrawer
        open={!locked && (drawerKey === 'reminder-new' || reminderEditing != null)}
        closeHref={`${basePath}?tab=inspections`}
        itemId={id}
        editing={reminderEditing}
        people={personOptions}
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

// Prev/next pager for the detail page's sub-tables. Mirrors the shared
// <Pagination> but with a per-table page param (wo_p, co_p, …) merged into the
// current URL so the active tab and sibling tables' state are preserved.
function SubPagination({
  basePath,
  sp,
  prefix,
  total,
  page,
}: {
  basePath: string
  sp: Record<string, string | string[] | undefined>
  prefix: string
  total: number
  page: number
}) {
  const pageCount = Math.max(1, Math.ceil(total / SUB_PER_PAGE))
  if (pageCount <= 1) return null
  const pageParam = `${prefix}_p`
  const prevHref = mergeHref(basePath, sp, { [pageParam]: page > 1 ? page - 1 : 1 })
  const nextHref = mergeHref(basePath, sp, { [pageParam]: Math.min(pageCount, page + 1) })
  const linkCls =
    'inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/60'
  const disabledCls =
    'inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500'
  return (
    <div className="flex items-center justify-between gap-2 pt-1 text-sm text-slate-600 dark:text-slate-300">
      <span className="text-xs">
        Showing {(page - 1) * SUB_PER_PAGE + 1}–{Math.min(total, page * SUB_PER_PAGE)} of{' '}
        {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        {page <= 1 ? (
          <span className={disabledCls}>
            <ChevronLeft size={14} /> Prev
          </span>
        ) : (
          <Link href={prevHref as any} className={linkCls}>
            <ChevronLeft size={14} /> Prev
          </Link>
        )}
        <span className="px-2 text-xs text-slate-500 dark:text-slate-400">
          {page} / {pageCount}
        </span>
        {page >= pageCount ? (
          <span className={disabledCls}>
            Next <ChevronRight size={14} />
          </span>
        ) : (
          <Link href={nextHref as any} className={linkCls}>
            Next <ChevronRight size={14} />
          </Link>
        )}
      </div>
    </div>
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

// Read-only system-maintained stat (inspection timestamps the user can't edit).
function ReadOnlyStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-800/40">
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{value}</div>
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
