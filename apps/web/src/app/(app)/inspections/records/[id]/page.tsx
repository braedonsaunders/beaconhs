import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
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
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { withStoredSignatureAttachment } from '@/lib/signature-storage'
import { isUuid } from '@/lib/list-params'
import { canSeeRecord } from '@/lib/visibility'
import {
  inspectionCriterionIsAnswered,
  isInspectionOutcomeResponseType,
  normalizeInspectionNumberAnswer,
  normalizeInspectionTextAnswer,
} from '@/lib/inspection-response-config'
import { FlowApprovals } from '@/components/flows/flow-approvals'
import { getPendingFlowGatesForSubject } from '@/lib/flows/gate-store'
import { canManageSubjectGates } from '@/lib/flows/registry'
import { recentActivityForEntity, recordAuditInTransaction } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailPageLayout } from '@/components/page-layout'
import { PhotoGallery } from '@/components/photo-gallery'
import { PhotoUploaderSection } from '@/components/photo-uploader-section'
import { PremiumSection as Section } from '@/components/premium-section'
import { SectionNav, type SectionNavItem } from '@/components/section-nav'
import { LiveDateTime, LiveField, LiveRemoteSelect } from '@/components/live-field'
import {
  assertInspectionStatusTransitionInTx,
  inspectionStatusMilestonePatch,
  lockVisibleInspectionRecordForMutation,
  parseAnswer,
  parseSeverity,
  reconcileSubmittedInspectionInTx,
  syncCorrectiveActionForCriterionInTx,
  validateInspectionPhotoAttachmentIdsInTx,
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

type InspectionTx = Parameters<
  Parameters<Awaited<ReturnType<typeof requireRequestContext>>['db']>[0]
>[0]

async function criterionForMutationInTx(
  tx: InspectionTx,
  tenantId: string,
  recordId: string,
  rowId: string,
) {
  const [criterion] = await tx
    .select()
    .from(inspectionRecordCriteria)
    .where(
      and(
        eq(inspectionRecordCriteria.tenantId, tenantId),
        eq(inspectionRecordCriteria.id, rowId),
        eq(inspectionRecordCriteria.recordId, recordId),
      ),
    )
    .limit(1)
  if (!criterion) throw new Error('Inspection criterion not found')
  return criterion
}

async function withLockedCriterionMutation(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  recordId: string,
  rowId: string,
  mutate: (
    tx: InspectionTx,
    record: typeof inspectionRecords.$inferSelect,
    criterion: typeof inspectionRecordCriteria.$inferSelect,
  ) => Promise<boolean>,
): Promise<boolean> {
  if (!isUuid(recordId) || !isUuid(rowId)) throw new Error('Inspection criterion not found')
  return ctx.db(async (tx) => {
    const record = await lockVisibleInspectionRecordForMutation(tx, ctx, recordId)
    const criterion = await criterionForMutationInTx(tx, ctx.tenantId, recordId, rowId)
    const changed = await mutate(tx, record, criterion)
    if (changed) await reconcileSubmittedInspectionInTx(tx, ctx, record)
    return changed
  })
}

async function markInspectionInProgressIfDraft(
  tx: InspectionTx,
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  record: typeof inspectionRecords.$inferSelect,
): Promise<boolean> {
  if (record.status !== 'draft') return false
  const [updated] = await tx
    .update(inspectionRecords)
    .set({ status: 'in_progress' })
    .where(
      and(
        eq(inspectionRecords.tenantId, ctx.tenantId),
        eq(inspectionRecords.id, record.id),
        eq(inspectionRecords.status, 'draft'),
        isNull(inspectionRecords.deletedAt),
      ),
    )
    .returning({ id: inspectionRecords.id })
  if (!updated) throw new Error('Inspection status changed before work could begin')
  await recordModuleFlowEvent(tx, ctx, {
    subjectId: record.id,
    moduleKey: 'inspections',
    event: 'status_change',
    toStatus: 'in_progress',
    occurrenceKey: randomUUID(),
  })
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'inspection_record',
    entityId: record.id,
    action: 'update',
    summary: 'Started inspection work',
    before: { status: 'draft' },
    after: { status: 'in_progress' },
  })
  return true
}

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!isUuid(id) || !STATUSES.includes(status as (typeof STATUSES)[number])) return
  const nextStatus = status as (typeof STATUSES)[number]
  const changed = await ctx.db(async (tx) => {
    const current = await lockVisibleInspectionRecordForMutation(tx, ctx, id)
    if (current.status === nextStatus) return false
    await assertInspectionStatusTransitionInTx(tx, ctx.tenantId, current, nextStatus)
    const now = new Date()
    const patch = inspectionStatusMilestonePatch(
      current,
      nextStatus,
      ctx.membership?.id ?? null,
      now,
    )
    const [updated] = await tx
      .update(inspectionRecords)
      .set(patch)
      .where(
        and(
          eq(inspectionRecords.tenantId, ctx.tenantId),
          eq(inspectionRecords.id, id),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .returning()
    if (!updated) throw new Error('Inspection record changed before its status could be updated')
    const occurrenceKey = randomUUID()
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: id,
      moduleKey: 'inspections',
      event: 'status_change',
      toStatus: nextStatus,
      occurrenceKey,
    })
    const wasSubmitted = current.status === 'submitted' || current.status === 'closed'
    const isSubmitted = nextStatus === 'submitted' || nextStatus === 'closed'
    if (isSubmitted && !wasSubmitted) {
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: id,
        moduleKey: 'inspections',
        event: 'on_submit',
        occurrenceKey,
      })
    }
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'inspection',
      targetRef: { inspectionTypeId: current.typeId },
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: id,
      action: 'update',
      summary: `Status changed to "${nextStatus.replace(/_/g, ' ')}"`,
      before: { status: current.status, locked: current.locked },
      after: { status: updated.status, locked: updated.locked },
    })
    return true
  })
  if (!changed) return
  revalidatePath(`/inspections/records/${id}`)
  revalidatePath('/inspections/records')
}

