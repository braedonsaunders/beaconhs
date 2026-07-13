import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  Building2,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  History,
  ListChecks,
  Lock,
  PenLine,
  ShieldAlert,
  Unlock,
} from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  Label,
  Select,
} from '@beaconhs/ui'
import {
  attachments,
  correctiveActions,
  inspectionRecordAttachments,
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypes,
  orgUnits,
  people,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import { attachmentUrl } from '@/lib/attachment-url'
import { assertCan } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { canSeeRecord } from '@/lib/visibility'
import { withStoredSignatureAttachment } from '@/lib/signature-storage'
import { FlowApprovals } from '@/components/flows/flow-approvals'
import { getPendingFlowGatesForSubject } from '@/lib/flows/gate-store'
import { canManageSubjectGates } from '@/lib/flows/registry'
import { recentActivityForEntity } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { PhotoGallery } from '@/components/photo-gallery'
import { PhotoUploaderSection } from '@/components/photo-uploader-section'
import { PremiumSection as Section } from '@/components/premium-section'
import { SectionNav, type SectionNavItem } from '@/components/section-nav'
import { LiveDateTime, LiveField, LiveSelect } from '@/components/live-field'
import {
  findIncompleteCriteria,
  logRecordAudit,
  parseAnswer,
  parseSeverity,
  syncCorrectiveActionForCriterion,
} from '../../_lib'
import { localDatetimeValue } from '../../_datetime'
import { CustomerSignatureCard } from './customer-signature'
import { CriterionCard, type CriterionResponseType, type CriterionSeverity } from './_criteria'

export const dynamic = 'force-dynamic'

const STATUSES = ['draft', 'in_progress', 'submitted', 'closed'] as const

// Bucket already-ordered criteria rows into contiguous runs that share a
// snapshotted group label, so the fill view can render section headers. Rows
// are materialised in group order, so same-label rows are adjacent.
function groupCriteriaByLabel<T extends { c: { groupLabelSnapshot: string | null } }>(
  rows: T[],
): { label: string | null; rows: T[] }[] {
  const out: { label: string | null; rows: T[] }[] = []
  for (const row of rows) {
    const label = row.c.groupLabelSnapshot ?? null
    const last = out[out.length - 1]
    if (last && last.label === label) last.rows.push(row)
    else out.push({ label, rows: [row] })
  }
  return out
}

/**
 * A finding is overdue when it's a `fail`, has an assigned due date in the
 * past, and has NOT been corrected. The inspection's `occurredAt` is the floor
 * so a due date that pre-dates the inspection isn't flagged.
 */
function isOverdue(args: {
  answer: 'pass' | 'fail' | 'n_a' | null
  assignedDueDate: string | null
  correctedOn: string | null
  recordOccurredAt: Date
}): boolean {
  if (args.answer !== 'fail') return false
  if (args.correctedOn) return false
  if (!args.assignedDueDate) return false
  const due = new Date(args.assignedDueDate + 'T00:00:00')
  if (Number.isNaN(due.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (due >= today) return false
  const floor = new Date(args.recordOccurredAt)
  floor.setHours(0, 0, 0, 0)
  return due >= floor
}

// ----------------------------------------------------------------------------
// Server actions
// ----------------------------------------------------------------------------

// Re-check per-user record visibility on a mutation, mirroring the detail page's
// read guard. `inspections.update` is the permission gate; this closes the
// write-by-guessing-the-URL gap (read.self/site users mutating a record they
// can't see). Throws `notFound`-equivalent (the action just errors) if denied.
//
// It also enforces the record lock: closing freezes the record, so every
// mutation refuses locked records unless the caller explicitly allows them
// (toggleLock — the only way to unfreeze).
async function assertCanSeeInspection(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  recordId: string,
  opts?: { allowLocked?: boolean },
): Promise<void> {
  const [rec] = await ctx.db((tx) =>
    tx
      .select({
        inspectorTenantUserId: inspectionRecords.inspectorTenantUserId,
        submittedByTenantUserId: inspectionRecords.submittedByTenantUserId,
        siteOrgUnitId: inspectionRecords.siteOrgUnitId,
        locked: inspectionRecords.locked,
      })
      .from(inspectionRecords)
      .where(eq(inspectionRecords.id, recordId))
      .limit(1),
  )
  if (!rec) throw new Error('Inspection record not found')
  const ok = await ctx.db((tx) =>
    canSeeRecord(ctx, tx, {
      prefix: 'inspections',
      ownerIds: [rec.inspectorTenantUserId, rec.submittedByTenantUserId],
      siteId: rec.siteOrgUnitId,
    }),
  )
  if (!ok) throw new Error('Inspection record not found')
  if (rec.locked && !opts?.allowLocked) {
    throw new Error('Record is locked. Unlock it before making changes.')
  }
}

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return
  await assertCanSeeInspection(ctx, id)

  const closing = status === 'closed'
  const submitting = status === 'submitted' || closing

  // Submit gate — refuse to flip to submitted/closed if any criterion is incomplete.
  if (submitting) {
    const missing = await findIncompleteCriteria(ctx, id)
    if (missing.length > 0) {
      throw new Error(
        `Cannot submit: ${missing.length} item${missing.length === 1 ? '' : 's'} still incomplete. First missing: ${missing[0]}`,
      )
    }
  }

  const [current] = await ctx.db((tx) =>
    tx
      .select({ record: inspectionRecords, type: inspectionTypes })
      .from(inspectionRecords)
      .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
      .where(eq(inspectionRecords.id, id))
      .limit(1),
  )
  if (!current) throw new Error('Inspection record not found')

  // Close gates — the type's workflow requirements are enforced here, not just
  // advertised in the UI. Closing locks the record, so the evidence must be
  // complete first.
  if (closing) {
    if (current.type.requiresCustomerSignature && !current.record.customerSignatureAttachmentId) {
      throw new Error('Cannot close: this inspection type requires a customer signature.')
    }
    if (
      current.type.requiresForeman &&
      !current.record.foremanText &&
      (current.record.foremanPersonIds ?? []).length === 0
    ) {
      throw new Error('Cannot close: this inspection type requires a foreman on the record.')
    }
  }
  if (current.record.status === status) return

  await ctx.db(async (tx) => {
    await tx
      .update(inspectionRecords)
      .set({
        status: status as (typeof STATUSES)[number],
        // Preserve the original submit attribution when closing an
        // already-submitted record; clear it when moving back to draft/in-progress.
        submittedAt: submitting ? (current.record.submittedAt ?? new Date()) : null,
        submittedByTenantUserId: submitting
          ? (current.record.submittedByTenantUserId ?? ctx.membership?.id ?? null)
          : null,
        closedAt: closing ? new Date() : null,
        closedByTenantUserId: closing ? (ctx.membership?.id ?? null) : null,
        locked: closing,
      })
      .where(eq(inspectionRecords.id, id))
    const occurrenceKey = randomUUID()
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: id,
      moduleKey: 'inspections',
      event: 'status_change',
      toStatus: status,
      occurrenceKey,
    })
    if (status === 'submitted') {
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: id,
        moduleKey: 'inspections',
        event: 'on_submit',
        occurrenceKey,
      })
    }
  })
  await logRecordAudit(ctx, id, `Status changed to "${status.replace(/_/g, ' ')}"`, 'update', {
    status,
  })
  revalidatePath(`/inspections/records/${id}`)
  revalidatePath('/inspections/records')
}

