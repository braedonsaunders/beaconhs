import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
// /ppe/[id] — per-item detail with sub-tabs.
//
// Tabs:
//   overview     → DetailGrid of the item's metadata
//   inspections  → list of past inspections + a criteria-driven form that pulls
//                  from ppe_type_inspection_criteria for the item's type
//   annual       → list of ppe_annual_records (third-party recertifications)
//                  + add-form with certificate upload pointer
//   issues       → defective-PPE issue reports (open / resolved)
//   history      → issue / return / replace ledger
//   status       → status mutator with holder picker when switching to 'issued'
//
// All mutations recordAudit. Failing pre-use inspections with severity ≥ high
// auto-spawn a CA in the same transaction as the inspection evidence.

import Link from 'next/link'
import { Fragment } from 'react'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm'
import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  Mail,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  DetailHeader,
  EmptyState,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  UrlDrawer,
} from '@beaconhs/ui'
import {
  attachments,
  correctiveActions,
  people,
  ppeAnnualRecords,
  ppeInspectionAttachments,
  ppeInspectionCriteria,
  ppeInspections,
  ppeIssueReports,
  ppeIssues,
  ppeItems,
  ppeTypes,
} from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import { attachmentUrl } from '@/lib/attachment-url'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { LiveField, LiveRemoteSelect, LiveSelect } from '@/components/live-field'
import { RemoteSelectField } from '@/components/remote-search-select'
import { CustomFieldsSection } from '@/components/custom-fields/custom-fields-section'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { materializePpeTypeEvidence } from '@/lib/compliance-type-evidence'
import { CertificateDrawer, type CertificateInput } from './_certificate-drawer'
import { PpeInspectionForm } from './_inspection-form'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { DetailGrid } from '@/components/detail-grid'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { Section } from '@/components/section'
import { TableToolbar } from '@/components/table-toolbar'
import { DetailPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { GenericSendEmailDialog } from '@/components/send-email-dialog'
import { RawImage } from '@/components/raw-image'
import { sendPpeIssueEmail } from './_send-email'
import {
  daysUntil,
  deriveAnnualYear,
  loadInspectionCriteriaForType,
  recordPpeIssueAction,
  shouldSpawnCorrectiveAction,
  createCorrectiveActionForFailedPpeInspection,
} from '../_lib'

export const dynamic = 'force-dynamic'

const PPE_TABS = ['overview', 'inspections', 'annual', 'issues', 'history'] as const
type PpeTab = (typeof PPE_TABS)[number]
const LIST_SORTS = ['date'] as const
const INSPECTION_FILTERS = [
  { value: 'in_progress', label: 'In progress' },
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'n_a', label: 'N/A' },
] as const
const CERTIFICATE_RESULTS = [
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'remediated', label: 'Remediated' },
] as const
const ISSUE_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'replaced', label: 'Replaced' },
] as const
const HISTORY_ACTIONS = [
  { value: 'issue', label: 'Issued' },
  { value: 'return', label: 'Returned' },
  { value: 'replace', label: 'Replaced' },
  { value: 'mark_damaged', label: 'Damaged' },
  { value: 'discard', label: 'Discarded' },
] as const

const PPE_LIST_KEYS = {
  overview: {
    q: 'overviewQ',
    sort: 'overviewSort',
    dir: 'overviewDir',
    page: 'overviewPage',
    perPage: 'overviewPerPage',
    filter: 'overviewFilter',
  },
  inspections: {
    q: 'inspectionQ',
    sort: 'inspectionSort',
    dir: 'inspectionDir',
    page: 'inspectionPage',
    perPage: 'inspectionPerPage',
    filter: 'inspectionResult',
  },
  annual: {
    q: 'certificateQ',
    sort: 'certificateSort',
    dir: 'certificateDir',
    page: 'certificatePage',
    perPage: 'certificatePerPage',
    filter: 'certificateResult',
  },
  issues: {
    q: 'issueQ',
    sort: 'issueSort',
    dir: 'issueDir',
    page: 'issuePage',
    perPage: 'issuePerPage',
    filter: 'issueStatus',
  },
  history: {
    q: 'historyQ',
    sort: 'historySort',
    dir: 'historyDir',
    page: 'historyPage',
    perPage: 'historyPerPage',
    filter: 'historyAction',
  },
} as const

// --- Server actions -----------------------------------------------------

// Inline auto-save for the unified edit/view Overview. Mirrors the incidents
// `updateTextField` whitelist pattern: only user-owned identity fields are
// editable here — lifecycle (status/holder) and derived schedule dates stay
// read-only and are maintained by the issuance / inspection actions.
async function updatePpeField(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  if (!can(ctx, 'ppe.manage')) throw new Error('You do not have permission to manage PPE')
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const raw = formData.get('value')
  const value = typeof raw === 'string' ? raw : ''
  if (!id || !field) throw new Error('Missing id/field')

  const TEXT = new Set(['serialNumber', 'size', 'notes'])
  const DATE_ONLY = new Set(['purchaseDate', 'expiresOn'])
  const FK_REQUIRED = new Set(['typeId'])
  if (!TEXT.has(field) && !DATE_ONLY.has(field) && !FK_REQUIRED.has(field)) {
    throw new Error('Field not allowed')
  }

  let val: string | null
  if (DATE_ONLY.has(field)) {
    val = value || null
  } else if (FK_REQUIRED.has(field)) {
    if (!value) throw new Error('This field is required')
    val = value
  } else {
    const trimmed = value.trim()
    val = trimmed === '' ? null : value
  }

  await ctx.db(async (tx) => {
    const [prior] = await tx
      .select({ typeId: ppeItems.typeId })
      .from(ppeItems)
      .where(and(eq(ppeItems.id, id), isNull(ppeItems.deletedAt)))
      .limit(1)
      .for('update')
    if (!prior) throw new Error('PPE item was not found')
    let values: Partial<typeof ppeItems.$inferInsert>
    switch (field) {
      case 'serialNumber':
        values = { serialNumber: val }
        break
      case 'size':
        values = { size: val }
        break
      case 'notes':
        values = { notes: val }
        break
      case 'purchaseDate':
        values = { purchaseDate: val }
        break
      case 'expiresOn':
        values = { expiresOn: val }
        break
      case 'typeId':
        if (!val) throw new Error('Type is required')
        values = { typeId: val }
        break
      default:
        throw new Error('Field not allowed')
    }
    const [updated] = await tx
      .update(ppeItems)
      .set(values)
      .where(and(eq(ppeItems.id, id), isNull(ppeItems.deletedAt)))
      .returning({ id: ppeItems.id })
    if (!updated) throw new Error('PPE item was not updated')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'ppe_item',
      entityId: id,
      action: 'update',
      summary: `Updated ${field}`,
      after: { [field]: val },
    })
    if (field === 'expiresOn' || field === 'typeId') {
      await materializePpeTypeEvidence(tx, ctx.tenantId, [
        prior.typeId,
        field === 'typeId' ? val : prior.typeId,
      ])
    }
  })
  revalidatePath(`/ppe/${id}`)
  revalidatePath('/ppe')
}