async function toggleLock(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const id = String(formData.get('id') ?? '')
  const lock = formData.get('lock') === 'true'
  if (!isUuid(id)) return
  const changed = await ctx.db(async (tx) => {
    const current = await lockVisibleInspectionRecordForMutation(tx, ctx, id, {
      allowLocked: true,
    })
    const reopeningClosed = current.status === 'closed' && !lock
    if (current.locked === lock && !reopeningClosed) return false
    const patch = reopeningClosed
      ? inspectionStatusMilestonePatch(current, 'submitted', ctx.membership?.id ?? null, new Date())
      : { locked: lock }
    const [updated] = await tx
      .update(inspectionRecords)
      .set(patch)
      .where(
        and(
          eq(inspectionRecords.tenantId, ctx.tenantId),
          eq(inspectionRecords.id, id),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .returning({
        id: inspectionRecords.id,
        status: inspectionRecords.status,
        locked: inspectionRecords.locked,
      })
    if (!updated) throw new Error('Inspection record changed before its lock could be updated')
    if (reopeningClosed) {
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: id,
        moduleKey: 'inspections',
        event: 'status_change',
        toStatus: 'submitted',
        occurrenceKey: randomUUID(),
      })
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'inspection',
        targetRef: { inspectionTypeId: current.typeId },
      })
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: id,
      action: 'update',
      summary: reopeningClosed ? 'Reopened closed inspection' : lock ? 'Locked' : 'Unlocked',
      before: { status: current.status, locked: current.locked },
      after: { status: updated.status, locked: updated.locked },
    })
    return true
  })
  if (!changed) return
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
  if (!isUuid(id) || !field) throw new Error('Missing or invalid id/field')
  const ALLOWED = new Set(['occurredAt', 'siteOrgUnitId', 'foremanText', 'notes'])
  if (!ALLOWED.has(field)) throw new Error('Field not allowed')

  const NULLABLE_IDS = new Set(['siteOrgUnitId'])
  const DATES = new Set(['occurredAt'])

  let val: unknown = value.trim() || null
  if (NULLABLE_IDS.has(field)) val = value || null
  if (NULLABLE_IDS.has(field) && val && !isUuid(String(val))) throw new Error('Invalid reference')
  if (DATES.has(field)) {
    const d = value ? new Date(value) : null
    if (!d || Number.isNaN(d.getTime())) throw new Error('Invalid date')
    val = d
  }

  const changed = await ctx.db(async (tx) => {
    const current = await lockVisibleInspectionRecordForMutation(tx, ctx, id)
    if (field === 'siteOrgUnitId' && val) {
      const [site] = await tx
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(
          and(
            eq(orgUnits.tenantId, ctx.tenantId),
            eq(orgUnits.id, String(val)),
            eq(orgUnits.level, 'site'),
            isNull(orgUnits.deletedAt),
          ),
        )
        .limit(1)
      if (!site) throw new Error('Site not found')
    }
    const beforeValue = current[field as keyof typeof current]
    const same =
      beforeValue instanceof Date && val instanceof Date
        ? beforeValue.getTime() === val.getTime()
        : beforeValue === val
    if (same) return false
    const [updated] = await tx
      .update(inspectionRecords)
      .set({ [field]: val } as Record<string, unknown>)
      .where(
        and(
          eq(inspectionRecords.tenantId, ctx.tenantId),
          eq(inspectionRecords.id, id),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .returning({ typeId: inspectionRecords.typeId })
    if (!updated) throw new Error('Inspection record not found')
    if (field === 'occurredAt') {
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'inspection',
        targetRef: { inspectionTypeId: updated.typeId },
      })
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: id,
      action: 'update',
      summary: `Updated ${field}`,
      before: { [field]: beforeValue },
      after: { [field]: val },
    })
    return true
  })
  if (!changed) return
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
  const clear = answer !== 'fail'
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, record, criterion) => {
      if (!isInspectionOutcomeResponseType(criterion.responseType)) {
        throw new Error('This criterion does not accept a pass/fail outcome')
      }
      const clearFieldsChanged =
        clear &&
        Boolean(
          criterion.severity ||
          criterion.nonComplianceDescription ||
          criterion.actionTaken ||
          criterion.compliantNote ||
          criterion.assignedToPersonId ||
          criterion.assignedToTenantUserId ||
          criterion.assignedDueDate ||
          criterion.correctedOn,
        )
      if (criterion.answer === answer && !clearFieldsChanged) return false
      const [updated] = await tx
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
                assignedToTenantUserId: null,
                assignedDueDate: null,
                correctedOn: null,
              }
            : {}),
        })
        .where(
          and(
            eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(inspectionRecordCriteria.recordId, recordId),
            eq(inspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: inspectionRecordCriteria.id })
      if (!updated) throw new Error('Inspection criterion changed before it could be answered')
      await markInspectionInProgressIfDraft(tx, ctx, record)
      await syncCorrectiveActionForCriterionInTx(tx, ctx, recordId, rowId)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'inspection_record',
        entityId: recordId,
        action: 'update',
        summary: `Answered "${criterion.questionTextSnapshot.slice(0, 50)}" — ${answer}`,
        before: { rowId, answer: criterion.answer },
        after: { rowId, answer },
      })
      return true
    },
  )
  if (!changed) return
  revalidatePath(`/inspections/records/${recordId}`)
}