async function toggleLock(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const id = String(formData.get('id') ?? '')
  const lock = formData.get('lock') === 'true'
  await assertCanSeeInspection(ctx, id, { allowLocked: true })
  await ctx.db((tx) =>
    tx.update(inspectionRecords).set({ locked: lock }).where(eq(inspectionRecords.id, id)),
  )
  await logRecordAudit(ctx, id, lock ? 'Locked' : 'Unlocked', 'update', { locked: lock })
  revalidatePath(`/inspections/records/${id}`)
}

// Generic inline field save for the single-page general-info live fields.
async function updateRecordField(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const value = String(formData.get('value') ?? '')
  if (!id || !field) throw new Error('Missing id/field')
  // Visibility + lock are both enforced by the shared guard.
  await assertCanSeeInspection(ctx, id)

  const ALLOWED = new Set(['occurredAt', 'siteOrgUnitId', 'foremanText', 'notes'])
  if (!ALLOWED.has(field)) throw new Error('Field not allowed')

  const NULLABLE_IDS = new Set(['siteOrgUnitId'])
  const DATES = new Set(['occurredAt'])

  let val: unknown = value.trim() || null
  if (NULLABLE_IDS.has(field)) val = value || null
  if (DATES.has(field)) {
    const d = value ? new Date(value) : null
    if (!d || Number.isNaN(d.getTime())) throw new Error('Invalid date')
    val = d
  }

  await ctx.db((tx) =>
    tx
      .update(inspectionRecords)
      .set({ [field]: val } as Record<string, unknown>)
      .where(eq(inspectionRecords.id, id)),
  )
  await logRecordAudit(ctx, id, `Updated ${field}`, 'update', { [field]: val })
  revalidatePath(`/inspections/records/${id}`)
}