async function recordInspection(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.inspect')
  const itemId = String(formData.get('itemId') ?? '')
  const typeId = String(formData.get('typeId') ?? '')
  const kindRaw = String(formData.get('kind') ?? 'pre_use')
  const kind: 'pre_use' | 'annual' = kindRaw === 'annual' ? 'annual' : 'pre_use'
  const notes = String(formData.get('notes') ?? '').trim() || null
  if (!isUuid(itemId) || !isUuid(typeId)) throw new Error('Invalid PPE item')
  if (notes && notes.length > 10_000) throw new Error('Inspection notes are too long')
  const today = new Date().toISOString().slice(0, 10)

  // Pull the criteria list so we can validate the per-row answers + compute
  // whether any fail is high+ severity (drives the auto-CA). The overall result
  // is DERIVED from the answers — there is no manual override.
  const criteria = await loadInspectionCriteriaForType(ctx, typeId, kind)
  if (criteria.length === 0) throw new Error('This PPE type has no criteria for that inspection')
  const escalatedFailures: {
    question: string
    reason: string
    severity: 'high' | 'critical'
  }[] = []
  let anyFail = false
  let anyApplicable = false
  const submissions: {
    criterion: (typeof criteria)[number]
    sequence: number
    answer: 'pass' | 'fail' | 'n_a'
    reason: string | null
    photoIds: string[]
  }[] = []
  for (const [sequence, c] of criteria.entries()) {
    const raw = String(formData.get(`criterion_${c.id}`) ?? '')
    // Every criterion must be answered (the client enforces this too).
    if (raw !== 'pass' && raw !== 'fail' && raw !== 'n_a') {
      throw new Error('Answer every criterion before recording the inspection')
    }
    const answer = raw as 'pass' | 'fail' | 'n_a'
    const reason = String(formData.get(`criterion_reason_${c.id}`) ?? '').trim()
    if (reason.length > 10_000) throw new Error('A criterion failure description is too long')
    if (answer === 'fail' && !reason) {
      throw new Error(`Describe what failed for “${c.question}”`)
    }
    const photoIds = Array.from(
      new Set(
        String(formData.get(`criterion_photos_${c.id}`) ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    )
    if (photoIds.some((id) => !isUuid(id))) throw new Error('Invalid inspection photo')
    if (photoIds.length > 10) throw new Error('Attach no more than 10 photos to each criterion')
    if (c.requiresPhoto && answer !== 'n_a' && photoIds.length === 0) {
      throw new Error(`Attach photo evidence for “${c.question}”`)
    }
    if (answer !== 'n_a') anyApplicable = true
    if (answer === 'fail') {
      anyFail = true
      if (shouldSpawnCorrectiveAction(answer, c.severity)) {
        escalatedFailures.push({
          question: c.question,
          reason,
          severity: c.severity as 'high' | 'critical',
        })
      }
    }
    submissions.push({
      criterion: c,
      sequence,
      answer,
      reason: answer === 'fail' ? reason : null,
      photoIds,
    })
  }
  const allPhotoIds = submissions.flatMap((submission) => submission.photoIds)
  if (new Set(allPhotoIds).size !== allPhotoIds.length) {
    throw new Error('Each inspection photo can be attached to only one criterion')
  }
  // Derived result: any failed criterion fails the inspection; an all-N/A
  // checklist remains N/A instead of being misreported as a pass.
  const finalResult: 'pass' | 'fail' | 'n_a' = anyFail ? 'fail' : anyApplicable ? 'pass' : 'n_a'
  const correctiveActionInput =
    escalatedFailures.length > 0
      ? (() => {
          const severity = escalatedFailures.some((failure) => failure.severity === 'critical')
            ? ('critical' as const)
            : ('high' as const)
          const primaryFailure =
            escalatedFailures.find((failure) => failure.severity === 'critical') ??
            escalatedFailures[0]!
          return {
            title:
              escalatedFailures.length === 1
                ? `PPE inspection finding: ${primaryFailure.question.slice(0, 80)}`
                : `PPE inspection findings: ${escalatedFailures.length} high-risk failures`,
            description: [
              `PPE item ${itemId} failed a ${kind === 'pre_use' ? 'pre-use' : 'annual'} inspection.`,
              `High-risk findings:\n${escalatedFailures
                .map(
                  (failure) =>
                    `- [${failure.severity.toUpperCase()}] ${failure.question}: ${failure.reason}`,
                )
                .join('\n')}`,
              notes ? `Inspector notes: ${notes}` : null,
            ]
              .filter(Boolean)
              .join('\n\n'),
            severity,
          }
        })()
      : null

  await ctx.db(async (tx) => {
    const [item] = await tx
      .select({
        typeId: ppeItems.typeId,
        status: ppeItems.status,
        deletedAt: ppeItems.deletedAt,
      })
      .from(ppeItems)
      .where(eq(ppeItems.id, itemId))
      .limit(1)
      .for('update')
    if (!item || item.typeId !== typeId) throw new Error('PPE item or type not found')
    if (item.deletedAt || item.status === 'discarded' || item.status === 'expired') {
      throw new Error('Discarded or expired PPE cannot be inspected')
    }

    if (allPhotoIds.length > 0) {
      const ownedPhotos = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(
          and(
            eq(attachments.tenantId, ctx.tenantId),
            eq(attachments.uploadedBy, ctx.userId),
            eq(attachments.kind, 'image'),
            inArray(attachments.id, allPhotoIds),
          ),
        )
      if (ownedPhotos.length !== allPhotoIds.length) {
        throw new Error('One or more inspection photos are unavailable')
      }
    }

    const [row] = await tx
      .insert(ppeInspections)
      .values({
        tenantId: ctx.tenantId,
        itemId,
        kind,
        status: 'submitted',
        result: finalResult,
        inspectedOn: today,
        nextDueOn: nextDueDate(kind, today),
        notes,
        inspectedByTenantUserId: ctx.membership?.id,
        inspectorNameSnapshot: ctx.membership?.displayName ?? null,
      })
      .returning({ id: ppeInspections.id })
    if (!row) throw new Error('Inspection could not be recorded')

    const responseRows = await tx
      .insert(ppeInspectionCriteria)
      .values(
        submissions.map((submission) => ({
          tenantId: ctx.tenantId,
          inspectionId: row.id,
          criterionId: submission.criterion.id,
          questionTextSnapshot: submission.criterion.question,
          descriptionSnapshot: submission.criterion.description,
          severity: submission.criterion.severity,
          requiresPhoto: submission.criterion.requiresPhoto,
          sequence: submission.sequence,
          answer: submission.answer,
          nonComplianceReason: submission.reason,
        })),
      )
      .returning({ id: ppeInspectionCriteria.id, criterionId: ppeInspectionCriteria.criterionId })
    if (responseRows.length !== submissions.length) {
      throw new Error('Inspection evidence could not be recorded')
    }
    const responseByCriterion = new Map(responseRows.map((entry) => [entry.criterionId, entry.id]))
    const photoLinks = submissions.flatMap((submission) => {
      const criterionResultId = responseByCriterion.get(submission.criterion.id)
      if (!criterionResultId && submission.photoIds.length > 0) {
        throw new Error('Inspection photo evidence could not be linked')
      }
      return submission.photoIds.map((attachmentId) => ({
        tenantId: ctx.tenantId,
        criterionResultId: criterionResultId!,
        attachmentId,
      }))
    })
    if (photoLinks.length > 0) await tx.insert(ppeInspectionAttachments).values(photoLinks)

    const set =
      kind === 'pre_use'
        ? { lastInspectionOn: today, nextInspectionDue: nextDueDate(kind, today) }
        : { lastAnnualInspectionOn: today, nextAnnualInspectionDue: nextDueDate(kind, today) }
    await tx.update(ppeItems).set(set).where(eq(ppeItems.id, itemId))
    const correctiveActionId = correctiveActionInput
      ? await createCorrectiveActionForFailedPpeInspection(tx, ctx, {
          inspectionId: row.id,
          itemId,
          ...correctiveActionInput,
        })
      : null
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: row.id,
      moduleKey: 'ppe',
      event: 'on_submit',
      occurrenceKey: row.id,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'ppe_inspection',
      entityId: row.id,
      action: 'create',
      summary: `Recorded ${kind === 'pre_use' ? 'pre-use' : 'annual'} inspection — ${finalResult}`,
      after: {
        itemId,
        kind,
        result: finalResult,
        criteriaCount: submissions.length,
        failedCriteriaCount: submissions.filter((submission) => submission.answer === 'fail')
          .length,
        photoCount: allPhotoIds.length,
        correctiveActionId,
      },
    })
    await materializePpeTypeEvidence(tx, ctx.tenantId, [item.typeId])
    return row.id
  })

  revalidatePath(`/ppe/${itemId}`)
  redirect(`/ppe/${itemId}?tab=inspections`)
}

async function setStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const itemId = String(formData.get('itemId') ?? '')
  const STATUS_VALUES = [
    'in_stock',
    'issued',
    'returned',
    'damaged',
    'discarded',
    'expired',
  ] as const
  const statusRaw = String(formData.get('status') ?? '')
  if (!(STATUS_VALUES as readonly string[]).includes(statusRaw)) {
    throw new Error('Unknown PPE status')
  }
  const status = statusRaw as (typeof STATUS_VALUES)[number]
  const personId = String(formData.get('personId') ?? '').trim() || null
  const note = String(formData.get('note') ?? '').trim() || null

  // Permission split mirrors the transition: issuing needs issue, returning needs
  // return, everything else (damage/discard/in-stock/expire) is a manage write.
  if (status === 'issued') assertCan(ctx, 'ppe.issue')
  else if (status === 'returned') assertCan(ctx, 'ppe.return')
  else assertCan(ctx, 'ppe.manage')

  if (status === 'issued') {
    if (!personId) return
    await recordPpeIssueAction(ctx, { itemId, personId, action: 'issue', note })
  } else if (status === 'returned') {
    await recordPpeIssueAction(ctx, { itemId, personId: null, action: 'return', note })
  } else if (status === 'damaged') {
    await recordPpeIssueAction(ctx, { itemId, personId: null, action: 'mark_damaged', note })
  } else if (status === 'discarded') {
    await recordPpeIssueAction(ctx, { itemId, personId: null, action: 'discard', note })
  } else {
    // 'in_stock' / 'expired' — no ledger row, just flip the flag.
    await ctx.db(async (tx) => {
      const [item] = await tx
        .select({ typeId: ppeItems.typeId })
        .from(ppeItems)
        .where(and(eq(ppeItems.id, itemId), isNull(ppeItems.deletedAt)))
        .limit(1)
        .for('update')
      if (!item) throw new Error('PPE item was not found')
      const [updated] = await tx
        .update(ppeItems)
        .set({ status, ...(status === 'in_stock' ? { currentHolderPersonId: null } : {}) })
        .where(and(eq(ppeItems.id, itemId), isNull(ppeItems.deletedAt)))
        .returning({ id: ppeItems.id })
      if (!updated) throw new Error('PPE status was not updated')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'ppe_item',
        entityId: itemId,
        action: 'update',
        summary: `Set PPE status → ${status}`,
        after: { status },
      })
      await materializePpeTypeEvidence(tx, ctx.tenantId, [item.typeId])
    })
  }
  revalidatePath(`/ppe/${itemId}`)
  revalidatePath('/ppe')
  redirect(`/ppe/${itemId}?tab=overview`)
}

async function reportIssue(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.inspect')
  const itemId = String(formData.get('itemId') ?? '')
  const description = String(formData.get('description') ?? '').trim()
  if (!description) return
  const reportId = await ctx.db(async (tx) => {
    const [r] = await tx
      .insert(ppeIssueReports)
      .values({
        tenantId: ctx.tenantId,
        itemId,
        description,
        status: 'open',
        reportedByTenantUserId: ctx.membership?.id,
        reportedByNameSnapshot: ctx.membership?.displayName ?? null,
        source: 'manual',
      })
      .returning({ id: ppeIssueReports.id })
    return r?.id ?? null
  })
  await recordAudit(ctx, {
    entityType: 'ppe_issue_report',
    entityId: reportId ?? undefined,
    action: 'create',
    summary: 'Reported PPE defect',
    after: { itemId, description },
  })
  revalidatePath(`/ppe/${itemId}`)
  redirect(`/ppe/${itemId}?tab=issues`)
}

