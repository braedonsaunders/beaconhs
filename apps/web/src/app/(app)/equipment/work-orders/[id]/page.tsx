import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_168d111aeb2bb7', { value0: id.slice(0, 8) }) }
}

export default async function WorkOrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
          title={tGeneratedValue(wo.summary)}
          subtitle={tGenerated('m_072fe7cb4f37d0', {
            value0: wo.reference,
            value1: formatDate(new Date(wo.openedAt), ctx.timezone, ctx.locale),
            value2: wo.closedAt
              ? ` · closed ${formatDate(new Date(wo.closedAt), ctx.timezone, ctx.locale)}`
              : '',
          })}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={priorityBadgeVariant(wo.priority)}>
                <GeneratedValue value={wo.priority} />
              </Badge>
              <Badge variant={statusBadgeVariant(wo.status)}>
                <GeneratedValue value={statusLabel(wo.status)} />
              </Badge>
            </div>
          }
          actions={
            <>
              <Link href={`/equipment/work-orders/${id}/pdf` as any} target="_blank">
                <Button variant="outline">
                  <FileText size={14} /> <GeneratedText id="m_1a2b2ed6729166" />
                </Button>
              </Link>
              <GeneratedValue
                value={
                  canSend ? (
                    <Link
                      href={
                        `/equipment/work-orders/${id}?send=1${active !== 'overview' ? `&tab=${active}` : ''}` as any
                      }
                      scroll={false}
                    >
                      <Button variant="outline">
                        <Mail size={14} /> <GeneratedText id="m_09dfca28fc95ba" />
                      </Button>
                    </Link>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  canClose && !closed ? (
                    <form action={markComplete}>
                      <input type="hidden" name="id" value={id} />
                      <Button type="submit">
                        <GeneratedText id="m_12d2de6d02bb72" />
                      </Button>
                    </form>
                  ) : null
                }
              />
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
        <GeneratedValue
          value={
            active === 'overview' ? (
              <>
                <Section title={tGenerated('m_1086584d9aca6a')}>
                  <DetailGrid
                    rows={[
                      {
                        label: 'Reference',
                        value: (
                          <span className="font-mono">
                            <GeneratedValue value={wo.reference} />
                          </span>
                        ),
                      },
                      {
                        label: 'Equipment',
                        value: item ? (
                          <Link
                            href={`/equipment/${item.id}`}
                            className="text-teal-700 hover:underline"
                          >
                            <span className="font-mono text-xs">
                              <GeneratedValue value={item.assetTag} />
                            </span>{' '}
                            · <GeneratedValue value={item.name} />
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
                            <GeneratedValue value={reporter.firstName} />{' '}
                            <GeneratedValue value={reporter.lastName} />
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
                  <GeneratedValue
                    value={
                      wo.description ? (
                        <div className="mt-4">
                          <div className="text-xs tracking-wide text-slate-500 uppercase">
                            <GeneratedText id="m_14d923495cf14c" />
                          </div>
                          <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">
                            <GeneratedValue value={wo.description} />
                          </p>
                        </div>
                      ) : null
                    }
                  />
                </Section>
                <GeneratedValue
                  value={
                    canClose ? (
                      <Section title={tGenerated('m_09ff2b2cb08089')}>
                        <form action={updateOverview} className="space-y-4">
                          <input type="hidden" name="id" value={id} />
                          <Field label={tGenerated('m_031c356c80b70f')} required>
                            <Input
                              name="summary"
                              required
                              maxLength={500}
                              defaultValue={wo.summary}
                            />
                          </Field>
                          <Field label={tGenerated('m_14d923495cf14c')}>
                            <Textarea
                              name="description"
                              rows={4}
                              maxLength={10000}
                              defaultValue={wo.description ?? ''}
                            />
                          </Field>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label={tGenerated('m_00f0e2904a371c')} required>
                              <Select name="priority" defaultValue={wo.priority}>
                                <option value="low">
                                  <GeneratedText id="m_0ba423ff31902f" />
                                </option>
                                <option value="med">
                                  <GeneratedText id="m_1bec287326cfa6" />
                                </option>
                                <option value="high">
                                  <GeneratedText id="m_08e161aa889d60" />
                                </option>
                              </Select>
                            </Field>
                            <Field label={tGenerated('m_0b44d2ea8f2b0f')}>
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
                                placeholder={tGenerated('m_00fa515d7be44e')}
                                searchPlaceholder={tGenerated('m_1f0bd3ac120c16')}
                                sheetTitle="Assign to"
                                emptyLabel={tGenerated('m_10d1d0d92a9aaa')}
                              />
                            </Field>
                            <Field label={tGenerated('m_036d83ad48ca7a')} className="sm:col-span-2">
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
                                placeholder={tGenerated('m_0be39d3a196b5b')}
                                searchPlaceholder={tGenerated('m_06c2338b990aea')}
                                sheetTitle="Reported by"
                                clearable
                                emptyLabel={tGenerated('m_16c1eee898d62b')}
                              />
                            </Field>
                          </div>
                          <div className="flex justify-end">
                            <Button type="submit" disabled={closed}>
                              <GeneratedText id="m_1ab9025ed1067c" />
                            </Button>
                          </div>
                        </form>
                      </Section>
                    ) : null
                  }
                />
              </>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'action_taken' ? (
              <Section title={tGenerated('m_0da1a29f41377e')}>
                <form action={updateActionTaken} className="space-y-4">
                  <input type="hidden" name="id" value={id} />
                  <Field label={tGenerated('m_1ec44561fbf9f2')}>
                    <Textarea
                      name="actionTaken"
                      rows={8}
                      defaultValue={wo.actionTaken ?? ''}
                      placeholder={tGenerated('m_164af55611ddcb')}
                    />
                  </Field>
                  <Field label={tGenerated('m_1831ba2d5aad68')}>
                    <Input
                      name="cost"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={wo.cost ?? ''}
                      placeholder={tGenerated('m_12e483ccb4462e')}
                    />
                  </Field>
                  <div className="flex justify-end">
                    <Button type="submit">
                      <GeneratedText id="m_19e6bff894c3c7" />
                    </Button>
                  </div>
                </form>
              </Section>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'status' ? (
              <Section title={tGenerated('m_0b9da892d6faf0')}>
                <form action={updateStatus} className="flex items-end gap-3">
                  <input type="hidden" name="id" value={id} />
                  <div className="space-y-1.5">
                    <Label>
                      <GeneratedText id="m_1e8891cb78e5a3" />
                    </Label>
                    <Select name="status" defaultValue={wo.status}>
                      <GeneratedValue
                        value={STATUSES.map((s) => (
                          <option key={s} value={s}>
                            <GeneratedValue value={statusLabel(s)} />
                          </option>
                        ))}
                      />
                    </Select>
                  </div>
                  <Button type="submit">
                    <GeneratedText id="m_064b3b737bd09e" />
                  </Button>
                </form>
                <GeneratedValue
                  value={
                    !closed ? (
                      <div className="mt-6">
                        <form action={markComplete} className="inline">
                          <input type="hidden" name="id" value={id} />
                          <Button type="submit" variant="outline">
                            <GeneratedText id="m_115130989d99d9" />
                          </Button>
                        </form>
                      </div>
                    ) : null
                  }
                />
              </Section>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'activity' ? (
              <Section title={tGenerated('m_158532c8e94ad5', { value0: activity.length })}>
                <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
              </Section>
            ) : null
          }
        />
      </div>

      <GenericSendEmailDialog
        open={canSend && pickString(sp.send) === '1'}
        title={tGenerated('m_02219de96950f7')}
        description={tGenerated('m_0acac69535236d')}
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
        <GeneratedValue value={label} />
        <GeneratedValue value={required ? <span className="text-red-600"> *</span> : null} />
      </Label>
      <GeneratedValue value={children} />
    </div>
  )
}