async function setCriterionAnswer(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const answer = parseAnswer(formData.get('answer'))
  if (!recordId || !rowId || !answer) return
  await assertCanSeeInspection(ctx, recordId)

  // Flipping to pass / N-A wipes the fail-only fields.
  const clear = answer !== 'fail'
  await ctx.db(async (tx) => {
    await tx
      .update(inspectionRecordCriteria)
      .set({
        answer,
        answeredAt: new Date(),
        answeredByTenantUserId: ctx.membership?.id ?? null,
        ...(clear
          ? {
              severity: null,
              nonComplianceDescription: null,
              actionTaken: null,
              compliantNote: null,
              assignedToPersonId: null,
              assignedDueDate: null,
            }
          : {}),
      })
      .where(eq(inspectionRecordCriteria.id, rowId))
    // Auto-transition draft -> in_progress on the first answer.
    await tx
      .update(inspectionRecords)
      .set({ status: 'in_progress' })
      .where(and(eq(inspectionRecords.id, recordId), eq(inspectionRecords.status, 'draft')))
  })
  const [row] = await ctx.db((tx) =>
    tx
      .select({ q: inspectionRecordCriteria.questionTextSnapshot })
      .from(inspectionRecordCriteria)
      .where(eq(inspectionRecordCriteria.id, rowId))
      .limit(1),
  )
  await logRecordAudit(
    ctx,
    recordId,
    `Answered "${row?.q?.slice(0, 50) ?? rowId.slice(0, 8)}" — ${answer}`,
    'update',
    { rowId, answer },
  )
  if (clear) await syncCorrectiveActionForCriterion(ctx, rowId)
  revalidatePath(`/inspections/records/${recordId}`)
}

async function setCriterionSeverity(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const severity = parseSeverity(formData.get('severity'))
  if (!recordId || !rowId) return
  await assertCanSeeInspection(ctx, recordId)

  await ctx.db((tx) =>
    tx
      .update(inspectionRecordCriteria)
      .set({ severity: severity ?? null })
      .where(eq(inspectionRecordCriteria.id, rowId)),
  )
  await logRecordAudit(
    ctx,
    recordId,
    `Set severity to "${severity ?? 'cleared'}" on a finding`,
    'update',
    { rowId, severity },
  )
  // Newly-spawned CAs are audited inside the sync helper.
  await syncCorrectiveActionForCriterion(ctx, rowId)
  revalidatePath(`/inspections/records/${recordId}`)
}

async function setCriterionNonCompliance(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const value = String(formData.get('value') ?? '').trim() || null
  if (!recordId || !rowId) return
  await assertCanSeeInspection(ctx, recordId)
  await ctx.db((tx) =>
    tx
      .update(inspectionRecordCriteria)
      .set({ nonComplianceDescription: value })
      .where(eq(inspectionRecordCriteria.id, rowId)),
  )
  await logRecordAudit(ctx, recordId, 'Updated non-compliance description', 'update', { rowId })
  await syncCorrectiveActionForCriterion(ctx, rowId)
  revalidatePath(`/inspections/records/${recordId}`)
}

async function setCriterionActionTaken(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const value = String(formData.get('value') ?? '').trim() || null
  if (!recordId || !rowId) return
  await assertCanSeeInspection(ctx, recordId)
  await ctx.db((tx) =>
    tx
      .update(inspectionRecordCriteria)
      .set({ actionTaken: value })
      .where(eq(inspectionRecordCriteria.id, rowId)),
  )
  await logRecordAudit(ctx, recordId, 'Updated action taken', 'update', { rowId })
  await syncCorrectiveActionForCriterion(ctx, rowId)
  revalidatePath(`/inspections/records/${recordId}`)
}

async function setCriterionCompliantNote(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const value = String(formData.get('value') ?? '').trim() || null
  if (!recordId || !rowId) return
  await assertCanSeeInspection(ctx, recordId)
  await ctx.db((tx) =>
    tx
      .update(inspectionRecordCriteria)
      .set({ compliantNote: value })
      .where(eq(inspectionRecordCriteria.id, rowId)),
  )
  await logRecordAudit(ctx, recordId, 'Updated compliant note', 'update', { rowId })
  revalidatePath(`/inspections/records/${recordId}`)
}