async function resolveIssue(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.manage')
  const id = String(formData.get('id') ?? '').trim()
  const itemId = String(formData.get('itemId') ?? '').trim()
  const resolution = String(formData.get('resolution') ?? '').trim() || null
  if (!id) return
  const updated = await ctx.db((tx) =>
    tx
      .update(ppeIssueReports)
      .set({ status: 'resolved', resolution, resolvedAt: new Date() })
      .where(and(eq(ppeIssueReports.id, id), eq(ppeIssueReports.itemId, itemId)))
      .returning({ id: ppeIssueReports.id }),
  )
  if (updated.length !== 1) throw new Error('PPE defect report not found for this item')
  await recordAudit(ctx, {
    entityType: 'ppe_issue_report',
    entityId: id,
    action: 'update',
    summary: 'Resolved PPE defect report',
    after: { resolution },
  })
  revalidatePath(`/ppe/${itemId}`)
}

// Save a third-party recertification certificate. Object-arg (not FormData) so
// the client drawer can upload the file first, then hand us the attachment id.
// Returns {ok} so the drawer can surface validation/permission errors inline.
async function addCertificate(
  input: CertificateInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  const ctx = await requireRequestContext()
  if (!can(ctx, 'ppe.manage')) {
    return { ok: false, error: 'You do not have permission to manage PPE.' }
  }
  const itemId = input.itemId.trim()
  const inspectedOn = input.inspectedOn.trim()
  if (!itemId || !inspectedOn) return { ok: false, error: 'Inspection date is required.' }
  const result: 'pass' | 'fail' | 'remediated' = ['pass', 'fail', 'remediated'].includes(
    input.result,
  )
    ? input.result
    : 'pass'
  const year = deriveAnnualYear(inspectedOn)
  const nextDueOn = (() => {
    const d = new Date(inspectedOn)
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  })()
  let id: string | null = null
  try {
    id = await ctx.db(async (tx) => {
      const [item] = await tx
        .select({ typeId: ppeItems.typeId })
        .from(ppeItems)
        .where(and(eq(ppeItems.id, itemId), isNull(ppeItems.deletedAt)))
        .limit(1)
        .for('update')
      if (!item) throw new Error('PPE item was not found')
      const [row] = await tx
        .insert(ppeAnnualRecords)
        .values({
          tenantId: ctx.tenantId,
          itemId,
          year,
          inspectedOn,
          nextDueOn,
          inspectedByPersonId: input.inspectedByPersonId,
          inspectorName: input.inspectorName,
          inspectorCompany: input.inspectorCompany,
          certificateAttachmentId: input.certificateAttachmentId,
          result,
          notes: input.notes,
        })
        .returning({ id: ppeAnnualRecords.id })
      // Cache the new annual dates on the item for the reports.
      await tx
        .update(ppeItems)
        .set({ lastAnnualInspectionOn: inspectedOn, nextAnnualInspectionDue: nextDueOn })
        .where(eq(ppeItems.id, itemId))
      if (!row) throw new Error('Certificate could not be recorded')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'ppe_annual_record',
        entityId: row.id,
        action: 'create',
        summary: `Certificate recorded — ${result}`,
        after: {
          itemId,
          year,
          inspectedOn,
          result,
          certificateAttachmentId: input.certificateAttachmentId,
        },
      })
      await materializePpeTypeEvidence(tx, ctx.tenantId, [item.typeId])
      return row?.id ?? null
    })
  } catch (e) {
    // Only the (itemId, year) unique constraint means "duplicate year" — report
    // everything else truthfully instead of masking real failures.
    if ((e as { code?: string })?.code === '23505') {
      return { ok: false, error: `A certificate for ${year} already exists on this item.` }
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to save the certificate.',
    }
  }
  revalidatePath(`/ppe/${itemId}`)
  return { ok: true }
}

async function deleteCertificate(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  if (!can(ctx, 'ppe.manage')) throw new Error('You do not have permission to manage PPE')
  const recordId = String(formData.get('id') ?? '').trim()
  const itemId = String(formData.get('itemId') ?? '').trim()
  if (!recordId || !itemId) return
  await ctx.db(async (tx) => {
    const [item] = await tx
      .select({ typeId: ppeItems.typeId })
      .from(ppeItems)
      .where(and(eq(ppeItems.id, itemId), isNull(ppeItems.deletedAt)))
      .limit(1)
      .for('update')
    if (!item) throw new Error('PPE item was not found')
    const [deleted] = await tx
      .delete(ppeAnnualRecords)
      .where(and(eq(ppeAnnualRecords.id, recordId), eq(ppeAnnualRecords.itemId, itemId)))
      .returning({ id: ppeAnnualRecords.id })
    if (!deleted) throw new Error('Certificate was not found for this PPE item')
    // Recompute the cached annual dates from whatever certificate history
    // remains, so overdue alerts never run on a deleted record's dates.
    const [latest] = await tx
      .select({
        inspectedOn: ppeAnnualRecords.inspectedOn,
        nextDueOn: ppeAnnualRecords.nextDueOn,
      })
      .from(ppeAnnualRecords)
      .where(eq(ppeAnnualRecords.itemId, itemId))
      .orderBy(desc(ppeAnnualRecords.inspectedOn))
      .limit(1)
    await tx
      .update(ppeItems)
      .set({
        lastAnnualInspectionOn: latest?.inspectedOn ?? null,
        nextAnnualInspectionDue: latest?.nextDueOn ?? null,
      })
      .where(eq(ppeItems.id, itemId))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'ppe_annual_record',
      entityId: recordId,
      action: 'delete',
      summary: 'Deleted certificate',
      before: { itemId },
    })
    await materializePpeTypeEvidence(tx, ctx.tenantId, [item.typeId])
  })
  revalidatePath(`/ppe/${itemId}`)
}

// Inline server action for the Send-email dialog. Allows shipping an
// open issue report (or the item summary when no issue is open) to a
// maintenance distribution list or any explicit recipients.
async function sendEmailAction(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ppe.read.all')
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
  await sendPpeIssueEmail(ctx, id, {
    recipients: recipients.length > 0 ? recipients : undefined,
    cc: cc.length > 0 ? cc : undefined,
    subjectPrefix,
    messageOverride,
  })
  revalidatePath(`/ppe/${id}`)
}

function nextDueDate(kind: 'pre_use' | 'annual', iso: string): string {
  const d = new Date(iso)
  if (kind === 'annual') d.setFullYear(d.getFullYear() + 1)
  else d.setDate(d.getDate() + 30)
  return d.toISOString().slice(0, 10)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_07616ae47dfc69', { value0: id.slice(0, 8) }) }
}

