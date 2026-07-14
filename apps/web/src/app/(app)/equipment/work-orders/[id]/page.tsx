import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { FileText, Mail } from 'lucide-react'
import { Badge, Button, DetailHeader, Input, Label, Select, Textarea } from '@beaconhs/ui'
import {
  equipmentItems,
  equipmentWorkOrders,
  people,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { isUuid, pickString } from '@/lib/list-params'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { GenericSendEmailDialog } from '@/components/send-email-dialog'
import { RemoteSelectField } from '@/components/remote-search-select'
import { sendWorkOrderEmail } from './_send-email'
import { assertEquipmentWorkOrderReferences } from '../_lib'
import {
  optionalTextInput,
  optionalUuidInput,
  requiredTextInput,
  requireEnumInput,
  requireUuidInput,
} from '@/lib/mutation-input'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'action_taken', 'status', 'activity'] as const
type Tab = (typeof TABS)[number]

const STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'awaiting_parts',
  'repaired',
  'verified',
  'closed',
  'cancelled',
] as const
const PRIORITIES = ['low', 'med', 'high'] as const

function statusLabel(s: string) {
  if (s === 'closed') return 'completed'
  return s.replace('_', ' ')
}

function statusBadgeVariant(s: string): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (s === 'closed' || s === 'verified' || s === 'repaired') return 'success'
  if (s === 'cancelled') return 'secondary'
  if (s === 'awaiting_parts') return 'destructive'
  return 'warning'
}

function priorityBadgeVariant(p: string): 'destructive' | 'warning' | 'secondary' {
  if (p === 'high') return 'destructive'
  if (p === 'med') return 'warning'
  return 'secondary'
}

// ---------------- Server actions ----------------

async function updateOverview(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.workorder.close')
  const id = requireUuidInput(formData.get('id'), 'Work order')
  const summary = requiredTextInput(formData.get('summary'), 'Summary', 500)
  const description = optionalTextInput(formData.get('description'), 'Description', 10_000)
  const priority = requireEnumInput(formData.get('priority') ?? 'med', PRIORITIES, 'Priority')
  const assignedToTenantUserId = optionalUuidInput(
    formData.get('assignedToTenantUserId'),
    'Assignee',
  )
  const reportedByPersonId = optionalUuidInput(formData.get('reportedByPersonId'), 'Reporter')

  const itemId = await ctx.db(async (tx) => {
    const [existing] = await tx
      .select({ itemId: equipmentWorkOrders.itemId })
      .from(equipmentWorkOrders)
      .where(eq(equipmentWorkOrders.id, id))
      .limit(1)
      .for('update')
    if (!existing) throw new Error('Work order was not found.')
    await assertEquipmentWorkOrderReferences(ctx, tx, {
      itemId: existing.itemId,
      assignedToTenantUserId,
      reportedByPersonId,
    })
    const [updated] = await tx
      .update(equipmentWorkOrders)
      .set({
        summary,
        description,
        priority,
        assignedToTenantUserId,
        reportedByPersonId,
      })
      .where(eq(equipmentWorkOrders.id, id))
      .returning({ itemId: equipmentWorkOrders.itemId })
    if (!updated) throw new Error('Work order was not updated.')
    return updated.itemId
  })
  await recordAudit(ctx, {
    entityType: 'equipment_work_order',
    entityId: id,
    action: 'update',
    summary: 'Work order details updated',
    after: { summary, priority, assignedToTenantUserId, reportedByPersonId },
  })
  revalidatePath(`/equipment/${itemId}`)
  revalidatePath(`/equipment/work-orders/${id}`)
  revalidatePath('/equipment/work-orders')
}