async function setCriterionAssignment(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const assignedToPersonId = String(formData.get('assignedToPersonId') ?? '').trim() || null
  const assignedDueDate = String(formData.get('assignedDueDate') ?? '').trim() || null
  if (!recordId || !rowId) return
  await assertCanSeeInspection(ctx, recordId)
  await ctx.db((tx) =>
    tx
      .update(inspectionRecordCriteria)
      .set({ assignedToPersonId, assignedDueDate })
      .where(eq(inspectionRecordCriteria.id, rowId)),
  )
  await logRecordAudit(ctx, recordId, 'Updated assignment', 'update', { rowId })
  await syncCorrectiveActionForCriterion(ctx, rowId)
  revalidatePath(`/inspections/records/${recordId}`)
}

async function setCriterionCorrectedOn(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const value = String(formData.get('correctedOn') ?? '').trim() || null
  if (!recordId || !rowId) return
  await assertCanSeeInspection(ctx, recordId)
  await ctx.db((tx) =>
    tx
      .update(inspectionRecordCriteria)
      .set({ correctedOn: value })
      .where(eq(inspectionRecordCriteria.id, rowId)),
  )
  await logRecordAudit(
    ctx,
    recordId,
    value ? `Marked finding corrected on ${value}` : 'Cleared corrected-on date',
    'update',
    { rowId, correctedOn: value },
  )
  revalidatePath(`/inspections/records/${recordId}`)
}

async function addCriterionPhotos(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const ids = String(formData.get('attachmentIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!recordId || !rowId || ids.length === 0) return
  await assertCanSeeInspection(ctx, recordId)
  await ctx.db(async (tx) => {
    const [cur] = await tx
      .select({ ids: inspectionRecordCriteria.photoAttachmentIds })
      .from(inspectionRecordCriteria)
      .where(eq(inspectionRecordCriteria.id, rowId))
      .limit(1)
    const next = [...(cur?.ids ?? []), ...ids]
    await tx
      .update(inspectionRecordCriteria)
      .set({ photoAttachmentIds: next })
      .where(eq(inspectionRecordCriteria.id, rowId))
  })
  await logRecordAudit(
    ctx,
    recordId,
    `Attached ${ids.length} photo${ids.length === 1 ? '' : 's'} to a criterion`,
    'update',
    { rowId },
  )
  revalidatePath(`/inspections/records/${recordId}`)
}

async function passAll(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  if (!recordId) return
  await assertCanSeeInspection(ctx, recordId)
  const flipped = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: inspectionRecordCriteria.id })
      .from(inspectionRecordCriteria)
      .where(
        and(
          eq(inspectionRecordCriteria.recordId, recordId),
          isNull(inspectionRecordCriteria.answer),
        ),
      )
    if (rows.length === 0) return 0
    await tx
      .update(inspectionRecordCriteria)
      .set({
        answer: 'pass',
        answeredAt: new Date(),
        answeredByTenantUserId: ctx.membership?.id ?? null,
      })
      .where(
        and(
          eq(inspectionRecordCriteria.recordId, recordId),
          isNull(inspectionRecordCriteria.answer),
        ),
      )
    await tx
      .update(inspectionRecords)
      .set({ status: 'in_progress' })
      .where(and(eq(inspectionRecords.id, recordId), eq(inspectionRecords.status, 'draft')))
    return rows.length
  })
  await logRecordAudit(
    ctx,
    recordId,
    `Marked all as pass via shortcut (${flipped} item${flipped === 1 ? '' : 's'} flipped)`,
    'update',
    { flipped },
  )
  revalidatePath(`/inspections/records/${recordId}`)
}

async function saveCustomerSignature(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const signature = String(formData.get('signature') ?? '')
  const signerName = String(formData.get('signerName') ?? '').trim() || null
  if (!recordId) return
  await assertCanSeeInspection(ctx, recordId)
  const dataUrl = signature === 'clear' || signature === '' ? null : signature
  const storedSignature = await withStoredSignatureAttachment(
    ctx,
    dataUrl,
    async (tx, attachmentId) => {
      await tx
        .update(inspectionRecords)
        .set({
          customerSignatureAttachmentId: attachmentId,
          customerSignerName: signerName,
          customerSignedAt: attachmentId ? new Date() : null,
        })
        .where(eq(inspectionRecords.id, recordId))
      return attachmentId
    },
  )
  await logRecordAudit(
    ctx,
    recordId,
    storedSignature ? 'Captured customer signature' : 'Cleared customer signature',
    storedSignature ? 'sign' : 'update',
  )
  revalidatePath(`/inspections/records/${recordId}`)
}