async function setCriterionChoiceAnswer(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const choiceAnswer = String(formData.get('choiceAnswer') ?? '').trim() || null
  if (!recordId || !rowId) return
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, record, criterion) => {
      if (criterion.responseType !== 'choice') {
        throw new Error('This criterion does not accept a configured choice')
      }
      if (choiceAnswer && !(criterion.choiceOptionsSnapshot ?? []).includes(choiceAnswer)) {
        throw new Error('Select one of the configured options')
      }
      if (criterion.choiceAnswer === choiceAnswer) return false
      const [updated] = await tx
        .update(inspectionRecordCriteria)
        .set({
          choiceAnswer,
          answeredAt: choiceAnswer ? new Date() : null,
          answeredByTenantUserId: choiceAnswer ? (ctx.membership?.id ?? null) : null,
        })
        .where(
          and(
            eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(inspectionRecordCriteria.recordId, recordId),
            eq(inspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: inspectionRecordCriteria.id })
      if (!updated) throw new Error('Inspection criterion changed before it could be answered')
      if (choiceAnswer) await markInspectionInProgressIfDraft(tx, ctx, record)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'inspection_record',
        entityId: recordId,
        action: 'update',
        summary: `Answered "${criterion.questionTextSnapshot.slice(0, 50)}" — ${choiceAnswer ?? 'cleared'}`,
        before: { rowId, choiceAnswer: criterion.choiceAnswer },
        after: { rowId, choiceAnswer },
      })
      return true
    },
  )
  if (!changed) return
  revalidatePath(`/inspections/records/${recordId}`)
}

async function setCriterionValueAnswer(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  if (!recordId || !rowId) return
  const rawValue = formData.get('value')
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, record, criterion) => {
      const isText = criterion.responseType === 'text' || criterion.responseType === 'long_text'
      const isNumber = criterion.responseType === 'number'
      if (!isText && !isNumber) {
        throw new Error('This criterion does not accept a text or number value')
      }
      const value = isNumber
        ? normalizeInspectionNumberAnswer(rawValue)
        : normalizeInspectionTextAnswer(rawValue)
      const beforeValue = isNumber ? criterion.numberAnswer : criterion.textAnswer
      if (beforeValue === value) return false
      const [updated] = await tx
        .update(inspectionRecordCriteria)
        .set({
          textAnswer: isText ? value : null,
          numberAnswer: isNumber ? value : null,
          answeredAt: value === null ? null : new Date(),
          answeredByTenantUserId: value === null ? null : (ctx.membership?.id ?? null),
        })
        .where(
          and(
            eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(inspectionRecordCriteria.recordId, recordId),
            eq(inspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: inspectionRecordCriteria.id })
      if (!updated) throw new Error('Inspection criterion changed before it could be answered')
      if (value !== null) await markInspectionInProgressIfDraft(tx, ctx, record)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'inspection_record',
        entityId: recordId,
        action: 'update',
        summary: `Answered "${criterion.questionTextSnapshot.slice(0, 50)}" — ${value ?? 'cleared'}`,
        before: { rowId, responseType: criterion.responseType, value: beforeValue },
        after: { rowId, responseType: criterion.responseType, value },
      })
      return true
    },
  )
  if (!changed) return
  revalidatePath(`/inspections/records/${recordId}`)
}