export default async function PpeDetailPage({
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
  const ctx = await requireRequestContext()
  const canManage = can(ctx, 'ppe.manage')
  const canIssue = can(ctx, 'ppe.issue')
  const canChangeStatus = can(ctx, 'ppe.return') || canManage
  const drawerKey = pickString(sp.drawer)

  const baseData = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ item: ppeItems, type: ppeTypes, holder: people })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(eq(ppeItems.id, id))
      .limit(1)
    if (!row) return null

    return row
  })

  if (!baseData) notFound()
  const { item, type, holder } = baseData
  const [preUseCriteria, annualCriteria, countData] = await Promise.all([
    loadInspectionCriteriaForType(ctx, type.id, 'pre_use'),
    loadInspectionCriteriaForType(ctx, type.id, 'annual'),
    ctx.db(async (tx) => {
      const [[inspectionRow], [annualRow], [issueRow], [historyRow], [openRow], openIssues] =
        await Promise.all([
          tx.select({ c: count() }).from(ppeInspections).where(eq(ppeInspections.itemId, id)),
          tx.select({ c: count() }).from(ppeAnnualRecords).where(eq(ppeAnnualRecords.itemId, id)),
          tx.select({ c: count() }).from(ppeIssueReports).where(eq(ppeIssueReports.itemId, id)),
          tx.select({ c: count() }).from(ppeIssues).where(eq(ppeIssues.itemId, id)),
          tx
            .select({ c: count() })
            .from(ppeIssueReports)
            .where(and(eq(ppeIssueReports.itemId, id), eq(ppeIssueReports.status, 'open'))),
          tx
            .select()
            .from(ppeIssueReports)
            .where(and(eq(ppeIssueReports.itemId, id), eq(ppeIssueReports.status, 'open')))
            .orderBy(desc(ppeIssueReports.reportedAt))
            .limit(1),
        ])
      return {
        inspections: Number(inspectionRow?.c ?? 0),
        annual: Number(annualRow?.c ?? 0),
        issues: Number(issueRow?.c ?? 0),
        history: Number(historyRow?.c ?? 0),
        openIssueCount: Number(openRow?.c ?? 0),
        openIssues,
      }
    }),
  ])
  const expiringIn = daysUntil(item.expiresOn)
  const inspectionDueIn = daysUntil(item.nextInspectionDue)
  const annualDueIn = daysUntil(item.nextAnnualInspectionDue)
  // The inspection flyout is opened per-kind from the Pre-use / Annual buttons,
  // so render only the criteria for the launched kind (they are separate
  // inspection types and must not be mixed in one form).
  const inspectionKind: 'pre_use' | 'annual' =
    pickString(sp.kind) === 'annual' ? 'annual' : 'pre_use'
  const inspectionCriteria = inspectionKind === 'annual' ? annualCriteria : preUseCriteria

  // Tab visibility is driven by the PPE type's configuration:
  //   • Inspections — shown only when the type has a pre-use and/or annual
  //     checklist (the criteria themselves are the "requires inspection" signal).
  //   • Certificates — shown when the type is flagged as requiring third-party
  //     recertification (configurable on the type), or it already has records.
  const hasPreUse = preUseCriteria.length > 0
  const hasAnnual = annualCriteria.length > 0
  const hasInspections = hasPreUse || hasAnnual
  const requiresCertificate = type.inspectionSchedule?.requiresCertificate ?? false
  const showCertificates = requiresCertificate || countData.annual > 0

  const visibleTabs: PpeTab[] = [
    'overview',
    ...(hasInspections ? (['inspections'] as const) : []),
    ...(showCertificates ? (['annual'] as const) : []),
    'issues',
    'history',
  ]
  // Fall back to Overview when a now-hidden tab is requested via the URL.
  const active: PpeTab = pickActiveTab(sp, visibleTabs, 'overview')
  const listKeys = PPE_LIST_KEYS[active]
  const listParams = parseListParams(
    {
      q: sp[listKeys.q],
      sort: sp[listKeys.sort],
      dir: sp[listKeys.dir],
      page: sp[listKeys.page],
      perPage: sp[listKeys.perPage],
    },
    {
      sort: 'date',
      dir: 'desc',
      perPage: 25,
      allowedSorts: LIST_SORTS,
    },
  )
  const requestedFilter = pickString(sp[listKeys.filter])
  const inspectionFilter = INSPECTION_FILTERS.find(
    (option) => option.value === requestedFilter,
  )?.value
  const certificateResult = CERTIFICATE_RESULTS.find(
    (option) => option.value === requestedFilter,
  )?.value
  const issueStatus = ISSUE_STATUSES.find((option) => option.value === requestedFilter)?.value
  const historyAction = HISTORY_ACTIONS.find((option) => option.value === requestedFilter)?.value

  const listData = await ctx.db(async (tx) => {
    if (active === 'inspections') {
      const base = eq(ppeInspections.itemId, id)
      const searchPattern = listParams.q ? `%${listParams.q}%` : null
      const search = listParams.q
        ? or(
            ilike(ppeInspections.notes, searchPattern!),
            ilike(ppeInspections.inspectorNameSnapshot, searchPattern!),
            sql`${ppeInspections.kind}::text ilike ${searchPattern}`,
            sql`exists (
              select 1
              from "ppe_inspection_criteria" evidence
              where evidence."tenant_id" = ${ctx.tenantId}::uuid
                and evidence."inspection_id" = ${ppeInspections.id}
                and (
                  evidence."question_text_snapshot" ilike ${searchPattern}
                  or evidence."description_snapshot" ilike ${searchPattern}
                  or evidence."non_compliance_reason" ilike ${searchPattern}
                )
            )`,
          )
        : undefined
      const where = and(
        base,
        search,
        inspectionFilter === 'in_progress'
          ? eq(ppeInspections.status, 'in_progress')
          : inspectionFilter
            ? and(
                eq(ppeInspections.status, 'submitted'),
                eq(ppeInspections.result, inspectionFilter),
              )
            : undefined,
      )
      const [[filteredRow], inspections] = await Promise.all([
        tx.select({ c: count() }).from(ppeInspections).where(where),
        tx
          .select({ insp: ppeInspections })
          .from(ppeInspections)
          .where(where)
          .orderBy(desc(ppeInspections.inspectedOn), desc(ppeInspections.id))
          .limit(listParams.perPage)
          .offset((listParams.page - 1) * listParams.perPage),
      ])
      const inspectionIds = inspections.map(({ insp }) => insp.id)
      const itemCAs =
        inspectionIds.length > 0
          ? await tx
              .select()
              .from(correctiveActions)
              .where(
                and(
                  eq(correctiveActions.sourceEntityType, 'ppe_inspection'),
                  inArray(correctiveActions.sourceEntityId, inspectionIds),
                ),
              )
          : []
      return {
        inspections,
        annualRecords: [],
        issueReports: [],
        issuesLog: [],
        itemCAs,
        filteredTotal: Number(filteredRow?.c ?? 0),
      }
    }
    if (active === 'annual') {
      const base = eq(ppeAnnualRecords.itemId, id)
      const search = listParams.q
        ? or(
            ilike(ppeAnnualRecords.inspectorName, `%${listParams.q}%`),
            ilike(ppeAnnualRecords.inspectorCompany, `%${listParams.q}%`),
            ilike(ppeAnnualRecords.notes, `%${listParams.q}%`),
            ilike(people.firstName, `%${listParams.q}%`),
            ilike(people.lastName, `%${listParams.q}%`),
            ilike(attachments.filename, `%${listParams.q}%`),
          )
        : undefined
      const where = and(
        base,
        search,
        certificateResult ? eq(ppeAnnualRecords.result, certificateResult) : undefined,
      )
      const [[filteredRow], annualRecords] = await Promise.all([
        tx
          .select({ c: count() })
          .from(ppeAnnualRecords)
          .leftJoin(people, eq(people.id, ppeAnnualRecords.inspectedByPersonId))
          .leftJoin(attachments, eq(attachments.id, ppeAnnualRecords.certificateAttachmentId))
          .where(where),
        tx
          .select({ rec: ppeAnnualRecords, person: people, cert: attachments })
          .from(ppeAnnualRecords)
          .leftJoin(people, eq(people.id, ppeAnnualRecords.inspectedByPersonId))
          .leftJoin(attachments, eq(attachments.id, ppeAnnualRecords.certificateAttachmentId))
          .where(where)
          .orderBy(desc(ppeAnnualRecords.inspectedOn), desc(ppeAnnualRecords.id))
          .limit(listParams.perPage)
          .offset((listParams.page - 1) * listParams.perPage),
      ])
      return {
        inspections: [],
        annualRecords,
        issueReports: [],
        issuesLog: [],
        itemCAs: [],
        filteredTotal: Number(filteredRow?.c ?? 0),
      }
    }
    if (active === 'issues') {
      const base = eq(ppeIssueReports.itemId, id)
      const search = listParams.q
        ? or(
            ilike(ppeIssueReports.description, `%${listParams.q}%`),
            ilike(ppeIssueReports.resolution, `%${listParams.q}%`),
            ilike(ppeIssueReports.source, `%${listParams.q}%`),
            ilike(ppeIssueReports.reportedByNameSnapshot, `%${listParams.q}%`),
          )
        : undefined
      const where = and(
        base,
        search,
        issueStatus ? eq(ppeIssueReports.status, issueStatus) : undefined,
      )
      const [[filteredRow], issueReports] = await Promise.all([
        tx.select({ c: count() }).from(ppeIssueReports).where(where),
        tx
          .select()
          .from(ppeIssueReports)
          .where(where)
          .orderBy(desc(ppeIssueReports.reportedAt), desc(ppeIssueReports.id))
          .limit(listParams.perPage)
          .offset((listParams.page - 1) * listParams.perPage),
      ])
      return {
        inspections: [],
        annualRecords: [],
        issueReports,
        issuesLog: [],
        itemCAs: [],
        filteredTotal: Number(filteredRow?.c ?? 0),
      }
    }
    if (active === 'history') {
      const base = eq(ppeIssues.itemId, id)
      const search = listParams.q
        ? or(
            ilike(ppeIssues.note, `%${listParams.q}%`),
            ilike(people.firstName, `%${listParams.q}%`),
            ilike(people.lastName, `%${listParams.q}%`),
          )
        : undefined
      const where = and(
        base,
        search,
        historyAction ? eq(ppeIssues.action, historyAction) : undefined,
      )
      const [[filteredRow], issuesLog] = await Promise.all([
        tx
          .select({ c: count() })
          .from(ppeIssues)
          .leftJoin(people, eq(people.id, ppeIssues.personId))
          .where(where),
        tx
          .select({ issue: ppeIssues, person: people })
          .from(ppeIssues)
          .leftJoin(people, eq(people.id, ppeIssues.personId))
          .where(where)
          .orderBy(desc(ppeIssues.occurredAt), desc(ppeIssues.id))
          .limit(listParams.perPage)
          .offset((listParams.page - 1) * listParams.perPage),
      ])
      return {
        inspections: [],
        annualRecords: [],
        issueReports: [],
        issuesLog,
        itemCAs: [],
        filteredTotal: Number(filteredRow?.c ?? 0),
      }
    }
    return {
      inspections: [],
      annualRecords: [],
      issueReports: [],
      issuesLog: [],
      itemCAs: [],
      filteredTotal: 0,
    }
  })
  const { inspections, annualRecords, issueReports, issuesLog, itemCAs } = listData
  const inspectionEvidence =
    inspections.length > 0
      ? await ctx.db(async (tx) => {
          const inspectionIds = inspections.map(({ insp }) => insp.id)
          const [criteria, photoLinks] = await Promise.all([
            tx
              .select()
              .from(ppeInspectionCriteria)
              .where(inArray(ppeInspectionCriteria.inspectionId, inspectionIds))
              .orderBy(
                asc(ppeInspectionCriteria.inspectionId),
                asc(ppeInspectionCriteria.sequence),
              ),
            tx
              .select({ link: ppeInspectionAttachments, attachment: attachments })
              .from(ppeInspectionAttachments)
              .innerJoin(attachments, eq(attachments.id, ppeInspectionAttachments.attachmentId))
              .leftJoin(
                ppeInspectionCriteria,
                eq(ppeInspectionCriteria.id, ppeInspectionAttachments.criterionResultId),
              )
              .where(
                or(
                  inArray(ppeInspectionAttachments.inspectionId, inspectionIds),
                  inArray(ppeInspectionCriteria.inspectionId, inspectionIds),
                ),
              ),
          ])
          return { criteria, photoLinks }
        })
      : { criteria: [], photoLinks: [] }
  const openIssues = countData.openIssues

  const basePath = `/ppe/${id}`
  // Drawer state is URL-driven; preserve the active tab in the close URL so
  // that closing the drawer doesn't kick you back to Overview.
  const closeHref = `${basePath}?tab=${active}`
  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/ppe', label: 'Back to PPE' }}
          title={tGeneratedValue(`${type.name} · ${item.serialNumber ?? 'no serial'}`)}
          subtitle={tGenerated('m_0034478e1bddc9', {
            value0: item.size ?? '—',
            value1: type.category ?? '',
          })}
          badge={
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  item.status === 'issued'
                    ? 'success'
                    : item.status === 'in_stock'
                      ? 'secondary'
                      : 'warning'
                }
              >
                <GeneratedValue value={item.status.replace('_', ' ')} />
              </Badge>
              <GeneratedValue
                value={
                  countData.openIssueCount > 0 ? (
                    <Badge variant="destructive">
                      <GeneratedValue value={countData.openIssueCount} />{' '}
                      <GeneratedText id="m_0d9877d90b6b7d" />
                      <GeneratedValue
                        value={
                          countData.openIssueCount === 1 ? (
                            ''
                          ) : (
                            <GeneratedText id="m_00ded356f0f424" />
                          )
                        }
                      />
                    </Badge>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  expiringIn !== null && expiringIn <= 30 ? (
                    <Badge variant={expiringIn < 0 ? 'destructive' : 'warning'}>
                      <GeneratedValue
                        value={
                          expiringIn < 0 ? (
                            <GeneratedText id="m_0c3eb67742e100" values={{ value0: -expiringIn }} />
                          ) : (
                            <GeneratedText id="m_051db224696a7d" values={{ value0: expiringIn }} />
                          )
                        }
                      />
                    </Badge>
                  ) : null
                }
              />
            </div>
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <GeneratedValue
                value={
                  canIssue ? (
                    <Link
                      href={`${basePath}?tab=${active}&drawer=issue-to-person` as any}
                      scroll={false}
                    >
                      <Button>
                        <UserPlus size={14} /> <GeneratedText id="m_10b50a35e0953a" />
                      </Button>
                    </Link>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  canChangeStatus ? (
                    <Link
                      href={`${basePath}?tab=${active}&drawer=change-status` as any}
                      scroll={false}
                    >
                      <Button variant="outline">
                        <RefreshCw size={14} /> <GeneratedText id="m_118818fef81797" />
                      </Button>
                    </Link>
                  ) : null
                }
              />
              <Link
                href={`/ppe/${id}?send=1${active !== 'overview' ? `&tab=${active}` : ''}` as any}
                scroll={false}
              >
                <Button variant="outline">
                  <Mail size={14} /> <GeneratedText id="m_09dfca28fc95ba" />
                </Button>
              </Link>
            </div>
          }
        />
      }
      alerts={
        <>
          <GeneratedValue
            value={
              countData.openIssueCount > 0 && openIssues[0] ? (
                <Alert variant="destructive">
                  <AlertTitle>
                    <GeneratedText id="m_1a8f774c8d5487" />
                  </AlertTitle>
                  <AlertDescription>
                    <GeneratedValue value={openIssues[0]!.description} />
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
          <GeneratedValue
            value={
              hasInspections && inspectionDueIn !== null && inspectionDueIn <= 0 ? (
                <Alert variant="destructive">
                  <AlertTitle>
                    <GeneratedText id="m_0efcb286ead8a2" />
                  </AlertTitle>
                  <AlertDescription>
                    <GeneratedText id="m_02af2c143301ac" />{' '}
                    <GeneratedValue value={item.nextInspectionDue} />
                    <GeneratedText id="m_01a8c692b32591" />
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
          <GeneratedValue
            value={
              showCertificates && annualDueIn !== null && annualDueIn <= 0 ? (
                <Alert variant="destructive">
                  <AlertTitle>
                    <GeneratedText id="m_044bdd8da8ecba" />
                  </AlertTitle>
                  <AlertDescription>
                    <GeneratedText id="m_0134ca707501cc" />{' '}
                    <GeneratedValue value={item.nextAnnualInspectionDue} />.
                  </AlertDescription>
                </Alert>
              ) : null
            }
          />
        </>
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          variant="pills"
          tabs={[
            { key: 'overview', label: 'Overview' },
            ...(hasInspections
              ? [{ key: 'inspections', label: 'Inspections', count: countData.inspections }]
              : []),
            ...(showCertificates
              ? [{ key: 'annual', label: 'Certificates', count: countData.annual }]
              : []),
            { key: 'issues', label: 'Issues', count: countData.issues },
            { key: 'history', label: 'History', count: countData.history },
          ]}
        />
      }
    >
      <div className="space-y-5">
        <GeneratedValue
          value={
            active === 'overview' ? (
              <div className="space-y-5">
                <Section
                  title={tGenerated('m_1560d4e2a09d09')}
                  subtitle={tGeneratedValue(
                    canManage ? tGenerated('m_0b782112bd8e71') : tGenerated('m_195e5685c3ad6a'),
                  )}
                >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <LiveRemoteSelect
                      id={id}
                      field="typeId"
                      label={tGenerated('m_074ba2f160c506')}
                      initialValue={type.id}
                      initialOption={{ value: type.id, label: type.name }}
                      lookup="ppe-types"
                      allowEmpty={false}
                      disabled={!canManage}
                      updateAction={updatePpeField}
                    />
                    <LiveField
                      id={id}
                      field="serialNumber"
                      label={tGenerated('m_179218139b624a')}
                      initialValue={item.serialNumber}
                      placeholder={tGenerated('m_0ff1343b241439')}
                      disabled={!canManage}
                      updateAction={updatePpeField}
                    />
                    <GeneratedValue
                      value={
                        type.sizingScheme && type.sizingScheme.length > 0 ? (
                          // Types with a sizing scheme constrain the size to the
                          // configured list (keeping an out-of-scheme current value
                          // selectable so it isn't silently lost).
                          <LiveSelect
                            id={id}
                            field="size"
                            label={tGenerated('m_11ad4bbeced31b')}
                            initialValue={item.size}
                            options={[
                              ...(item.size && !type.sizingScheme.includes(item.size)
                                ? [{ value: item.size, label: item.size }]
                                : []),
                              ...type.sizingScheme.map((s) => ({ value: s, label: s })),
                            ]}
                            disabled={!canManage}
                            updateAction={updatePpeField}
                          />
                        ) : (
                          <LiveField
                            id={id}
                            field="size"
                            label={tGenerated('m_11ad4bbeced31b')}
                            initialValue={item.size}
                            placeholder={tGenerated('m_05a60ffb4da858')}
                            disabled={!canManage}
                            updateAction={updatePpeField}
                          />
                        )
                      }
                    />
                    <LiveField
                      id={id}
                      field="purchaseDate"
                      label={tGenerated('m_1d9c32b35390f6')}
                      type="date"
                      initialValue={item.purchaseDate}
                      disabled={!canManage}
                      updateAction={updatePpeField}
                    />
                    <LiveField
                      id={id}
                      field="expiresOn"
                      label={tGenerated('m_14f3858b0a9ad6')}
                      type="date"
                      initialValue={item.expiresOn}
                      disabled={!canManage}
                      updateAction={updatePpeField}
                    />
                  </div>
                  <div className="mt-4">
                    <LiveField
                      id={id}
                      field="notes"
                      label={tGenerated('m_0b8dadcb78cd08')}
                      multiline
                      rows={3}
                      initialValue={item.notes}
                      placeholder={tGenerated('m_154092dbe030f5')}
                      disabled={!canManage}
                      updateAction={updatePpeField}
                    />
                  </div>
                </Section>

                <Section
                  title={tGenerated('m_18f7cb1f3a30eb')}
                  subtitle={tGenerated('m_0f65a0db3c5387')}
                >
                  <DetailGrid
                    rows={[
                      {
                        label: 'Status',
                        value: (
                          <Badge
                            variant={
                              item.status === 'issued'
                                ? 'success'
                                : item.status === 'in_stock'
                                  ? 'secondary'
                                  : 'warning'
                            }
                          >
                            <GeneratedValue value={item.status.replace('_', ' ')} />
                          </Badge>
                        ),
                      },
                      {
                        label: 'Currently with',
                        value: holder ? (
                          <Link
                            href={`/people/${holder.id}`}
                            className="text-teal-700 hover:underline"
                          >
                            <GeneratedValue value={holder.firstName} />{' '}
                            <GeneratedValue value={holder.lastName} />
                          </Link>
                        ) : (
                          '—'
                        ),
                      },
                      {
                        label: 'Expires',
                        value: item.expiresOn ? (
                          <span
                            className={
                              expiringIn !== null && expiringIn < 0
                                ? 'text-red-700'
                                : expiringIn !== null && expiringIn <= 30
                                  ? 'text-amber-700'
                                  : ''
                            }
                          >
                            <GeneratedValue value={item.expiresOn} />
                            <GeneratedValue
                              value={
                                expiringIn !== null
                                  ? ` (${expiringIn < 0 ? `${-expiringIn}d overdue` : `${expiringIn}d`})`
                                  : ''
                              }
                            />
                          </span>
                        ) : (
                          '—'
                        ),
                      },
                      ...(hasInspections
                        ? [
                            { label: 'Last inspection', value: item.lastInspectionOn ?? '—' },
                            {
                              label: 'Next inspection due',
                              value: item.nextInspectionDue ? (
                                <span
                                  className={
                                    inspectionDueIn !== null && inspectionDueIn < 0
                                      ? 'text-red-700'
                                      : ''
                                  }
                                >
                                  <GeneratedValue value={item.nextInspectionDue} />
                                </span>
                              ) : (
                                '—'
                              ),
                            },
                          ]
                        : []),
                      ...(showCertificates
                        ? [
                            {
                              label: 'Last certificate',
                              value: item.lastAnnualInspectionOn ?? '—',
                            },
                            {
                              label: 'Next certificate due',
                              value: item.nextAnnualInspectionDue ? (
                                <span
                                  className={
                                    annualDueIn !== null && annualDueIn < 0 ? 'text-red-700' : ''
                                  }
                                >
                                  <GeneratedValue value={item.nextAnnualInspectionDue} />
                                </span>
                              ) : (
                                '—'
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                </Section>

                <CustomFieldsSection
                  ctx={ctx}
                  entityKind="ppe"
                  recordId={item.id}
                  subtypeId={item.typeId}
                  metadata={item.metadata}
                  locked={!canManage}
                />
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'inspections' ? (
              <>
                <Section
                  title={tGenerated('m_08c2969a69d2fe', { value0: countData.inspections })}
                  actions={
                    <div className="flex items-center gap-2">
                      <GeneratedValue
                        value={
                          hasPreUse ? (
                            <Link
                              href={
                                `${basePath}?tab=inspections&drawer=record-inspection&kind=pre_use` as any
                              }
                            >
                              <Button size="sm">
                                <ClipboardCheck size={14} /> <GeneratedText id="m_0169e159d93a5b" />
                              </Button>
                            </Link>
                          ) : null
                        }
                      />
                      <GeneratedValue
                        value={
                          hasAnnual ? (
                            <Link
                              href={
                                `${basePath}?tab=inspections&drawer=record-inspection&kind=annual` as any
                              }
                            >
                              <Button size="sm" variant={hasPreUse ? 'outline' : 'default'}>
                                <ShieldCheck size={14} /> <GeneratedText id="m_1a86ff2774c6a1" />
                              </Button>
                            </Link>
                          ) : null
                        }
                      />
                    </div>
                  }
                >
                  <TableToolbar className="mb-3">
                    <SearchInput
                      placeholder={tGenerated('m_0412484b36fdef')}
                      paramKey={listKeys.q}
                      pageParamKey={listKeys.page}
                    />
                    <FilterChips
                      basePath={basePath}
                      currentParams={sp}
                      paramKey={listKeys.filter}
                      pageParamKey={listKeys.page}
                      label={tGenerated('m_100e41041dbe51')}
                      options={[...INSPECTION_FILTERS]}
                    />
                  </TableToolbar>
                  <GeneratedValue
                    value={
                      inspections.length === 0 ? (
                        <EmptyState
                          icon={<ClipboardCheck size={24} />}
                          title={tGenerated('m_128fa3f1eca160')}
                          action={
                            <Link
                              href={
                                `${basePath}?tab=inspections&drawer=record-inspection&kind=${hasPreUse ? 'pre_use' : 'annual'}` as any
                              }
                            >
                              <Button size="sm" variant="outline">
                                <ClipboardCheck size={14} /> <GeneratedText id="m_04b73b25d3382c" />{' '}
                                <GeneratedValue
                                  value={
                                    hasPreUse ? (
                                      <GeneratedText id="m_1d73764ccc174e" />
                                    ) : (
                                      <GeneratedText id="m_13f2e02bbd7b16" />
                                    )
                                  }
                                />
                                <GeneratedValue value={' '} />
                                <GeneratedText id="m_1383222293f273" />
                              </Button>
                            </Link>
                          }
                        />
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>
                                <GeneratedText id="m_0285c38761c540" />
                              </TableHead>
                              <TableHead>
                                <GeneratedText id="m_1e578efe1574cd" />
                              </TableHead>
                              <TableHead>
                                <GeneratedText id="m_100e41041dbe51" />
                              </TableHead>
                              <TableHead>
                                <GeneratedText id="m_08412ea75fe5da" />
                              </TableHead>
                              <TableHead>
                                <GeneratedText id="m_11af411751990f" />
                              </TableHead>
                              <TableHead>
                                <GeneratedText id="m_0b8dadcb78cd08" />
                              </TableHead>
                              <TableHead>
                                <GeneratedText id="m_1dc5fc53bbcb19" />
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <GeneratedValue
                              value={inspections.map((row) => {
                                const ca = itemCAs.find((c) => c.sourceEntityId === row.insp.id)
                                const criteria = inspectionEvidence.criteria.filter(
                                  (criterion) => criterion.inspectionId === row.insp.id,
                                )
                                const recordPhotos = inspectionEvidence.photoLinks.filter(
                                  ({ link }) =>
                                    link.inspectionId === row.insp.id &&
                                    link.criterionResultId === null,
                                )
                                return (
                                  <Fragment key={row.insp.id}>
                                    <TableRow>
                                      <TableCell>
                                        <GeneratedValue value={row.insp.inspectedOn ?? '—'} />
                                      </TableCell>
                                      <TableCell>
                                        <GeneratedValue value={row.insp.kind.replace('_', ' ')} />
                                      </TableCell>
                                      <TableCell>
                                        <Badge
                                          variant={
                                            row.insp.result === 'pass'
                                              ? 'success'
                                              : row.insp.result === 'fail'
                                                ? 'destructive'
                                                : 'secondary'
                                          }
                                        >
                                          <GeneratedValue
                                            value={
                                              row.insp.status === 'in_progress' ? (
                                                <GeneratedText id="m_0860b601eae8f5" />
                                              ) : (
                                                (row.insp.result?.replace('_', ' ') ?? '—')
                                              )
                                            }
                                          />
                                        </Badge>
                                      </TableCell>
                                      <TableCell>
                                        <GeneratedValue
                                          value={row.insp.inspectorNameSnapshot ?? '—'}
                                        />
                                      </TableCell>
                                      <TableCell>
                                        <GeneratedValue value={row.insp.nextDueOn ?? '—'} />
                                      </TableCell>
                                      <TableCell className="text-slate-600">
                                        <GeneratedValue value={row.insp.notes ?? '—'} />
                                      </TableCell>
                                      <TableCell>
                                        <GeneratedValue
                                          value={
                                            ca ? (
                                              <Link
                                                href={`/corrective-actions/${ca.id}`}
                                                className="text-teal-700 hover:underline"
                                              >
                                                {ca.reference}
                                              </Link>
                                            ) : (
                                              '—'
                                            )
                                          }
                                        />
                                      </TableCell>
                                    </TableRow>
                                    <TableRow className="bg-slate-50/70 hover:bg-slate-50/70 dark:bg-slate-950/30 dark:hover:bg-slate-950/30">
                                      <TableCell colSpan={7} className="py-2">
                                        <details>
                                          <summary className="cursor-pointer text-sm font-medium text-teal-700 dark:text-teal-300">
                                            <GeneratedText id="m_11bbc82ecbc827" />
                                            <GeneratedValue value={criteria.length} />{' '}
                                            <GeneratedText id="m_089f2b1abdb347" />
                                            <GeneratedValue
                                              value={
                                                criteria.length === 1 ? (
                                                  ''
                                                ) : (
                                                  <GeneratedText id="m_00ded356f0f424" />
                                                )
                                              }
                                            />
                                            <GeneratedValue
                                              value={
                                                recordPhotos.length > 0 ? (
                                                  <GeneratedText
                                                    id="m_060016377c914d"
                                                    values={{
                                                      value0: recordPhotos.length,
                                                      value1: recordPhotos.length === 1 ? '' : 's',
                                                    }}
                                                  />
                                                ) : (
                                                  ''
                                                )
                                              }
                                            />
                                            )
                                          </summary>
                                          <div className="mt-3 space-y-2">
                                            <GeneratedValue
                                              value={
                                                criteria.length === 0 ? (
                                                  <p className="text-sm text-slate-500">
                                                    <GeneratedText id="m_0b4b0b10211872" />
                                                  </p>
                                                ) : (
                                                  <ol className="space-y-2">
                                                    {criteria.map((criterion) => {
                                                      const photos =
                                                        inspectionEvidence.photoLinks.filter(
                                                          ({ link }) =>
                                                            link.criterionResultId === criterion.id,
                                                        )
                                                      return (
                                                        <li
                                                          key={criterion.id}
                                                          className="rounded-md border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                                        >
                                                          <div className="flex flex-wrap items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                                                {criterion.sequence + 1}.{' '}
                                                                {criterion.questionTextSnapshot}
                                                              </p>
                                                              {criterion.descriptionSnapshot ? (
                                                                <p className="mt-1 text-xs text-slate-500">
                                                                  {criterion.descriptionSnapshot}
                                                                </p>
                                                              ) : null}
                                                            </div>
                                                            <div className="flex items-center gap-1.5">
                                                              <Badge variant="secondary">
                                                                {criterion.severity}
                                                              </Badge>
                                                              <Badge
                                                                variant={
                                                                  criterion.answer === 'pass'
                                                                    ? 'success'
                                                                    : criterion.answer === 'fail'
                                                                      ? 'destructive'
                                                                      : 'secondary'
                                                                }
                                                              >
                                                                {criterion.answer?.replace(
                                                                  '_',
                                                                  ' ',
                                                                ) ?? (
                                                                  <GeneratedText id="m_001b53ad38955a" />
                                                                )}
                                                              </Badge>
                                                            </div>
                                                          </div>
                                                          {criterion.nonComplianceReason ? (
                                                            <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                                                              {criterion.nonComplianceReason}
                                                            </p>
                                                          ) : null}
                                                          {photos.length > 0 ? (
                                                            <div className="mt-3 flex flex-wrap gap-2">
                                                              {photos.map(({ attachment }) => (
                                                                <a
                                                                  key={attachment.id}
                                                                  href={attachmentUrl(
                                                                    attachment.id,
                                                                  )}
                                                                  target="_blank"
                                                                  rel="noreferrer"
                                                                  title={attachment.filename}
                                                                  className="block h-16 w-16 overflow-hidden rounded border border-slate-200 dark:border-slate-700"
                                                                >
                                                                  <RawImage
                                                                    src={attachmentUrl(
                                                                      attachment.id,
                                                                    )}
                                                                    alt={attachment.filename}
                                                                    optimizationReason="authenticated"
                                                                    className="h-full w-full object-cover"
                                                                  />
                                                                </a>
                                                              ))}
                                                            </div>
                                                          ) : null}
                                                        </li>
                                                      )
                                                    })}
                                                  </ol>
                                                )
                                              }
                                            />
                                            <GeneratedValue
                                              value={
                                                recordPhotos.length > 0 ? (
                                                  <div>
                                                    <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                                                      <GeneratedText id="m_020f32bc59d098" />
                                                    </p>
                                                    <div className="flex flex-wrap gap-2">
                                                      {recordPhotos.map(({ attachment }) => (
                                                        <a
                                                          key={attachment.id}
                                                          href={attachmentUrl(attachment.id)}
                                                          target="_blank"
                                                          rel="noreferrer"
                                                          title={attachment.filename}
                                                          className="block h-16 w-16 overflow-hidden rounded border border-slate-200 dark:border-slate-700"
                                                        >
                                                          <RawImage
                                                            src={attachmentUrl(attachment.id)}
                                                            alt={attachment.filename}
                                                            optimizationReason="authenticated"
                                                            className="h-full w-full object-cover"
                                                          />
                                                        </a>
                                                      ))}
                                                    </div>
                                                  </div>
                                                ) : null
                                              }
                                            />
                                          </div>
                                        </details>
                                      </TableCell>
                                    </TableRow>
                                  </Fragment>
                                )
                              })}
                            />
                          </TableBody>
                        </Table>
                      )
                    }
                  />
                  <Pagination
                    basePath={basePath}
                    currentParams={sp}
                    total={listData.filteredTotal}
                    page={listParams.page}
                    perPage={listParams.perPage}
                    pageParamKey={listKeys.page}
                  />
                </Section>
              </>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'annual' ? (
              <Section
                title={tGenerated('m_1fd262203ece8f', { value0: countData.annual })}
                subtitle={tGenerated('m_11c4501096f50d')}
                actions={
                  canManage ? (
                    <Link href={`${basePath}?tab=annual&drawer=add-certificate` as any}>
                      <Button size="sm">
                        <Plus size={14} /> <GeneratedText id="m_101f8f6eb72ed9" />
                      </Button>
                    </Link>
                  ) : null
                }
              >
                <TableToolbar className="mb-3">
                  <SearchInput
                    placeholder={tGenerated('m_1cba69d6d9c5bb')}
                    paramKey={listKeys.q}
                    pageParamKey={listKeys.page}
                  />
                  <FilterChips
                    basePath={basePath}
                    currentParams={sp}
                    paramKey={listKeys.filter}
                    pageParamKey={listKeys.page}
                    label={tGenerated('m_100e41041dbe51')}
                    options={[...CERTIFICATE_RESULTS]}
                  />
                </TableToolbar>
                <GeneratedValue
                  value={
                    annualRecords.length === 0 ? (
                      <EmptyState
                        icon={<ShieldCheck size={24} />}
                        title={tGenerated('m_067baf881152d0')}
                        description={tGenerated('m_1d1abf5e55716d')}
                        action={
                          canManage ? (
                            <Link href={`${basePath}?tab=annual&drawer=add-certificate` as any}>
                              <Button size="sm" variant="outline">
                                <Plus size={14} /> <GeneratedText id="m_004d3bf67c5039" />
                              </Button>
                            </Link>
                          ) : null
                        }
                      />
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <GeneratedText id="m_1f69767390b86a" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_0285c38761c540" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_08412ea75fe5da" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_100e41041dbe51" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_11af411751990f" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_162675e3afbec7" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_0b8dadcb78cd08" />
                            </TableHead>
                            <GeneratedValue
                              value={
                                canManage ? (
                                  <TableHead className="text-right">
                                    <GeneratedText id="m_0a7f1858f2ec46" />
                                  </TableHead>
                                ) : null
                              }
                            />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <GeneratedValue
                            value={annualRecords.map(({ rec, person, cert }) => (
                              <TableRow key={rec.id}>
                                <TableCell className="font-mono">
                                  <GeneratedValue value={rec.year} />
                                </TableCell>
                                <TableCell>
                                  <GeneratedValue value={rec.inspectedOn} />
                                </TableCell>
                                <TableCell>
                                  <GeneratedValue
                                    value={
                                      person
                                        ? `${person.firstName} ${person.lastName}`
                                        : rec.inspectorName
                                          ? `${rec.inspectorName}${rec.inspectorCompany ? ` (${rec.inspectorCompany})` : ''}`
                                          : '—'
                                    }
                                  />
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      rec.result === 'pass'
                                        ? 'success'
                                        : rec.result === 'fail'
                                          ? 'destructive'
                                          : 'warning'
                                    }
                                  >
                                    <GeneratedValue value={rec.result} />
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  <GeneratedValue value={rec.nextDueOn ?? '—'} />
                                </TableCell>
                                <TableCell>
                                  <GeneratedValue
                                    value={
                                      cert ? (
                                        <a
                                          href={attachmentUrl(cert.id)}
                                          className="inline-flex items-center gap-1.5 text-teal-700 hover:underline"
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          <FileText size={13} /> {cert.filename}
                                        </a>
                                      ) : (
                                        <span className="text-slate-400">
                                          <GeneratedText id="m_0a259ba2018245" />
                                        </span>
                                      )
                                    }
                                  />
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  <GeneratedValue value={rec.notes ?? '—'} />
                                </TableCell>
                                <GeneratedValue
                                  value={
                                    canManage ? (
                                      <TableCell className="text-right">
                                        <form action={deleteCertificate} className="inline">
                                          <input type="hidden" name="id" value={rec.id} />
                                          <input type="hidden" name="itemId" value={id} />
                                          <Button
                                            type="submit"
                                            size="sm"
                                            variant="ghost"
                                            aria-label={tGenerated('m_13dcd4064c453a')}
                                          >
                                            <Trash2 size={14} className="text-red-500" />
                                          </Button>
                                        </form>
                                      </TableCell>
                                    ) : null
                                  }
                                />
                              </TableRow>
                            ))}
                          />
                        </TableBody>
                      </Table>
                    )
                  }
                />
                <Pagination
                  basePath={basePath}
                  currentParams={sp}
                  total={listData.filteredTotal}
                  page={listParams.page}
                  perPage={listParams.perPage}
                  pageParamKey={listKeys.page}
                />
              </Section>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'issues' ? (
              <Section
                title={tGenerated('m_1288fde4e2b904', { value0: countData.issues })}
                actions={
                  <Link href={`${basePath}?tab=issues&drawer=report-issue` as any}>
                    <Button size="sm" variant="destructive">
                      <AlertTriangle size={14} /> <GeneratedText id="m_06fa5670ff1458" />
                    </Button>
                  </Link>
                }
              >
                <TableToolbar className="mb-3">
                  <SearchInput
                    placeholder={tGenerated('m_04e72d1b716bb4')}
                    paramKey={listKeys.q}
                    pageParamKey={listKeys.page}
                  />
                  <FilterChips
                    basePath={basePath}
                    currentParams={sp}
                    paramKey={listKeys.filter}
                    pageParamKey={listKeys.page}
                    label={tGenerated('m_0b9da892d6faf0')}
                    options={[...ISSUE_STATUSES]}
                  />
                </TableToolbar>
                <GeneratedValue
                  value={
                    issueReports.length === 0 ? (
                      <EmptyState
                        icon={<AlertTriangle size={24} />}
                        title={tGenerated('m_032436c6bb24a0')}
                        description={tGenerated('m_07813ddb9b7268')}
                        action={
                          <Link href={`${basePath}?tab=issues&drawer=report-issue` as any}>
                            <Button size="sm" variant="outline">
                              <AlertTriangle size={14} /> <GeneratedText id="m_06fa5670ff1458" />
                            </Button>
                          </Link>
                        }
                      />
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <GeneratedText id="m_14dedf0d22e940" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_14d923495cf14c" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_1d05fa7a091a9b" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_0b9da892d6faf0" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_1e0580f7c4c4a5" />
                            </TableHead>
                            <TableHead></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <GeneratedValue
                            value={issueReports.map((r) => (
                              <TableRow key={r.id}>
                                <TableCell>
                                  <GeneratedValue
                                    value={formatDate(
                                      new Date(r.reportedAt),
                                      ctx.timezone,
                                      ctx.locale,
                                    )}
                                  />
                                </TableCell>
                                <TableCell className="text-slate-700">
                                  <GeneratedValue value={r.description} />
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  <GeneratedValue value={r.source} />
                                </TableCell>
                                <TableCell>
                                  <Badge variant={r.status === 'open' ? 'destructive' : 'success'}>
                                    <GeneratedValue value={r.status} />
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  <GeneratedValue value={r.resolution ?? '—'} />
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-1.5">
                                    <GeneratedValue
                                      value={
                                        r.status === 'open' ? (
                                          <form
                                            action={resolveIssue}
                                            className="flex items-center gap-1.5"
                                          >
                                            <input type="hidden" name="id" value={r.id} />
                                            <input type="hidden" name="itemId" value={id} />
                                            <Input
                                              name="resolution"
                                              placeholder={tGenerated('m_10078fdb11ccd8')}
                                              className="h-8 w-40"
                                            />
                                            <Button type="submit" size="sm">
                                              <GeneratedText id="m_12ff63cfbc5634" />
                                            </Button>
                                          </form>
                                        ) : null
                                      }
                                    />
                                    <Link
                                      href={`/ppe/${id}/issues/${r.id}/pdf` as any}
                                      target="_blank"
                                      className="text-xs text-teal-700 hover:underline"
                                    >
                                      <GeneratedText id="m_1a2b2ed6729166" />
                                    </Link>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          />
                        </TableBody>
                      </Table>
                    )
                  }
                />
                <Pagination
                  basePath={basePath}
                  currentParams={sp}
                  total={listData.filteredTotal}
                  page={listParams.page}
                  perPage={listParams.perPage}
                  pageParamKey={listKeys.page}
                />
              </Section>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'history' ? (
              <Section title={tGenerated('m_1fb7d84bdda0a4', { value0: countData.history })}>
                <TableToolbar className="mb-3">
                  <SearchInput
                    placeholder={tGenerated('m_04e17d6ea8569f')}
                    paramKey={listKeys.q}
                    pageParamKey={listKeys.page}
                  />
                  <FilterChips
                    basePath={basePath}
                    currentParams={sp}
                    paramKey={listKeys.filter}
                    pageParamKey={listKeys.page}
                    label={tGenerated('m_0bad495a7046e9')}
                    options={[...HISTORY_ACTIONS]}
                  />
                </TableToolbar>
                <GeneratedValue
                  value={
                    issuesLog.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        <GeneratedText id="m_1007a9ede8dc27" />
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <GeneratedText id="m_13cc128f69897c" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_0bad495a7046e9" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_12e926c9216094" />
                            </TableHead>
                            <TableHead>
                              <GeneratedText id="m_16d241f76641bb" />
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <GeneratedValue
                            value={issuesLog.map((row) => (
                              <TableRow key={row.issue.id}>
                                <TableCell>
                                  <GeneratedValue
                                    value={formatDate(
                                      new Date(row.issue.occurredAt),
                                      ctx.timezone,
                                      ctx.locale,
                                    )}
                                  />
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      row.issue.action === 'issue'
                                        ? 'success'
                                        : row.issue.action === 'discard' ||
                                            row.issue.action === 'mark_damaged'
                                          ? 'destructive'
                                          : 'secondary'
                                    }
                                  >
                                    <GeneratedValue value={row.issue.action} />
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  <GeneratedValue
                                    value={
                                      row.person ? (
                                        <Link
                                          href={`/people/${row.person.id}`}
                                          className="text-teal-700 hover:underline"
                                        >
                                          {row.person.firstName} {row.person.lastName}
                                        </Link>
                                      ) : (
                                        '—'
                                      )
                                    }
                                  />
                                </TableCell>
                                <TableCell className="text-slate-600">
                                  <GeneratedValue value={row.issue.note ?? '—'} />
                                </TableCell>
                              </TableRow>
                            ))}
                          />
                        </TableBody>
                      </Table>
                    )
                  }
                />
                <Pagination
                  basePath={basePath}
                  currentParams={sp}
                  total={listData.filteredTotal}
                  page={listParams.page}
                  perPage={listParams.perPage}
                  pageParamKey={listKeys.page}
                />
              </Section>
            ) : null
          }
        />
      </div>

      <GenericSendEmailDialog
        open={pickString(sp.send) === '1'}
        title={tGeneratedValue(
          openIssues.length > 0 ? tGenerated('m_00d95acdc378ae') : tGenerated('m_10f9f5d1746a3a'),
        )}
        description={tGeneratedValue(
          openIssues.length > 0 ? tGenerated('m_083a8588b6b8ae') : tGenerated('m_121f949b83c154'),
        )}
        recipientsHint="Enter at least one recipient — each gets their own copy. Nothing is sent if this is left blank."
        reference={item.serialNumber ?? id.slice(0, 8)}
        defaultSubjectPrefix={openIssues.length > 0 ? 'Action required' : 'FYI'}
        sendAction={async (fd) => {
          'use server'
          fd.set('id', id)
          await sendEmailAction(fd)
        }}
      />

      {/*
       * Sub-entity drawers. Mounted once per page; only one is open at a time
       * (URL-driven via `?drawer=…`). Each form inside the drawer has an id
       * so the sticky footer's submit button can target it via the `form`
       * attribute. Closing pops back to closeHref which preserves the
       * active tab.
       */}
      <UrlDrawer
        open={drawerKey === 'record-inspection'}
        closeHref={closeHref}
        title={tGeneratedValue(
          inspectionKind === 'annual'
            ? tGenerated('m_0933551cc278f8')
            : tGenerated('m_024460a277c771'),
        )}
        description={tGeneratedValue(
          inspectionKind === 'annual'
            ? tGenerated('m_1835964e76a7d5')
            : tGenerated('m_18e0e5e1c782f7'),
        )}
        size="lg"
      >
        <PpeInspectionForm
          itemId={id}
          typeId={type.id}
          kind={inspectionKind}
          criteria={inspectionCriteria}
          action={recordInspection}
        />
      </UrlDrawer>

      <UrlDrawer
        open={drawerKey === 'report-issue'}
        closeHref={closeHref}
        title={tGenerated('m_06fa5670ff1458')}
        description={tGenerated('m_135cced6f154d0')}
        size="md"
        footer={
          <Button type="submit" form="ppe-report-issue-form" variant="destructive">
            <AlertTriangle size={14} /> <GeneratedText id="m_06fa5670ff1458" />
          </Button>
        }
      >
        <form id="ppe-report-issue-form" action={reportIssue} className="space-y-3">
          <input type="hidden" name="itemId" value={id} />
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_1db672a51e011e" />
            </Label>
            <Textarea
              name="description"
              rows={6}
              required
              placeholder={tGenerated('m_11034845dd4aad')}
            />
          </div>
        </form>
      </UrlDrawer>

      <UrlDrawer
        open={drawerKey === 'issue-to-person'}
        closeHref={closeHref}
        title={tGenerated('m_10b50a35e0953a')}
        description={tGenerated('m_1da6c99a41b626')}
        size="md"
        footer={
          <Button type="submit" form="ppe-issue-to-person-form">
            <UserPlus size={14} /> <GeneratedText id="m_12ac7fffa3512c" />
          </Button>
        }
      >
        <form id="ppe-issue-to-person-form" action={setStatus} className="space-y-3">
          <input type="hidden" name="itemId" value={id} />
          <input type="hidden" name="status" value="issued" />
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_03813d435c147b" />
            </Label>
            <RemoteSelectField
              name="personId"
              defaultValue={item.currentHolderPersonId ?? ''}
              lookup="ppe-active-people"
              initialOption={
                holder
                  ? {
                      value: holder.id,
                      label: `${holder.lastName}, ${holder.firstName}`,
                      hint: holder.employeeNo ?? undefined,
                    }
                  : undefined
              }
              placeholder={tGenerated('m_0ba815306341be')}
              clearable={false}
            />
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_16d241f76641bb" />
            </Label>
            <Textarea name="note" rows={3} placeholder={tGenerated('m_13a81f587a96fe')} />
          </div>
        </form>
      </UrlDrawer>

      <UrlDrawer
        open={drawerKey === 'change-status'}
        closeHref={closeHref}
        title={tGenerated('m_118818fef81797')}
        description={tGenerated('m_1654fb96b987d2')}
        size="md"
        footer={
          <Button type="submit" form="ppe-change-status-form">
            <RefreshCw size={14} /> <GeneratedText id="m_0f931aecc2cfc6" />
          </Button>
        }
      >
        <form id="ppe-change-status-form" action={setStatus} className="space-y-3">
          <input type="hidden" name="itemId" value={id} />
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_0b5f0bfe110fb9" />
            </Label>
            <Select
              name="status"
              defaultValue={item.status === 'issued' ? 'returned' : item.status}
            >
              <option value="returned">
                <GeneratedText id="m_0db63ebe793932" />
              </option>
              <option value="in_stock">
                <GeneratedText id="m_04a4449373ab9b" />
              </option>
              <option value="damaged">
                <GeneratedText id="m_16d172eabbfe82" />
              </option>
              <option value="discarded">
                <GeneratedText id="m_06ffdeeb54ee1e" />
              </option>
              <option value="expired">
                <GeneratedText id="m_13f7150c94b182" />
              </option>
            </Select>
            <p className="text-xs text-slate-500">
              <GeneratedText id="m_124787d234886f" />
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>
              <GeneratedText id="m_16d241f76641bb" />
            </Label>
            <Textarea name="note" rows={3} placeholder={tGenerated('m_0b4e7d84715e51')} />
          </div>
        </form>
      </UrlDrawer>

      <CertificateDrawer
        open={drawerKey === 'add-certificate'}
        closeHref={closeHref}
        itemId={id}
        todayIso={new Date().toISOString().slice(0, 10)}
        saveAction={async (input: CertificateInput) => {
          'use server'
          return addCertificate({ ...input, itemId: id })
        }}
      />
    </DetailPageLayout>
  )
}