async function updateActionTaken(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.workorder.close')
  const id = String(formData.get('id') ?? '')
  const actionTaken = String(formData.get('actionTaken') ?? '').trim() || null
  const costRaw = String(formData.get('cost') ?? '').trim()
  const cost = costRaw ? costRaw : null
  if (!id) return
  await ctx.db((tx) =>
    tx
      .update(equipmentWorkOrders)
      .set({ actionTaken, cost: cost as any })
      .where(eq(equipmentWorkOrders.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'equipment_work_order',
    entityId: id,
    action: 'update',
    summary: 'Work notes updated',
    after: { actionTaken, cost },
  })
  revalidatePath(`/equipment/work-orders/${id}`)
}

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.workorder.close')
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '') as (typeof STATUSES)[number]
  if (!id || !STATUSES.includes(status)) return
  const closing = status === 'closed' || status === 'cancelled'
  const result = await ctx.db(async (tx) => {
    const [existing] = await tx
      .select({ itemId: equipmentWorkOrders.itemId, status: equipmentWorkOrders.status })
      .from(equipmentWorkOrders)
      .where(eq(equipmentWorkOrders.id, id))
      .limit(1)
      .for('update')
    await tx
      .update(equipmentWorkOrders)
      .set({ status, closedAt: closing ? new Date() : null })
      .where(eq(equipmentWorkOrders.id, id))
    const changed = Boolean(existing && existing.status !== status)
    if (changed) {
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: id,
        moduleKey: 'equipment',
        event: 'status_change',
        toStatus: status,
        occurrenceKey: randomUUID(),
      })
    }
    return { itemId: existing?.itemId, changed }
  })
  if (!result.changed) return
  await recordAudit(ctx, {
    entityType: 'equipment_work_order',
    entityId: id,
    action: 'update',
    summary: `Status moved to "${statusLabel(status)}"`,
    after: { status },
  })
  if (result.itemId) revalidatePath(`/equipment/${result.itemId}`)
  revalidatePath(`/equipment/work-orders/${id}`)
  revalidatePath('/equipment/work-orders')
}

async function markComplete(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.workorder.close')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const itemId = await ctx.db(async (tx) => {
    const [existing] = await tx
      .select({ itemId: equipmentWorkOrders.itemId })
      .from(equipmentWorkOrders)
      .where(eq(equipmentWorkOrders.id, id))
      .limit(1)
    await tx
      .update(equipmentWorkOrders)
      .set({ status: 'closed', closedAt: new Date() })
      .where(eq(equipmentWorkOrders.id, id))
    return existing?.itemId
  })
  await recordAudit(ctx, {
    entityType: 'equipment_work_order',
    entityId: id,
    action: 'update',
    summary: 'Work order marked complete',
    after: { status: 'closed' },
  })
  if (itemId) revalidatePath(`/equipment/${itemId}`)
  revalidatePath(`/equipment/work-orders/${id}`)
  revalidatePath('/equipment/work-orders')
}

// Inline server action for the Send-email dialog. Reads recipients / Cc /
// subject prefix / message override from the form data and delegates to
// `sendWorkOrderEmail` for composition + audit-logging.
async function sendEmailAction(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.read.all')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  const subjectPrefix = String(formData.get('subjectPrefix') ?? '').trim() || undefined
  const messageOverride = String(formData.get('message') ?? '').trim() || undefined
  const splitEmails = (raw: string) =>
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
  const recipients = splitEmails(String(formData.get('recipients') ?? ''))
  const cc = splitEmails(String(formData.get('cc') ?? ''))
  await sendWorkOrderEmail(ctx, id, {
    recipients: recipients.length > 0 ? recipients : undefined,
    cc: cc.length > 0 ? cc : undefined,
    subjectPrefix,
    messageOverride,
  })
  revalidatePath(`/equipment/work-orders/${id}`)
}

// ---------------- Page ----------------

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `WO · ${id.slice(0, 8)}` }
}