async function setCriterionSeverity(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const rawSeverity = String(formData.get('severity') ?? '').trim()
  const severity = parseSeverity(rawSeverity)
  if (!recordId || !rowId) return
  if (rawSeverity && !severity) throw new Error('Severity is invalid')
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      if (severity && criterion.answer !== 'fail') {
        throw new Error('Severity applies only to a failed criterion')
      }
      if (criterion.severity === severity) return false
      const [updated] = await tx
        .update(inspectionRecordCriteria)
        .set({ severity })
        .where(
          and(
            eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(inspectionRecordCriteria.recordId, recordId),
            eq(inspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: inspectionRecordCriteria.id })
      if (!updated) throw new Error('Inspection criterion changed before severity could be saved')
      await syncCorrectiveActionForCriterionInTx(tx, ctx, recordId, rowId)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'inspection_record',
        entityId: recordId,
        action: 'update',
        summary: `Set severity to "${severity ?? 'cleared'}" on a finding`,
        before: { rowId, severity: criterion.severity },
        after: { rowId, severity },
      })
      return true
    },
  )
  if (!changed) return
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
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      if (value && criterion.answer !== 'fail') {
        throw new Error('A non-compliance description applies only to a failed criterion')
      }
      if (criterion.nonComplianceDescription === value) return false
      const [updated] = await tx
        .update(inspectionRecordCriteria)
        .set({ nonComplianceDescription: value })
        .where(
          and(
            eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(inspectionRecordCriteria.recordId, recordId),
            eq(inspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: inspectionRecordCriteria.id })
      if (!updated)
        throw new Error('Inspection criterion changed before description could be saved')
      await syncCorrectiveActionForCriterionInTx(tx, ctx, recordId, rowId)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'inspection_record',
        entityId: recordId,
        action: 'update',
        summary: 'Updated non-compliance description',
        before: { rowId, value: criterion.nonComplianceDescription },
        after: { rowId, value },
      })
      return true
    },
  )
  if (!changed) return
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
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      if (value && criterion.answer !== 'fail') {
        throw new Error('An action taken applies only to a failed criterion')
      }
      if (criterion.actionTaken === value) return false
      const [updated] = await tx
        .update(inspectionRecordCriteria)
        .set({ actionTaken: value })
        .where(
          and(
            eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(inspectionRecordCriteria.recordId, recordId),
            eq(inspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: inspectionRecordCriteria.id })
      if (!updated)
        throw new Error('Inspection criterion changed before action taken could be saved')
      await syncCorrectiveActionForCriterionInTx(tx, ctx, recordId, rowId)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'inspection_record',
        entityId: recordId,
        action: 'update',
        summary: 'Updated action taken',
        before: { rowId, value: criterion.actionTaken },
        after: { rowId, value },
      })
      return true
    },
  )
  if (!changed) return
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
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      if (criterion.compliantNote === value) return false
      const [updated] = await tx
        .update(inspectionRecordCriteria)
        .set({ compliantNote: value })
        .where(
          and(
            eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(inspectionRecordCriteria.recordId, recordId),
            eq(inspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: inspectionRecordCriteria.id })
      if (!updated) throw new Error('Inspection criterion changed before note could be saved')
      await syncCorrectiveActionForCriterionInTx(tx, ctx, recordId, rowId)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'inspection_record',
        entityId: recordId,
        action: 'update',
        summary: 'Updated compliant note',
        before: { rowId, value: criterion.compliantNote },
        after: { rowId, value },
      })
      return true
    },
  )
  if (!changed) return
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
  if (assignedToPersonId && !isUuid(assignedToPersonId)) throw new Error('Assignee is invalid')
  if (assignedDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(assignedDueDate)) {
    throw new Error('Due date is invalid')
  }
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      if ((assignedToPersonId || assignedDueDate) && criterion.answer !== 'fail') {
        throw new Error('An assignment applies only to a failed criterion')
      }
      let assignedToTenantUserId: string | null = null
      if (assignedToPersonId) {
        const [person] = await tx
          .select({ id: people.id, tenantUserId: tenantUsers.id })
          .from(people)
          .leftJoin(
            tenantUsers,
            and(
              eq(tenantUsers.tenantId, people.tenantId),
              eq(tenantUsers.userId, people.userId),
              eq(tenantUsers.status, 'active'),
            ),
          )
          .where(
            and(
              eq(people.tenantId, ctx.tenantId),
              eq(people.id, assignedToPersonId),
              eq(people.status, 'active'),
              isNull(people.deletedAt),
            ),
          )
          .limit(1)
        if (!person) throw new Error('Assignee not found')
        assignedToTenantUserId = person.tenantUserId
      }
      if (
        criterion.assignedToPersonId === assignedToPersonId &&
        criterion.assignedToTenantUserId === assignedToTenantUserId &&
        criterion.assignedDueDate === assignedDueDate
      ) {
        return false
      }
      const [updated] = await tx
        .update(inspectionRecordCriteria)
        .set({ assignedToPersonId, assignedToTenantUserId, assignedDueDate })
        .where(
          and(
            eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(inspectionRecordCriteria.recordId, recordId),
            eq(inspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: inspectionRecordCriteria.id })
      if (!updated) throw new Error('Inspection criterion changed before assignment could be saved')
      await syncCorrectiveActionForCriterionInTx(tx, ctx, recordId, rowId)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'inspection_record',
        entityId: recordId,
        action: 'update',
        summary: 'Updated assignment',
        before: {
          rowId,
          assignedToPersonId: criterion.assignedToPersonId,
          assignedToTenantUserId: criterion.assignedToTenantUserId,
          assignedDueDate: criterion.assignedDueDate,
        },
        after: { rowId, assignedToPersonId, assignedToTenantUserId, assignedDueDate },
      })
      return true
    },
  )
  if (!changed) return
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
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Correction date is invalid')
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      if (value && criterion.answer !== 'fail') {
        throw new Error('A correction date applies only to a failed criterion')
      }
      if (criterion.correctedOn === value) return false
      const [updated] = await tx
        .update(inspectionRecordCriteria)
        .set({ correctedOn: value })
        .where(
          and(
            eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(inspectionRecordCriteria.recordId, recordId),
            eq(inspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: inspectionRecordCriteria.id })
      if (!updated)
        throw new Error('Inspection criterion changed before correction date could be saved')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'inspection_record',
        entityId: recordId,
        action: 'update',
        summary: value ? `Marked finding corrected on ${value}` : 'Cleared corrected-on date',
        before: { rowId, correctedOn: criterion.correctedOn },
        after: { rowId, correctedOn: value },
      })
      return true
    },
  )
  if (!changed) return
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
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      const validIds = await validateInspectionPhotoAttachmentIdsInTx(tx, ctx.tenantId, ids)
      const previousIds = criterion.photoAttachmentIds ?? []
      const nextIds = [...new Set([...previousIds, ...validIds])]
      if (nextIds.length === previousIds.length) return false
      const [updated] = await tx
        .update(inspectionRecordCriteria)
        .set({ photoAttachmentIds: nextIds })
        .where(
          and(
            eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(inspectionRecordCriteria.recordId, recordId),
            eq(inspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: inspectionRecordCriteria.id })
      if (!updated) throw new Error('Inspection criterion changed before photos could be attached')
      const added = nextIds.length - previousIds.length
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'inspection_record',
        entityId: recordId,
        action: 'update',
        summary: `Attached ${added} photo${added === 1 ? '' : 's'} to a criterion`,
        before: { rowId, photoAttachmentIds: previousIds },
        after: { rowId, photoAttachmentIds: nextIds },
      })
      return true
    },
  )
  if (!changed) return
  revalidatePath(`/inspections/records/${recordId}`)
}

async function passAll(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  if (!isUuid(recordId)) throw new Error('Inspection record not found')
  const flipped = await ctx.db(async (tx) => {
    const record = await lockVisibleInspectionRecordForMutation(tx, ctx, recordId)
    const rows = await tx
      .select({ id: inspectionRecordCriteria.id })
      .from(inspectionRecordCriteria)
      .where(
        and(
          eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
          eq(inspectionRecordCriteria.recordId, recordId),
          isNull(inspectionRecordCriteria.answer),
          inArray(inspectionRecordCriteria.responseType, ['pass_fail_na', 'yes_no', 'rating']),
        ),
      )
    if (rows.length === 0) return 0
    const updated = await tx
      .update(inspectionRecordCriteria)
      .set({
        answer: 'pass',
        answeredAt: new Date(),
        answeredByTenantUserId: ctx.membership?.id ?? null,
      })
      .where(
        and(
          eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
          eq(inspectionRecordCriteria.recordId, recordId),
          isNull(inspectionRecordCriteria.answer),
          inArray(inspectionRecordCriteria.responseType, ['pass_fail_na', 'yes_no', 'rating']),
        ),
      )
      .returning({ id: inspectionRecordCriteria.id })
    if (updated.length !== rows.length) {
      throw new Error('Inspection criteria changed before they could all be marked pass')
    }
    await markInspectionInProgressIfDraft(tx, ctx, record)
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: recordId,
      action: 'update',
      summary: `Marked all as pass via shortcut (${updated.length} item${updated.length === 1 ? '' : 's'} flipped)`,
      metadata: { flipped: updated.length },
    })
    return updated.length
  })
  if (flipped === 0) return
  revalidatePath(`/inspections/records/${recordId}`)
}