// Plain helper — invoked by the inline photo-attach server action below.
async function attachRecordPhotos(recordId: string, ids: string[]) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  if (ids.length === 0) return
  await assertCanSeeInspection(ctx, recordId)
  await ctx.db((tx) =>
    tx.insert(inspectionRecordAttachments).values(
      ids.map((attachmentId) => ({
        tenantId: ctx.tenantId,
        recordId,
        attachmentId,
      })),
    ),
  )
  await logRecordAudit(
    ctx,
    recordId,
    `Attached ${ids.length} photo${ids.length === 1 ? '' : 's'}`,
    'update',
  )
  revalidatePath(`/inspections/records/${recordId}`)
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Inspection · ${id.slice(0, 8)}` }
}

export default async function InspectionRecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const pendingGates = await getPendingFlowGatesForSubject(
    ctx,
    'module',
    id,
    canManageSubjectGates(ctx, 'module', 'inspections'),
  )

  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        record: inspectionRecords,
        type: inspectionTypes,
        site: orgUnits,
        inspector: user,
      })
      .from(inspectionRecords)
      .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, inspectionRecords.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, inspectionRecords.inspectorTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(inspectionRecords.id, id))
      .limit(1)
    if (!row) return null

    const criteria = await tx
      .select({
        c: inspectionRecordCriteria,
        assignee: people,
        ca: correctiveActions,
      })
      .from(inspectionRecordCriteria)
      .leftJoin(people, eq(people.id, inspectionRecordCriteria.assignedToPersonId))
      .leftJoin(
        correctiveActions,
        eq(correctiveActions.id, inspectionRecordCriteria.correctiveActionId),
      )
      .where(eq(inspectionRecordCriteria.recordId, id))
      .orderBy(asc(inspectionRecordCriteria.sequence))

    const photos = await tx
      .select({ link: inspectionRecordAttachments, attachment: attachments })
      .from(inspectionRecordAttachments)
      .innerJoin(attachments, eq(attachments.id, inspectionRecordAttachments.attachmentId))
      .where(eq(inspectionRecordAttachments.recordId, id))

    const peopleList = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(people)
      .where(and(eq(people.status, 'active'), isNull(people.deletedAt)))
      .orderBy(asc(people.lastName), asc(people.firstName))

    const siteOptions = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(and(eq(orgUnits.level, 'site'), isNull(orgUnits.deletedAt)))
      .orderBy(asc(orgUnits.name))

    // Resolve per-criterion photo previews in one pass.
    const allPhotoIds = Array.from(new Set(criteria.flatMap((c) => c.c.photoAttachmentIds ?? [])))
    const criterionPhotoMap = new Map<string, { id: string; url: string; filename: string }>()
    if (allPhotoIds.length > 0) {
      const rows = await tx
        .select({ id: attachments.id, key: attachments.r2Key, filename: attachments.filename })
        .from(attachments)
        .where(inArray(attachments.id, allPhotoIds))
      for (const r of rows) {
        criterionPhotoMap.set(r.id, {
          id: r.id,
          url: attachmentUrl(r.id),
          filename: r.filename,
        })
      }
    }

    return { ...row, criteria, photos, peopleList, siteOptions, criterionPhotoMap }
  })

  if (!data) notFound()
  // Per-user record visibility: read.all → any; read.site → my sites; else → ones
  // I performed or submitted.
  if (
    !(await ctx.db((tx) =>
      canSeeRecord(ctx, tx, {
        prefix: 'inspections',
        ownerIds: [data.record.inspectorTenantUserId, data.record.submittedByTenantUserId],
        siteId: data.record.siteOrgUnitId,
      }),
    ))
  )
    notFound()
  const { record, type, site, inspector, criteria, photos, peopleList, siteOptions } = data

  // Summary counts
  const total = criteria.length
  const passCount = criteria.filter((c) => c.c.answer === 'pass').length
  const failCount = criteria.filter((c) => c.c.answer === 'fail').length
  const naCount = criteria.filter((c) => c.c.answer === 'n_a').length
  const unansweredCount = criteria.filter((c) => !c.c.answer).length
  const answeredCount = total - unansweredCount
  const compliantPct =
    passCount + failCount > 0 ? Math.round((passCount / (passCount + failCount)) * 100) : 0
  const completionPct = total > 0 ? Math.round((answeredCount / total) * 100) : 0
  const ringCirc = 2 * Math.PI * 26

  const criteriaGroups = groupCriteriaByLabel(criteria)
  const multiSection = criteriaGroups.length > 1
  const indexById = new Map(criteria.map((row, i) => [row.c.id, i]))

  const activity = await recentActivityForEntity(ctx, 'inspection_record', id, 25)

  const galleryPhotos = photos.map((p) => ({
    id: p.link.id,
    url: attachmentUrl(p.attachment.id),
    filename: p.attachment.filename,
    caption: p.link.caption,
  }))

  const peopleOptions = peopleList.map((p) => ({
    value: p.id,
    label: `${p.lastName}, ${p.firstName}`,
    hint: p.employeeNo ?? undefined,
  }))

  const criterionActions = {
    setAnswer: setCriterionAnswer,
    setSeverity: setCriterionSeverity,
    setNonCompliance: setCriterionNonCompliance,
    setActionTaken: setCriterionActionTaken,
    setCompliantNote: setCriterionCompliantNote,
    setAssignment: setCriterionAssignment,
    setCorrected: setCriterionCorrectedOn,
    addPhotos: addCriterionPhotos,
  }

  const needsSignature = type.requiresCustomerSignature
  const signed = Boolean(record.customerSignatureAttachmentId)

  const sectionItems: SectionNavItem[] = [
    { id: 'overview', label: 'Overview' },
    {
      id: 'criteria',
      label: 'Criteria',
      count: total,
      done: total > 0 && unansweredCount === 0,
    },
    { id: 'photos', label: 'Photos', count: photos.length },
    ...(needsSignature ? [{ id: 'signature', label: 'Sign-off', done: signed }] : []),
    { id: 'activity', label: 'Activity' },
  ]

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/inspections/records', label: 'Back to inspection records' }}
          title={`${type.name}`}
          subtitle={`${record.reference} · ${formatDateTime(new Date(record.occurredAt), ctx.timezone)}`}
          badge={
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  record.status === 'closed' || record.status === 'submitted'
                    ? 'success'
                    : record.status === 'in_progress'
                      ? 'warning'
                      : 'secondary'
                }
              >
                {record.status.replace(/_/g, ' ')}
              </Badge>
              {record.locked ? (
                <Badge variant="success">
                  <Lock size={10} /> Locked
                </Badge>
              ) : null}
              {failCount > 0 ? (
                <Badge variant="destructive">
                  <ShieldAlert size={10} /> {failCount} failure{failCount === 1 ? '' : 's'}
                </Badge>
              ) : null}
            </div>
          }
          actions={
            <div className="flex items-center gap-2">
              <Link
                href={`/inspections/records/${id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800/60"
              >
                <FileText size={14} /> PDF
              </Link>
              <form action={toggleLock}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="lock" value={record.locked ? 'false' : 'true'} />
                <Button variant="outline" type="submit">
                  {record.locked ? (
                    <>
                      <Unlock size={14} /> Unlock
                    </>
                  ) : (
                    <>
                      <Lock size={14} /> Lock
                    </>
                  )}
                </Button>
              </form>
            </div>
          }
        />
      }
      alerts={
        <>
          {record.locked ? (
            <Alert variant="warning">
              <AlertTitle>This inspection is locked</AlertTitle>
              <AlertDescription>
                Closed on{' '}
                {record.closedAt ? formatDate(new Date(record.closedAt), ctx.timezone) : '—'}.
                Unlock from the header to make further edits.
              </AlertDescription>
            </Alert>
          ) : null}
          {needsSignature && !signed ? (
            <Alert variant="info">
              <AlertTitle>Signature required</AlertTitle>
              <AlertDescription>
                This inspection type requires a customer signature before it can be closed.
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      }
      subtabs={<SectionNav sections={sectionItems} />}
    >
      <div className="ff-surface space-y-5">
        {pendingGates.length > 0 ? <FlowApprovals gates={pendingGates} /> : null}

        {/* ---------------------------------------------------------------- */}
        {/* Overview — completion hero + compliance tiles + general info    */}
        {/* ---------------------------------------------------------------- */}
        <section id="section-overview" className="scroll-mt-2 space-y-5">
          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-4">
              <div className="relative h-16 w-16 shrink-0">
                <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    fill="none"
                    strokeWidth="6"
                    className="stroke-slate-200 dark:stroke-slate-700"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r="26"
                    fill="none"
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={ringCirc}
                    strokeDashoffset={ringCirc * (1 - completionPct / 100)}
                    className={completionPct >= 100 ? 'stroke-emerald-500' : 'stroke-teal-500'}
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {completionPct}%
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {answeredCount} of {total} answered
                </div>
                <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                  {type.name}
                  {site ? ` · ${site.name}` : ''}
                  {inspector?.name ? ` · ${inspector.name}` : ''}
                </div>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
              <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                Compliant
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span
                  className={`text-2xl font-semibold ${
                    failCount === 0
                      ? 'text-emerald-600'
                      : compliantPct >= 60
                        ? 'text-amber-600'
                        : 'text-red-600'
                  }`}
                >
                  {compliantPct}%
                </span>
                <span className="text-xs text-slate-400">
                  {passCount}/{failCount}/{naCount}
                </span>
              </div>
            </div>
          </div>

          {/* Compliance tiles */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Pass" value={passCount} accent="emerald" />
            <StatTile label="Fail" value={failCount} accent="red" />
            <StatTile label="N/A" value={naCount} accent="slate" />
            <StatTile label="Unanswered" value={unansweredCount} accent="amber" />
          </div>

          <Section
            title="General information"
            subtitle="Who, what, where, when"
            icon={<Building2 size={20} />}
            tone="slate"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <LiveDateTime
                id={record.id}
                field="occurredAt"
                label="Occurred at"
                initialValue={localDatetimeValue(new Date(record.occurredAt))}
                disabled={record.locked}
                updateAction={updateRecordField}
              />
              <LiveSelect
                id={record.id}
                field="siteOrgUnitId"
                label="Site"
                initialValue={record.siteOrgUnitId}
                options={siteOptions.map((s) => ({ value: s.id, label: s.name }))}
                disabled={record.locked}
                updateAction={updateRecordField}
              />
              <div className="sm:col-span-2">
                <LiveField
                  id={record.id}
                  field="foremanText"
                  label="Foreman"
                  initialValue={record.foremanText}
                  placeholder="Crew foreman on shift"
                  disabled={record.locked}
                  updateAction={updateRecordField}
                />
              </div>
              <div className="sm:col-span-2">
                <LiveField
                  id={record.id}
                  field="notes"
                  label="Notes"
                  initialValue={record.notes}
                  multiline
                  rows={3}
                  placeholder="Anything important about this inspection"
                  disabled={record.locked}
                  updateAction={updateRecordField}
                />
              </div>
            </div>

            {/* Read-only context */}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4 dark:border-slate-800">
              <Meta
                label="Reference"
                value={<span className="font-mono">{record.reference}</span>}
              />
              <Meta
                label="Type"
                value={
                  <Link
                    className="text-teal-700 hover:underline dark:text-teal-400"
                    href={`/inspections/types/${record.typeId}`}
                  >
                    {type.name}
                  </Link>
                }
              />
              <Meta
                label="Submitted"
                value={
                  record.submittedAt ? formatDate(new Date(record.submittedAt), ctx.timezone) : '—'
                }
              />
              <Meta
                label="Closed"
                value={record.closedAt ? formatDate(new Date(record.closedAt), ctx.timezone) : '—'}
              />
            </dl>
          </Section>

          <Section
            title="Status & workflow"
            subtitle="Move the record through its lifecycle"
            icon={<ClipboardCheck size={20} />}
            tone="teal"
            defaultOpen={false}
          >
            <div className="space-y-4">
              <form action={updateStatus} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={id} />
                <div className="space-y-1.5">
                  <Label>Move to</Label>
                  <Select name="status" defaultValue={record.status} disabled={record.locked}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" disabled={record.locked}>
                  Update status
                </Button>
              </form>
              {unansweredCount > 0 && !record.locked ? (
                <form action={passAll}>
                  <input type="hidden" name="recordId" value={id} />
                  <Button type="submit" variant="outline">
                    <CheckCircle2 size={14} /> Mark {unansweredCount} unanswered as pass
                  </Button>
                </form>
              ) : null}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Submitting or closing requires every criterion to be answered. Closing locks the
                record.
              </p>
            </div>
          </Section>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Criteria — one live card per criterion, grouped by section      */}
        {/* ---------------------------------------------------------------- */}
        <section id="section-criteria" className="scroll-mt-2">
          <Section
            title={`Criteria (${total})`}
            subtitle="Tap an answer — failures capture severity and remediation inline."
            icon={<ListChecks size={20} />}
            tone="blue"
            defaultOpen
          >
            {criteria.length === 0 ? (
              <Alert variant="info">
                <AlertTitle>No criteria</AlertTitle>
                <AlertDescription>
                  This record's type has no criteria. Add some in{' '}
                  <Link
                    href={`/inspections/types/${record.typeId}`}
                    className="text-teal-700 hover:underline dark:text-teal-400"
                  >
                    the type builder
                  </Link>
                  , then start a new inspection.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-4">
                {criteriaGroups.map((group, gi) => (
                  <div key={group.label ?? `__ungrouped_${gi}`} className="space-y-2">
                    {group.label || multiSection ? (
                      <div className="sticky top-0 z-[1] -mx-1 flex items-center gap-2 bg-white/90 px-1 py-1 backdrop-blur dark:bg-slate-900/90">
                        <h3 className="text-xs font-semibold tracking-wide text-slate-700 uppercase dark:text-slate-300">
                          {group.label ?? 'Ungrouped'}
                        </h3>
                        <span className="text-xs text-slate-400">
                          {group.rows.length} item{group.rows.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    ) : null}
                    {group.rows.map((row) => (
                      <CriterionCard
                        key={row.c.id}
                        recordId={id}
                        rowId={row.c.id}
                        index={indexById.get(row.c.id) ?? 0}
                        question={row.c.questionTextSnapshot}
                        responseType={row.c.responseType as CriterionResponseType}
                        requiresPhoto={row.c.requiresPhoto ?? false}
                        requiresComment={row.c.requiresComment ?? false}
                        answer={row.c.answer}
                        severity={row.c.severity as CriterionSeverity | null}
                        nonComplianceDescription={row.c.nonComplianceDescription}
                        actionTaken={row.c.actionTaken}
                        compliantNote={row.c.compliantNote}
                        assignedToPersonId={row.c.assignedToPersonId}
                        assignedDueDate={row.c.assignedDueDate}
                        correctedOn={row.c.correctedOn}
                        overdue={isOverdue({
                          answer: row.c.answer,
                          assignedDueDate: row.c.assignedDueDate,
                          correctedOn: row.c.correctedOn,
                          recordOccurredAt: record.occurredAt,
                        })}
                        photoPreviews={(row.c.photoAttachmentIds ?? [])
                          .map((aid) => data.criterionPhotoMap.get(aid))
                          .filter((p): p is { id: string; url: string; filename: string } =>
                            Boolean(p),
                          )}
                        correctiveActionRef={row.ca?.reference ?? null}
                        correctiveActionId={row.c.correctiveActionId}
                        peopleOptions={peopleOptions}
                        locked={record.locked}
                        allowCompliantNotes={type.allowCompliantNotes}
                        actions={criterionActions}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Section>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Photos                                                          */}
        {/* ---------------------------------------------------------------- */}
        <section id="section-photos" className="scroll-mt-2">
          <Section
            title={`Photos (${photos.length})`}
            icon={<Camera size={20} />}
            tone="slate"
            defaultOpen={photos.length > 0}
          >
            <div className="space-y-3">
              <PhotoGallery photos={galleryPhotos} />
              {!record.locked ? (
                <PhotoUploaderSection
                  attachAction={async (ids) => {
                    'use server'
                    await attachRecordPhotos(id, ids)
                  }}
                />
              ) : null}
            </div>
          </Section>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Customer signature                                              */}
        {/* ---------------------------------------------------------------- */}
        {needsSignature ? (
          <section id="section-signature" className="scroll-mt-2">
            <Section
              title="Customer sign-off"
              icon={<PenLine size={20} />}
              tone="emerald"
              defaultOpen
            >
              <CustomerSignatureCard
                recordId={id}
                currentSignature={
                  record.customerSignatureAttachmentId
                    ? attachmentUrl(record.customerSignatureAttachmentId)
                    : null
                }
                currentSignerName={record.customerSignerName}
                signedAt={record.customerSignedAt}
                locked={record.locked}
                saveAction={saveCustomerSignature}
              />
            </Section>
          </section>
        ) : null}

        {/* ---------------------------------------------------------------- */}
        {/* Activity                                                        */}
        {/* ---------------------------------------------------------------- */}
        <section id="section-activity" className="scroll-mt-2">
          <Section
            title={`Activity (${activity.length})`}
            icon={<History size={20} />}
            tone="slate"
            defaultOpen={false}
          >
            <ActivityFeed entries={activity} timeZone={ctx.timezone} />
          </Section>
        </section>
      </div>
    </DetailPageLayout>
  )
}

// ----------------------------------------------------------------------------
// Local presentational helpers
// ----------------------------------------------------------------------------

function StatTile({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: 'emerald' | 'red' | 'slate' | 'amber'
}) {
  const valueTone =
    accent === 'emerald'
      ? 'text-emerald-600'
      : accent === 'red'
        ? 'text-red-600'
        : accent === 'amber'
          ? 'text-amber-600'
          : 'text-slate-900 dark:text-slate-100'
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className={`text-2xl font-semibold tabular-nums ${valueTone}`}>{value}</div>
      <div className="mt-1 text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-slate-800 dark:text-slate-200">{value}</dd>
    </div>
  )
}