export default async function WorkOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')

  const ctx = await requireRequestContext()
  const canClose = can(ctx, 'equipment.workorder.close')
  const canSend = can(ctx, 'equipment.read.all')
  if (!canClose && (active === 'action_taken' || active === 'status')) {
    redirect(`/equipment/work-orders/${id}`)
  }
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        wo: equipmentWorkOrders,
        item: equipmentItems,
        assignee: tenantUsers,
        assigneeUser: user,
        reporter: people,
      })
      .from(equipmentWorkOrders)
      .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, equipmentWorkOrders.assignedToTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .leftJoin(people, eq(people.id, equipmentWorkOrders.reportedByPersonId))
      .where(eq(equipmentWorkOrders.id, id))
      .limit(1)
    if (!row) return null
    // Read-tier guard: all → any work order; site → work orders on assets at
    // the caller's sites; self → work orders they opened / are assigned / that
    // name them as reporter.
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'equipment',
      ownerIds: [row.wo.openedByTenantUserId, row.wo.assignedToTenantUserId],
      siteId: row.item?.currentSiteOrgUnitId,
      personId: row.wo.reportedByPersonId,
    })
    if (!visible) return null
    return row
  })

  if (!data) notFound()
  const { wo, item, assignee, assigneeUser, reporter } = data
  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'equipment_work_order', id, 50) : []
  const basePath = `/equipment/work-orders/${id}`
  const closed = wo.status === 'closed' || wo.status === 'cancelled'

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/equipment/work-orders', label: 'Back to work orders' }}
          title={wo.summary}
          subtitle={`${wo.reference} · opened ${formatDate(new Date(wo.openedAt), ctx.timezone, ctx.locale)}${
            wo.closedAt
              ? ` · closed ${formatDate(new Date(wo.closedAt), ctx.timezone, ctx.locale)}`
              : ''
          }`}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={priorityBadgeVariant(wo.priority)}>{wo.priority}</Badge>
              <Badge variant={statusBadgeVariant(wo.status)}>{statusLabel(wo.status)}</Badge>
            </div>
          }
          actions={
            <>
              <Link href={`/equipment/work-orders/${id}/pdf` as any} target="_blank">
                <Button variant="outline">
                  <FileText size={14} /> PDF
                </Button>
              </Link>
              {canSend ? (
                <Link
                  href={
                    `/equipment/work-orders/${id}?send=1${active !== 'overview' ? `&tab=${active}` : ''}` as any
                  }
                  scroll={false}
                >
                  <Button variant="outline">
                    <Mail size={14} /> Send email
                  </Button>
                </Link>
              ) : null}
              {canClose && !closed ? (
                <form action={markComplete}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit">Mark complete</Button>
                </form>
              ) : null}
            </>
          }
        />
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            ...(canClose
              ? ([
                  { key: 'action_taken', label: 'Action taken' },
                  { key: 'status', label: 'Status' },
                ] as const)
              : []),
            { key: 'activity', label: 'Activity', count: activity.length },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <>
            <Section title="General">
              <DetailGrid
                rows={[
                  { label: 'Reference', value: <span className="font-mono">{wo.reference}</span> },
                  {
                    label: 'Equipment',
                    value: item ? (
                      <Link
                        href={`/equipment/${item.id}`}
                        className="text-teal-700 hover:underline"
                      >
                        <span className="font-mono text-xs">{item.assetTag}</span> · {item.name}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                  { label: 'Priority', value: wo.priority },
                  { label: 'Status', value: statusLabel(wo.status) },
                  {
                    label: 'Assignee',
                    value: assigneeUser?.name ?? assignee?.displayName ?? '—',
                  },
                  {
                    label: 'Reported by',
                    value: reporter ? (
                      <Link
                        href={`/people/${reporter.id}`}
                        className="text-teal-700 hover:underline"
                      >
                        {reporter.firstName} {reporter.lastName}
                      </Link>
                    ) : (
                      '—'
                    ),
                  },
                  {
                    label: 'Reported at',
                    value: formatDateTime(new Date(wo.openedAt), ctx.timezone, ctx.locale),
                  },
                  {
                    label: 'Completed at',
                    value: wo.closedAt
                      ? formatDateTime(new Date(wo.closedAt), ctx.timezone, ctx.locale)
                      : '—',
                  },
                  { label: 'Cost', value: wo.cost ? `$${wo.cost}` : '—' },
                ]}
              />
              {wo.description ? (
                <div className="mt-4">
                  <div className="text-xs tracking-wide text-slate-500 uppercase">Description</div>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">
                    {wo.description}
                  </p>
                </div>
              ) : null}
            </Section>
            {canClose ? (
              <Section title="Edit details">
                <form action={updateOverview} className="space-y-4">
                  <input type="hidden" name="id" value={id} />
                  <Field label="Summary" required>
                    <Input name="summary" required maxLength={500} defaultValue={wo.summary} />
                  </Field>
                  <Field label="Description">
                    <Textarea
                      name="description"
                      rows={4}
                      maxLength={10000}
                      defaultValue={wo.description ?? ''}
                    />
                  </Field>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Priority" required>
                      <Select name="priority" defaultValue={wo.priority}>
                        <option value="low">Low</option>
                        <option value="med">Medium</option>
                        <option value="high">High</option>
                      </Select>
                    </Field>
                    <Field label="Assign to">
                      <RemoteSelectField
                        name="assignedToTenantUserId"
                        defaultValue={wo.assignedToTenantUserId ?? ''}
                        lookup="equipment-work-order-assignees"
                        initialOption={
                          assignee
                            ? {
                                value: assignee.id,
                                label:
                                  assigneeUser?.name ??
                                  assignee.displayName ??
                                  assignee.id.slice(0, 6),
                                hint: assigneeUser?.email ?? undefined,
                              }
                            : undefined
                        }
                        placeholder="Select an assignee..."
                        searchPlaceholder="Search active members..."
                        sheetTitle="Assign to"
                        emptyLabel="Unassigned"
                      />
                    </Field>
                    <Field label="Reported by" className="sm:col-span-2">
                      <RemoteSelectField
                        name="reportedByPersonId"
                        defaultValue={wo.reportedByPersonId ?? ''}
                        lookup="equipment-work-order-reporters"
                        initialOption={
                          reporter
                            ? {
                                value: reporter.id,
                                label: `${reporter.lastName}, ${reporter.firstName}`,
                                hint: reporter.employeeNo ?? undefined,
                              }
                            : undefined
                        }
                        placeholder="Select a person…"
                        searchPlaceholder="Search active people…"
                        sheetTitle="Reported by"
                        clearable
                        emptyLabel="— Not specified —"
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={closed}>
                      Save changes
                    </Button>
                  </div>
                </form>
              </Section>
            ) : null}
          </>
        ) : null}

        {active === 'action_taken' ? (
          <Section title="Action taken">
            <form action={updateActionTaken} className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <Field label="What was done?">
                <Textarea
                  name="actionTaken"
                  rows={8}
                  defaultValue={wo.actionTaken ?? ''}
                  placeholder="Steps taken, parts replaced, calibration values, etc."
                />
              </Field>
              <Field label="Cost (USD)">
                <Input
                  name="cost"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={wo.cost ?? ''}
                  placeholder="Parts + labour"
                />
              </Field>
              <div className="flex justify-end">
                <Button type="submit">Save</Button>
              </div>
            </form>
          </Section>
        ) : null}

        {active === 'status' ? (
          <Section title="Status">
            <form action={updateStatus} className="flex items-end gap-3">
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1.5">
                <Label>Move to</Label>
                <Select name="status" defaultValue={wo.status}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit">Update</Button>
            </form>
            {!closed ? (
              <div className="mt-6">
                <form action={markComplete} className="inline">
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="outline">
                    Mark complete (sets completed at)
                  </Button>
                </form>
              </div>
            ) : null}
          </Section>
        ) : null}

        {active === 'activity' ? (
          <Section title={`Activity (${activity.length})`}>
            <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
          </Section>
        ) : null}
      </div>

      <GenericSendEmailDialog
        open={canSend && pickString(sp.send) === '1'}
        title="Send work order"
        description="Sends a recap of this work order to the tenant admin distribution list and the assignee. Add explicit recipients below to override."
        reference={wo.reference}
        defaultSubjectPrefix="Update"
        sendAction={async (fd) => {
          'use server'
          fd.set('id', id)
          await sendEmailAction(fd)
        }}
      />
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