async function saveCustomerSignature(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  const recordId = String(formData.get('recordId') ?? '')
  const signature = String(formData.get('signature') ?? '')
  const signerName = String(formData.get('signerName') ?? '').trim() || null
  if (!isUuid(recordId)) throw new Error('Inspection record not found')
  const dataUrl = signature === 'clear' || signature === '' ? null : signature
  const changed = await withStoredSignatureAttachment(ctx, dataUrl, async (tx, attachmentId) => {
    const current = await lockVisibleInspectionRecordForMutation(tx, ctx, recordId)
    const nextSignerName = attachmentId ? signerName : null
    if (
      !attachmentId &&
      !current.customerSignatureAttachmentId &&
      !current.customerSignerName &&
      !current.customerSignedAt
    ) {
      return false
    }
    const [updated] = await tx
      .update(inspectionRecords)
      .set({
        customerSignatureAttachmentId: attachmentId,
        customerSignerName: nextSignerName,
        customerSignedAt: attachmentId ? new Date() : null,
      })
      .where(
        and(
          eq(inspectionRecords.tenantId, ctx.tenantId),
          eq(inspectionRecords.id, recordId),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .returning({ id: inspectionRecords.id })
    if (!updated) throw new Error('Inspection record changed before its signature could be saved')
    if (
      current.customerSignatureAttachmentId &&
      current.customerSignatureAttachmentId !== attachmentId
    ) {
      const [retired] = await tx
        .delete(attachments)
        .where(
          and(
            eq(attachments.tenantId, ctx.tenantId),
            eq(attachments.id, current.customerSignatureAttachmentId),
            eq(attachments.kind, 'signature'),
          ),
        )
        .returning({ id: attachments.id })
      if (!retired) throw new Error('The previous customer signature could not be retired')
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: recordId,
      action: attachmentId ? 'sign' : 'update',
      summary: attachmentId ? 'Captured customer signature' : 'Cleared customer signature',
      before: {
        customerSignatureAttachmentId: current.customerSignatureAttachmentId,
        customerSignerName: current.customerSignerName,
      },
      after: {
        customerSignatureAttachmentId: attachmentId,
        customerSignerName: nextSignerName,
      },
    })
    return true
  })
  if (!changed) return
  revalidatePath(`/inspections/records/${recordId}`)
}

// Plain helper — invoked by the inline photo-attach server action below.
async function attachRecordPhotos(recordId: string, ids: string[]) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.update')
  if (!isUuid(recordId)) throw new Error('Inspection record not found')
  if (ids.length === 0) return
  const attached = await ctx.db(async (tx) => {
    await lockVisibleInspectionRecordForMutation(tx, ctx, recordId)
    const validIds = await validateInspectionPhotoAttachmentIdsInTx(tx, ctx.tenantId, ids)
    const existing = await tx
      .select({ attachmentId: inspectionRecordAttachments.attachmentId })
      .from(inspectionRecordAttachments)
      .where(
        and(
          eq(inspectionRecordAttachments.tenantId, ctx.tenantId),
          eq(inspectionRecordAttachments.recordId, recordId),
          inArray(inspectionRecordAttachments.attachmentId, validIds),
        ),
      )
    const existingIds = new Set(existing.map((row) => row.attachmentId))
    const newIds = validIds.filter((id) => !existingIds.has(id))
    if (newIds.length === 0) return 0
    await tx.insert(inspectionRecordAttachments).values(
      newIds.map((attachmentId) => ({
        tenantId: ctx.tenantId,
        recordId,
        attachmentId,
      })),
    )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: recordId,
      action: 'update',
      summary: `Attached ${newIds.length} photo${newIds.length === 1 ? '' : 's'}`,
      after: { attachmentIds: newIds },
    })
    return newIds.length
  })
  if (attached === 0) return
  revalidatePath(`/inspections/records/${recordId}`)
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_0436192894023b', { value0: id.slice(0, 8) }) }
}

export default async function InspectionRecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.read.self')
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
      .innerJoin(
        inspectionTypes,
        and(
          eq(inspectionTypes.tenantId, inspectionRecords.tenantId),
          eq(inspectionTypes.id, inspectionRecords.typeId),
        ),
      )
      .leftJoin(
        orgUnits,
        and(
          eq(orgUnits.tenantId, inspectionRecords.tenantId),
          eq(orgUnits.id, inspectionRecords.siteOrgUnitId),
        ),
      )
      .leftJoin(
        tenantUsers,
        and(
          eq(tenantUsers.tenantId, inspectionRecords.tenantId),
          eq(tenantUsers.id, inspectionRecords.inspectorTenantUserId),
        ),
      )
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(
        and(
          eq(inspectionRecords.tenantId, ctx.tenantId),
          eq(inspectionRecords.id, id),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .limit(1)
    if (!row) return null
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'inspections',
      ownerIds: [row.record.inspectorTenantUserId, row.record.submittedByTenantUserId],
      siteId: row.record.siteOrgUnitId,
    })
    if (!visible) return null

    const criteria = await tx
      .select({
        c: inspectionRecordCriteria,
        assignee: people,
        ca: correctiveActions,
      })
      .from(inspectionRecordCriteria)
      .leftJoin(
        people,
        and(
          eq(people.tenantId, inspectionRecordCriteria.tenantId),
          eq(people.id, inspectionRecordCriteria.assignedToPersonId),
          isNull(people.deletedAt),
        ),
      )
      .leftJoin(
        correctiveActions,
        and(
          eq(correctiveActions.tenantId, inspectionRecordCriteria.tenantId),
          eq(correctiveActions.id, inspectionRecordCriteria.correctiveActionId),
          isNull(correctiveActions.deletedAt),
        ),
      )
      .where(
        and(
          eq(inspectionRecordCriteria.tenantId, ctx.tenantId),
          eq(inspectionRecordCriteria.recordId, id),
        ),
      )
      .orderBy(asc(inspectionRecordCriteria.sequence))

    const photos = await tx
      .select({ link: inspectionRecordAttachments, attachment: attachments })
      .from(inspectionRecordAttachments)
      .innerJoin(
        attachments,
        and(
          eq(attachments.tenantId, inspectionRecordAttachments.tenantId),
          eq(attachments.id, inspectionRecordAttachments.attachmentId),
          eq(attachments.kind, 'image'),
        ),
      )
      .where(
        and(
          eq(inspectionRecordAttachments.tenantId, ctx.tenantId),
          eq(inspectionRecordAttachments.recordId, id),
        ),
      )

    // Resolve per-criterion photo previews in one pass.
    const allPhotoIds = Array.from(new Set(criteria.flatMap((c) => c.c.photoAttachmentIds ?? [])))
    const criterionPhotoMap = new Map<string, { id: string; url: string; filename: string }>()
    if (allPhotoIds.length > 0) {
      const rows = await tx
        .select({ id: attachments.id, key: attachments.r2Key, filename: attachments.filename })
        .from(attachments)
        .where(
          and(
            eq(attachments.tenantId, ctx.tenantId),
            eq(attachments.kind, 'image'),
            inArray(attachments.id, allPhotoIds),
          ),
        )
      for (const r of rows) {
        criterionPhotoMap.set(r.id, {
          id: r.id,
          url: attachmentUrl(r.id),
          filename: r.filename,
        })
      }
    }

    return { ...row, criteria, photos, criterionPhotoMap }
  })

  if (!data) notFound()
  const { record, type, site, inspector, criteria, photos } = data

  // Summary counts
  const total = criteria.length
  const passCount = criteria.filter((c) => c.c.answer === 'pass').length
  const failCount = criteria.filter((c) => c.c.answer === 'fail').length
  const naCount = criteria.filter((c) => c.c.answer === 'n_a').length
  const isAnswered = (criterion: typeof inspectionRecordCriteria.$inferSelect) =>
    inspectionCriterionIsAnswered({
      responseType: criterion.responseType,
      outcomeAnswer: criterion.answer,
      choiceAnswer: criterion.choiceAnswer,
      textAnswer: criterion.textAnswer,
      numberAnswer: criterion.numberAnswer,
    })
  const supplementalAnsweredCount = criteria.filter(
    (c) => !isInspectionOutcomeResponseType(c.c.responseType) && isAnswered(c.c),
  ).length
  const hasSupplementalCriteria = criteria.some(
    (c) => !isInspectionOutcomeResponseType(c.c.responseType),
  )
  const unansweredCount = criteria.filter((c) => !isAnswered(c.c)).length
  const passableUnansweredCount = criteria.filter(
    (c) => isInspectionOutcomeResponseType(c.c.responseType) && !c.c.answer,
  ).length
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

  const criterionActions = {
    setAnswer: setCriterionAnswer,
    setChoiceAnswer: setCriterionChoiceAnswer,
    setValueAnswer: setCriterionValueAnswer,
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
  const recordImmutable = record.locked || record.status === 'closed'

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
          title={tGeneratedValue(`${type.name}`)}
          subtitle={tGeneratedValue(
            `${record.reference} · ${formatDateTime(new Date(record.occurredAt), ctx.timezone, ctx.locale)}`,
          )}
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
                <GeneratedValue value={record.status.replace(/_/g, ' ')} />
              </Badge>
              <GeneratedValue
                value={
                  recordImmutable ? (
                    <Badge variant="success">
                      <Lock size={10} /> <GeneratedText id="m_0e259fa0babc2d" />
                    </Badge>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  failCount > 0 ? (
                    <Badge variant="destructive">
                      <ShieldAlert size={10} /> <GeneratedValue value={failCount} />{' '}
                      <GeneratedText id="m_14d24a7af36317" />
                      <GeneratedValue
                        value={failCount === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
                      />
                    </Badge>
                  ) : null
                }
              />
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
                <FileText size={14} /> <GeneratedText id="m_1a2b2ed6729166" />
              </Link>
              <form action={toggleLock}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="lock" value={recordImmutable ? 'false' : 'true'} />
                <Button variant="outline" type="submit">
                  <GeneratedValue
                    value={
                      recordImmutable ? (
                        <>
                          <Unlock size={14} /> <GeneratedText id="m_0ca830c9381fd6" />
                        </>
                      ) : (
                        <>
                          <Lock size={14} /> <GeneratedText id="m_19f2c846c5777a" />
                        </>
                      )
                    }
                  />
                </Button>
              </form>
            </div>
          }
        />
      }
      alerts={
        <>
          <GeneratedValue
            value={
              recordImmutable ? (
                <Alert variant="warning">
                  <AlertTitle>
                    <GeneratedValue
                      value={
                        record.status === 'closed' ? (
                          <GeneratedText id="m_0ebf07876cd391" />
                        ) : (
                          <GeneratedText id="m_1a9deab2633a94" />
                        )
                      }
                    />
                  </AlertTitle>
                  <AlertDescription>
                    <GeneratedValue
                      value={
                        record.status === 'closed' ? (
                          <>
                            <GeneratedText id="m_01381607e25f0d" />
                            <GeneratedValue value={' '} />
                            <GeneratedValue
                              value={
                                record.closedAt ? (
                                  formatDate(new Date(record.closedAt), ctx.timezone, ctx.locale)
                                ) : (
                                  <GeneratedText id="m_15e0a049681b58" />
                                )
                              }
                            />
                            <GeneratedText id="m_0be94f4d1ad8da" />
                          </>
                        ) : (
                          <>
                            <GeneratedText id="m_16987bb5ddf0c8" />
                          </>
                        )
                      }
                    />
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
          <GeneratedValue
            value={
              needsSignature && !signed ? (
                <Alert variant="info">
                  <AlertTitle>
                    <GeneratedText id="m_02ffe91f500dc8" />
                  </AlertTitle>
                  <AlertDescription>
                    <GeneratedText id="m_1ed6655040e79e" />
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
        </>
      }
      subtabs={<SectionNav sections={sectionItems} />}
    >
      <div className="ff-surface space-y-5">
        <GeneratedValue
          value={pendingGates.length > 0 ? <FlowApprovals gates={pendingGates} /> : null}
        />

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
                  <GeneratedValue value={completionPct} />%
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  <GeneratedValue value={answeredCount} /> <GeneratedText id="m_00e704d1194796" />{' '}
                  <GeneratedValue value={total} /> <GeneratedText id="m_02fc780b01e239" />
                </div>
                <div className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={type.name} />
                  <GeneratedValue value={site ? ` · ${site.name}` : ''} />
                  <GeneratedValue value={inspector?.name ? ` · ${inspector.name}` : ''} />
                </div>
              </div>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
              <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
                <GeneratedText id="m_07f2b2ca960987" />
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
                  <GeneratedValue value={compliantPct} />%
                </span>
                <span className="text-xs text-slate-400">
                  <GeneratedValue value={passCount} />/<GeneratedValue value={failCount} />/
                  <GeneratedValue value={naCount} />
                </span>
              </div>
            </div>
          </div>

          {/* Compliance tiles */}
          <div
            className={`grid grid-cols-2 gap-3 ${hasSupplementalCriteria ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}
          >
            <StatTile label={tGenerated('m_0e4b19568a01bf')} value={passCount} accent="emerald" />
            <StatTile label={tGenerated('m_169669494a86f8')} value={failCount} accent="red" />
            <StatTile label={tGenerated('m_06702e4064e393')} value={naCount} accent="slate" />
            <GeneratedValue
              value={
                hasSupplementalCriteria ? (
                  <StatTile
                    label={tGenerated('m_0cbfa10af93f84')}
                    value={supplementalAnsweredCount}
                    accent="emerald"
                  />
                ) : null
              }
            />
            <StatTile
              label={tGenerated('m_19224fcc639fd1')}
              value={unansweredCount}
              accent="amber"
            />
          </div>

          <Section
            title={tGenerated('m_14d50eff4a957b')}
            subtitle={tGenerated('m_1cf9885ac52ebd')}
            icon={<Building2 size={20} />}
            tone="slate"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <LiveDateTime
                id={record.id}
                field="occurredAt"
                label={tGenerated('m_03f174df92cf82')}
                initialValue={localDatetimeValue(new Date(record.occurredAt))}
                disabled={recordImmutable}
                updateAction={updateRecordField}
              />
              <LiveRemoteSelect
                id={record.id}
                field="siteOrgUnitId"
                label={tGenerated('m_020146dd3d3d5a')}
                initialValue={record.siteOrgUnitId}
                lookup="inspection-sites"
                disabled={recordImmutable}
                updateAction={updateRecordField}
              />
              <div className="sm:col-span-2">
                <LiveField
                  id={record.id}
                  field="foremanText"
                  label={tGenerated('m_184fa8d9234543')}
                  initialValue={record.foremanText}
                  placeholder={tGenerated('m_075c37024b0c8f')}
                  disabled={recordImmutable}
                  updateAction={updateRecordField}
                />
              </div>
              <div className="sm:col-span-2">
                <LiveField
                  id={record.id}
                  field="notes"
                  label={tGenerated('m_0b8dadcb78cd08')}
                  initialValue={record.notes}
                  multiline
                  rows={3}
                  placeholder={tGenerated('m_006d3808edf66d')}
                  disabled={recordImmutable}
                  updateAction={updateRecordField}
                />
              </div>
            </div>

            {/* Read-only context */}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4 dark:border-slate-800">
              <Meta
                label={tGenerated('m_17dc61a19b605c')}
                value={
                  <span className="font-mono">
                    <GeneratedValue value={record.reference} />
                  </span>
                }
              />
              <Meta
                label={tGenerated('m_074ba2f160c506')}
                value={
                  <Link
                    className="text-teal-700 hover:underline dark:text-teal-400"
                    href={`/inspections/types/${record.typeId}`}
                  >
                    <GeneratedValue value={type.name} />
                  </Link>
                }
              />
              <Meta
                label={tGenerated('m_0c823c3949ebd6')}
                value={
                  record.submittedAt
                    ? formatDate(new Date(record.submittedAt), ctx.timezone, ctx.locale)
                    : '—'
                }
              />
              <Meta
                label={tGenerated('m_003ea77d773d2d')}
                value={
                  record.closedAt
                    ? formatDate(new Date(record.closedAt), ctx.timezone, ctx.locale)
                    : '—'
                }
              />
            </dl>
          </Section>

          <Section
            title={tGenerated('m_0593bc61467f52')}
            subtitle={tGenerated('m_0d00823cf5c9d8')}
            icon={<ClipboardCheck size={20} />}
            tone="teal"
            defaultOpen={false}
          >
            <div className="space-y-4">
              <form action={updateStatus} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={id} />
                <div className="space-y-1.5">
                  <Label>
                    <GeneratedText id="m_1e8891cb78e5a3" />
                  </Label>
                  <Select name="status" defaultValue={record.status} disabled={recordImmutable}>
                    <GeneratedValue
                      value={STATUSES.map((s) => (
                        <option key={s} value={s}>
                          <GeneratedValue value={s.replace(/_/g, ' ')} />
                        </option>
                      ))}
                    />
                  </Select>
                </div>
                <Button type="submit" disabled={recordImmutable}>
                  <GeneratedText id="m_0f931aecc2cfc6" />
                </Button>
              </form>
              <GeneratedValue
                value={
                  passableUnansweredCount > 0 && !recordImmutable ? (
                    <form action={passAll}>
                      <input type="hidden" name="recordId" value={id} />
                      <Button type="submit" variant="outline">
                        <CheckCircle2 size={14} /> <GeneratedText id="m_14001de0aa07db" />{' '}
                        <GeneratedValue value={passableUnansweredCount} />{' '}
                        <GeneratedText id="m_1df46fe684f01f" />
                      </Button>
                    </form>
                  ) : null
                }
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_16ef6bf830b172" />
              </p>
            </div>
          </Section>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Criteria — one live card per criterion, grouped by section      */}
        {/* ---------------------------------------------------------------- */}
        <section id="section-criteria" className="scroll-mt-2">
          <Section
            title={tGenerated('m_04f78c562a8b56', { value0: total })}
            subtitle={tGenerated('m_1a1f624e1388c1')}
            icon={<ListChecks size={20} />}
            tone="blue"
            defaultOpen
          >
            <GeneratedValue
              value={
                criteria.length === 0 ? (
                  <Alert variant="info">
                    <AlertTitle>
                      <GeneratedText id="m_09abab0bd4ecdf" />
                    </AlertTitle>
                    <AlertDescription>
                      <GeneratedText id="m_1d25507d45162d" />
                      <GeneratedValue value={' '} />
                      <Link
                        href={`/inspections/types/${record.typeId}`}
                        className="text-teal-700 hover:underline dark:text-teal-400"
                      >
                        <GeneratedText id="m_0834705a18681d" />
                      </Link>
                      <GeneratedText id="m_1fe3e4d8851426" />
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-4">
                    <GeneratedValue
                      value={criteriaGroups.map((group, gi) => (
                        <div key={group.label ?? `__ungrouped_${gi}`} className="space-y-2">
                          <GeneratedValue
                            value={
                              group.label || multiSection ? (
                                <div className="sticky top-0 z-[1] -mx-1 flex items-center gap-2 bg-white/90 px-1 py-1 backdrop-blur dark:bg-slate-900/90">
                                  <h3 className="text-xs font-semibold tracking-wide text-slate-700 uppercase dark:text-slate-300">
                                    <GeneratedValue
                                      value={group.label ?? <GeneratedText id="m_124ee6c18e0195" />}
                                    />
                                  </h3>
                                  <span className="text-xs text-slate-400">
                                    <GeneratedValue value={group.rows.length} />{' '}
                                    <GeneratedText id="m_089f2b1abdb347" />
                                    <GeneratedValue
                                      value={
                                        group.rows.length === 1 ? (
                                          ''
                                        ) : (
                                          <GeneratedText id="m_00ded356f0f424" />
                                        )
                                      }
                                    />
                                  </span>
                                </div>
                              ) : null
                            }
                          />
                          <GeneratedValue
                            value={group.rows.map((row) => (
                              <CriterionCard
                                key={row.c.id}
                                recordId={id}
                                rowId={row.c.id}
                                index={indexById.get(row.c.id) ?? 0}
                                question={row.c.questionTextSnapshot}
                                responseType={row.c.responseType as CriterionResponseType}
                                choiceOptions={row.c.choiceOptionsSnapshot}
                                choiceAnswer={row.c.choiceAnswer}
                                textAnswer={row.c.textAnswer}
                                numberAnswer={row.c.numberAnswer}
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
                                locked={recordImmutable}
                                allowCompliantNotes={type.allowCompliantNotes}
                                actions={criterionActions}
                              />
                            ))}
                          />
                        </div>
                      ))}
                    />
                  </div>
                )
              }
            />
          </Section>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Photos                                                          */}
        {/* ---------------------------------------------------------------- */}
        <section id="section-photos" className="scroll-mt-2">
          <Section
            title={tGenerated('m_0705e8a460ad79', { value0: photos.length })}
            icon={<Camera size={20} />}
            tone="slate"
            defaultOpen={photos.length > 0}
          >
            <div className="space-y-3">
              <PhotoGallery photos={galleryPhotos} />
              <GeneratedValue
                value={
                  !recordImmutable ? (
                    <PhotoUploaderSection
                      attachAction={async (ids) => {
                        'use server'
                        await attachRecordPhotos(id, ids)
                      }}
                    />
                  ) : null
                }
              />
            </div>
          </Section>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Customer signature                                              */}
        {/* ---------------------------------------------------------------- */}
        <GeneratedValue
          value={
            needsSignature ? (
              <section id="section-signature" className="scroll-mt-2">
                <Section
                  title={tGenerated('m_12a3bdfedff1f8')}
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
                    locked={recordImmutable}
                    saveAction={saveCustomerSignature}
                  />
                </Section>
              </section>
            ) : null
          }
        />

        {/* ---------------------------------------------------------------- */}
        {/* Activity                                                        */}
        {/* ---------------------------------------------------------------- */}
        <section id="section-activity" className="scroll-mt-2">
          <Section
            title={tGenerated('m_158532c8e94ad5', { value0: activity.length })}
            icon={<History size={20} />}
            tone="slate"
            defaultOpen={false}
          >
            <ActivityFeed entries={activity} timeZone={ctx.timezone} locale={ctx.locale} />
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
      <div className={`text-2xl font-semibold tabular-nums ${valueTone}`}>
        <GeneratedValue value={value} />
      </div>
      <div className="mt-1 text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        <GeneratedValue value={label} />
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
        <GeneratedValue value={label} />
      </dt>
      <dd className="mt-0.5 text-slate-800 dark:text-slate-200">
        <GeneratedValue value={value} />
      </dd>
    </div>
  )
}
