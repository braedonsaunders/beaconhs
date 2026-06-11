import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import {
  AlertOctagon,
  ClipboardCheck,
  FileText,
  Lock,
  Pencil,
  ShieldAlert,
  Unlock,
} from 'lucide-react'
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
  Input,
  Label,
  Select,
  Textarea,
  UrlDrawer,
} from '@beaconhs/ui'
import {
  attachments,
  correctiveActions,
  inspectionBankCriteria,
  inspectionRecordAttachments,
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypes,
  orgUnits,
  people,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { pickString } from '@/lib/list-params'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { DetailPageLayout } from '@/components/page-layout'
import { PhotoGallery } from '@/components/photo-gallery'
import { PhotoUploaderSection } from '@/components/photo-uploader-section'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import {
  findIncompleteCriteria,
  logRecordAudit,
  parseAnswer,
  parseSeverity,
  syncCorrectiveActionForCriterion,
} from '../../_lib'
import { CustomerSignatureCard } from './customer-signature'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'criteria', 'action-taken', 'photos', 'signature', 'activity'] as const
type Tab = (typeof TABS)[number]

const STATUSES = ['draft', 'in_progress', 'submitted', 'closed'] as const

// ----------------------------------------------------------------------------
// Server actions
// ----------------------------------------------------------------------------

async function updateStatus(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return

  // Submit gate — refuse to flip to submitted/closed if any criterion is incomplete
  if (status === 'submitted' || status === 'closed') {
    const missing = await findIncompleteCriteria(ctx, id)
    if (missing.length > 0) {
      // Soft-fail: stash the missing list as a flash via the URL hash. Server
      // actions can't easily set cookies inside a transaction; redirecting
      // with a query param is the lightest user-visible signal.
      throw new Error(
        `Cannot submit: ${missing.length} item${missing.length === 1 ? '' : 's'} still incomplete. First missing: ${missing[0]}`,
      )
    }
  }

  const closing = status === 'closed'
  await ctx.db((tx) =>
    tx
      .update(inspectionRecords)
      .set({
        status: status as any,
        submittedAt: status === 'submitted' || status === 'closed' ? new Date() : null,
        closedAt: closing ? new Date() : null,
        closedByTenantUserId: closing ? (ctx.membership?.id ?? null) : null,
        locked: closing,
      })
      .where(eq(inspectionRecords.id, id)),
  )
  await logRecordAudit(ctx, id, `Status changed to "${status.replace(/_/g, ' ')}"`, 'update', {
    status,
  })
  revalidatePath(`/inspections/records/${id}`)
  revalidatePath('/inspections/records')
}

async function toggleLock(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  const lock = formData.get('lock') === 'true'
  await ctx.db((tx) =>
    tx.update(inspectionRecords).set({ locked: lock }).where(eq(inspectionRecords.id, id)),
  )
  await logRecordAudit(ctx, id, lock ? 'Locked' : 'Unlocked', 'update', { locked: lock })
  revalidatePath(`/inspections/records/${id}`)
}

async function setCriterionAnswer(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const answer = parseAnswer(formData.get('answer'))
  if (!recordId || !rowId || !answer) return

  // When flipping to pass / N-A, wipe the fail-only fields too.
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
    // Auto-transition the record from draft -> in_progress on the first answer.
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
  // Cleanup any orphan CA if we flipped away from fail
  if (clear) {
    await syncCorrectiveActionForCriterion(ctx, rowId)
  }
  revalidatePath(`/inspections/records/${recordId}`)
}

async function setCriterionSeverity(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const severity = parseSeverity(formData.get('severity'))
  if (!recordId || !rowId) return

  const prevCAId = await getCriterionCAId(ctx, rowId)
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
  const newCAId = await syncCorrectiveActionForCriterion(ctx, rowId)
  if (!prevCAId && newCAId) {
    await recordAudit(ctx, {
      entityType: 'corrective_action',
      entityId: newCAId,
      action: 'create',
      summary: `Auto-spawned from inspection finding (severity ${severity ?? 'unknown'})`,
      after: { sourceEntityType: 'inspection_record', sourceEntityId: recordId },
    })
    await logRecordAudit(ctx, recordId, `Auto-spawned corrective action`, 'update', {
      correctiveActionId: newCAId,
    })
  }
  revalidatePath(`/inspections/records/${recordId}`)
}

async function setCriterionNonCompliance(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const value = String(formData.get('value') ?? '').trim() || null
  if (!recordId || !rowId) return
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
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const value = String(formData.get('value') ?? '').trim() || null
  if (!recordId || !rowId) return
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
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const value = String(formData.get('value') ?? '').trim() || null
  if (!recordId || !rowId) return
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
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const assignedToPersonId = String(formData.get('assignedToPersonId') ?? '').trim() || null
  const assignedDueDate = String(formData.get('assignedDueDate') ?? '').trim() || null
  if (!recordId || !rowId) return
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
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const value = String(formData.get('correctedOn') ?? '').trim() || null
  if (!recordId || !rowId) return
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

/**
 * Bulk-save the full set of per-criterion answer fields. Typed object input
 * + `{ ok, error? }` return value to match the in-house server-action shape.
 *
 * If `answer` flips to 'pass'/'n_a' we wipe the fail-only fields to keep the
 * row coherent (same behaviour as `setCriterionAnswer`). If it flips to
 * 'fail' we wipe `compliantNote`. If no answer is provided we patch the
 * loose fields without touching `answer` itself.
 */
async function saveCriterionDetails(input: {
  recordId: string
  rowId: string
  answer: 'pass' | 'fail' | 'n_a' | null
  severity: 'low' | 'medium' | 'high' | 'critical' | null
  nonComplianceDescription: string | null
  actionTaken: string | null
  compliantNote: string | null
  assignedToPersonId: string | null
  assignedDueDate: string | null
  correctedOn: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server'
  try {
    const ctx = await requireRequestContext()
    if (!input.recordId || !input.rowId) {
      return { ok: false, error: 'Missing recordId or rowId' }
    }

    const isFail = input.answer === 'fail'
    const patch: Record<string, unknown> = {
      ...(input.answer
        ? {
            answer: input.answer,
            answeredAt: new Date(),
            answeredByTenantUserId: ctx.membership?.id ?? null,
          }
        : {}),
      ...(isFail
        ? {
            severity: input.severity ?? null,
            nonComplianceDescription: input.nonComplianceDescription,
            actionTaken: input.actionTaken,
            assignedToPersonId: input.assignedToPersonId,
            assignedDueDate: input.assignedDueDate,
            correctedOn: input.correctedOn,
            compliantNote: null,
          }
        : input.answer
          ? {
              severity: null,
              nonComplianceDescription: null,
              actionTaken: null,
              assignedToPersonId: null,
              assignedDueDate: null,
              correctedOn: null,
              compliantNote: input.compliantNote,
            }
          : {
              severity: input.severity ?? null,
              nonComplianceDescription: input.nonComplianceDescription,
              actionTaken: input.actionTaken,
              compliantNote: input.compliantNote,
              assignedToPersonId: input.assignedToPersonId,
              assignedDueDate: input.assignedDueDate,
              correctedOn: input.correctedOn,
            }),
    }

    await ctx.db(async (tx) => {
      await tx
        .update(inspectionRecordCriteria)
        .set(patch as any)
        .where(eq(inspectionRecordCriteria.id, input.rowId))
      // Mirror the auto-transition behaviour from setCriterionAnswer.
      if (input.answer) {
        await tx
          .update(inspectionRecords)
          .set({ status: 'in_progress' })
          .where(
            and(eq(inspectionRecords.id, input.recordId), eq(inspectionRecords.status, 'draft')),
          )
      }
    })
    await logRecordAudit(ctx, input.recordId, 'Edited criterion details', 'update', {
      ...input,
    })
    await syncCorrectiveActionForCriterion(ctx, input.rowId)
    revalidatePath(`/inspections/records/${input.recordId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Form-action adapter — drawer form posts FormData; we parse + delegate to the
 * typed `saveCriterionDetails` and throw on failure so the redirect flow stays
 * clean.
 */
async function saveCriterionDetailsForm(formData: FormData): Promise<void> {
  'use server'
  const result = await saveCriterionDetails({
    recordId: String(formData.get('recordId') ?? ''),
    rowId: String(formData.get('rowId') ?? ''),
    answer: parseAnswer(formData.get('answer')),
    severity: parseSeverity(formData.get('severity')),
    nonComplianceDescription: String(formData.get('nonComplianceDescription') ?? '').trim() || null,
    actionTaken: String(formData.get('actionTaken') ?? '').trim() || null,
    compliantNote: String(formData.get('compliantNote') ?? '').trim() || null,
    assignedToPersonId: String(formData.get('assignedToPersonId') ?? '').trim() || null,
    assignedDueDate: String(formData.get('assignedDueDate') ?? '').trim() || null,
    correctedOn: String(formData.get('correctedOn') ?? '').trim() || null,
  })
  if (!result.ok) throw new Error(result.error)
}

async function addCriterionPhoto(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const attachmentId = String(formData.get('attachmentId') ?? '').trim()
  if (!recordId || !rowId || !attachmentId) return
  await ctx.db(async (tx) => {
    const [cur] = await tx
      .select({ ids: inspectionRecordCriteria.photoAttachmentIds })
      .from(inspectionRecordCriteria)
      .where(eq(inspectionRecordCriteria.id, rowId))
      .limit(1)
    const next = [...(cur?.ids ?? []), attachmentId]
    await tx
      .update(inspectionRecordCriteria)
      .set({ photoAttachmentIds: next })
      .where(eq(inspectionRecordCriteria.id, rowId))
  })
  await logRecordAudit(ctx, recordId, 'Attached a photo to a criterion', 'update', { rowId })
  revalidatePath(`/inspections/records/${recordId}`)
}

async function passAll(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const recordId = String(formData.get('recordId') ?? '')
  if (!recordId) return
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
    // Auto-transition draft → in_progress
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
  const recordId = String(formData.get('recordId') ?? '')
  const signature = String(formData.get('signature') ?? '')
  const signerName = String(formData.get('signerName') ?? '').trim() || null
  if (!recordId) return
  const dataUrl = signature === 'clear' || signature === '' ? null : signature
  await ctx.db((tx) =>
    tx
      .update(inspectionRecords)
      .set({
        customerSignatureDataUrl: dataUrl,
        customerSignerName: signerName,
        customerSignedAt: dataUrl ? new Date() : null,
      })
      .where(eq(inspectionRecords.id, recordId)),
  )
  await logRecordAudit(
    ctx,
    recordId,
    dataUrl ? 'Captured customer signature' : 'Cleared customer signature',
    dataUrl ? 'sign' : 'update',
  )
  revalidatePath(`/inspections/records/${recordId}`)
}

// Helper used by setCriterionSeverity to know whether a CA was newly spawned.
async function getCriterionCAId(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  rowId: string,
): Promise<string | null> {
  const [row] = await ctx.db((tx) =>
    tx
      .select({ id: inspectionRecordCriteria.correctiveActionId })
      .from(inspectionRecordCriteria)
      .where(eq(inspectionRecordCriteria.id, rowId))
      .limit(1),
  )
  return row?.id ?? null
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
        bank: inspectionBankCriteria,
        assignee: people,
        ca: correctiveActions,
      })
      .from(inspectionRecordCriteria)
      .leftJoin(
        inspectionBankCriteria,
        eq(inspectionBankCriteria.id, inspectionRecordCriteria.criterionId),
      )
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
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))

    // For per-criterion photo previews, fetch attachments referenced in any
    // photoAttachmentIds in one pass.
    const allPhotoIds = Array.from(new Set(criteria.flatMap((c) => c.c.photoAttachmentIds ?? [])))
    const criterionPhotoMap = new Map<string, { id: string; url: string; filename: string }>()
    if (allPhotoIds.length > 0) {
      const rows = await tx
        .select({ id: attachments.id, key: attachments.r2Key, filename: attachments.filename })
        .from(attachments)
        .where(inArray(attachments.id, allPhotoIds))
      for (const r of rows) {
        criterionPhotoMap.set(r.id, { id: r.id, url: publicUrl(r.key), filename: r.filename })
      }
    }

    return { ...row, criteria, photos, peopleList, criterionPhotoMap }
  })

  if (!data) notFound()
  const { record, type, site, inspector, criteria, photos, peopleList, criterionPhotoMap } = data

  // Summary counts
  const total = criteria.length
  const passCount = criteria.filter((c) => c.c.answer === 'pass').length
  const failCount = criteria.filter((c) => c.c.answer === 'fail').length
  const naCount = criteria.filter((c) => c.c.answer === 'n_a').length
  const unansweredCount = criteria.filter((c) => !c.c.answer).length
  const failRows = criteria.filter((c) => c.c.answer === 'fail')
  const compliantPct =
    total > 0 ? Math.round((passCount / Math.max(1, passCount + failCount)) * 100) : 0

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'inspection_record', id, 50) : []

  const galleryPhotos = photos.map((p) => ({
    id: p.link.id,
    url: publicUrl(p.attachment.r2Key),
    filename: p.attachment.filename,
    caption: p.link.caption,
  }))

  const basePath = `/inspections/records/${id}`

  // Drawer state: ?drawer=edit-criterion&id=<rowId>. Close URL keeps the
  // current tab so the user lands back on the criteria view.
  const drawerKey = pickString(sp.drawer)
  const drawerRowId = pickString(sp.id)
  const closeHref = `${basePath}?tab=${active}`
  const editingRow =
    drawerKey === 'edit-criterion' && drawerRowId
      ? (criteria.find((c) => c.c.id === drawerRowId) ?? null)
      : null

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/inspections/records', label: 'Back to inspection records' }}
          title={`${record.reference} · ${type.name}`}
          subtitle={`${new Date(record.occurredAt).toLocaleString()} · inspector ${inspector?.name ?? 'unknown'}`}
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
                <Badge variant="outline" className="border-amber-300 text-amber-800">
                  <Lock size={10} /> Locked
                </Badge>
              ) : null}
              {failCount > 0 ? (
                <Badge variant="outline" className="border-red-300 text-red-800">
                  <ShieldAlert size={10} /> {failCount} failure{failCount === 1 ? '' : 's'}
                </Badge>
              ) : null}
            </div>
          }
          actions={
            <>
              <Link href={`/inspections/records?type=${record.typeId}`}>
                <Button variant="outline">
                  <FileText size={14} />
                  All of this type
                </Button>
              </Link>
            </>
          }
        />
      }
      alerts={
        <>
          {record.locked ? (
            <Alert variant="warning">
              <AlertTitle>This inspection is locked</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>
                  Closed on {record.closedAt ? new Date(record.closedAt).toLocaleDateString() : '—'}
                  . Unlock to make further edits.
                </span>
                <form action={toggleLock} className="inline">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="lock" value="false" />
                  <Button variant="outline" size="sm" type="submit">
                    <Unlock size={12} /> Unlock
                  </Button>
                </form>
              </AlertDescription>
            </Alert>
          ) : null}
          {type.requiresCustomerSignature && !record.customerSignatureDataUrl ? (
            <Alert variant="info">
              <AlertTitle>Signature required</AlertTitle>
              <AlertDescription>
                This type requires a customer signature.{' '}
                <Link
                  href={`/inspections/records/${id}?tab=signature`}
                  className="font-medium text-teal-700 hover:underline"
                >
                  Capture it →
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'criteria', label: 'Criteria', count: total },
            { key: 'action-taken', label: 'Action taken', count: failCount },
            { key: 'photos', label: 'Photos', count: photos.length },
            { key: 'signature', label: 'Signature', hidden: !type.requiresCustomerSignature },
            { key: 'activity', label: 'Activity' },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <>
            <Section title="General information">
              <DetailGrid
                rows={[
                  {
                    label: 'Reference',
                    value: <span className="font-mono">{record.reference}</span>,
                  },
                  {
                    label: 'Type',
                    value: (
                      <Link
                        className="hover:underline"
                        href={`/inspections/types/${record.typeId}`}
                      >
                        {type.name}
                      </Link>
                    ),
                  },
                  { label: 'Occurred', value: new Date(record.occurredAt).toLocaleString() },
                  { label: 'Site', value: site?.name ?? '—' },
                  { label: 'Inspector', value: inspector?.name ?? '—' },
                  { label: 'Foreman', value: record.foremanText ?? '—' },
                  {
                    label: 'Customer signer',
                    value: record.customerSignerName ?? '—',
                  },
                  {
                    label: 'Customer signed at',
                    value: record.customerSignedAt
                      ? new Date(record.customerSignedAt).toLocaleString()
                      : '—',
                  },
                  {
                    label: 'Submitted',
                    value: record.submittedAt ? new Date(record.submittedAt).toLocaleString() : '—',
                  },
                  {
                    label: 'Closed',
                    value: record.closedAt ? new Date(record.closedAt).toLocaleString() : '—',
                  },
                ]}
              />
              {record.notes ? (
                <div className="mt-4 text-sm">
                  <div className="text-xs tracking-wide text-slate-500 uppercase">Notes</div>
                  <p className="mt-1 whitespace-pre-wrap text-slate-800">{record.notes}</p>
                </div>
              ) : null}
            </Section>

            <Section title="Compliance summary">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Stat label="Pass" value={passCount} accent="emerald" />
                <Stat label="Fail" value={failCount} accent="red" />
                <Stat label="N/A" value={naCount} accent="slate" />
                <Stat label="Unanswered" value={unansweredCount} accent="amber" />
                <Stat label="Compliant %" value={`${compliantPct}%`} accent="teal" />
              </div>
              {unansweredCount > 0 && !record.locked ? (
                <form action={passAll} className="mt-4">
                  <input type="hidden" name="recordId" value={id} />
                  <Button type="submit" variant="outline">
                    <ClipboardCheck size={14} />
                    Mark all unanswered as pass ({unansweredCount})
                  </Button>
                </form>
              ) : null}
            </Section>

            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={updateStatus} className="flex items-end gap-3">
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
                    Update
                  </Button>
                </form>
                <p className="mt-2 text-xs text-slate-500">
                  Moving to "submitted" or "closed" requires every criterion to be answered. Move to
                  "closed" to lock the record.
                </p>
              </CardContent>
            </Card>
          </>
        ) : null}

        {active === 'criteria' ? (
          <div className="space-y-3">
            {criteria.length === 0 ? (
              <Alert variant="info">
                <AlertTitle>No criteria materialised</AlertTitle>
                <AlertDescription>
                  This record's type has no banks linked. Add some to{' '}
                  <Link
                    href={`/inspections/types/${record.typeId}?tab=banks`}
                    className="text-teal-700 hover:underline"
                  >
                    /inspections/types/{record.typeId}
                  </Link>{' '}
                  to populate.
                </AlertDescription>
              </Alert>
            ) : null}
            {criteria.map((row, i) => (
              <CriterionCard
                key={row.c.id}
                rowId={row.c.id}
                recordId={id}
                index={i}
                question={row.c.questionTextSnapshot}
                answer={row.c.answer}
                severity={row.c.severity}
                nonComplianceDescription={row.c.nonComplianceDescription}
                actionTaken={row.c.actionTaken}
                compliantNote={row.c.compliantNote}
                assignedToPersonId={row.c.assignedToPersonId}
                assignedDueDate={row.c.assignedDueDate}
                correctedOn={row.c.correctedOn}
                photoAttachmentIds={row.c.photoAttachmentIds ?? []}
                correctiveActionRef={row.ca?.reference ?? null}
                correctiveActionId={row.c.correctiveActionId}
                requiresPhoto={row.bank?.requiresPhoto ?? false}
                requiresComment={row.bank?.requiresComment ?? false}
                assignee={
                  row.assignee
                    ? {
                        id: row.assignee.id,
                        name: `${row.assignee.firstName} ${row.assignee.lastName}`,
                      }
                    : null
                }
                peopleList={peopleList.map((p) => ({
                  id: p.id,
                  name: `${p.firstName} ${p.lastName}`,
                }))}
                criterionPhotoMap={criterionPhotoMap}
                locked={record.locked}
                allowCompliantNotes={type.allowCompliantNotes}
                recordOccurredAt={record.occurredAt}
                editHref={`${basePath}?tab=${active}&drawer=edit-criterion&id=${row.c.id}`}
              />
            ))}
          </div>
        ) : null}

        {active === 'action-taken' ? (
          <Section
            title={`Action taken on failed items (${failRows.length})`}
            subtitle="Record what was done to remediate. This text flows into the linked corrective action."
          >
            {failRows.length === 0 ? (
              <p className="text-sm text-slate-500">
                No failed items recorded. The action-taken view stays empty until you mark a
                criterion as fail.
              </p>
            ) : (
              <div className="space-y-3">
                {failRows.map((row) => (
                  <div key={row.c.id} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          {row.c.questionTextSnapshot}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          {row.c.severity ? (
                            <Badge variant="outline">{row.c.severity}</Badge>
                          ) : null}
                          {row.ca?.reference ? (
                            <Link
                              href={`/corrective-actions/${row.c.correctiveActionId}`}
                              className="text-teal-700 hover:underline"
                            >
                              {row.ca.reference}
                            </Link>
                          ) : null}
                        </div>
                        {row.c.nonComplianceDescription ? (
                          <p className="mt-1 text-xs text-slate-600">
                            <strong>Non-compliance:</strong> {row.c.nonComplianceDescription}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {!record.locked ? (
                      <form action={setCriterionActionTaken} className="space-y-2">
                        <input type="hidden" name="recordId" value={id} />
                        <input type="hidden" name="rowId" value={row.c.id} />
                        <Textarea
                          name="value"
                          rows={2}
                          defaultValue={row.c.actionTaken ?? ''}
                          placeholder="What was done to remediate?"
                        />
                        <div className="flex justify-end">
                          <Button type="submit" size="sm">
                            Save action
                          </Button>
                        </div>
                      </form>
                    ) : row.c.actionTaken ? (
                      <p className="text-sm">{row.c.actionTaken}</p>
                    ) : (
                      <p className="text-xs text-slate-400">No action recorded.</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        ) : null}

        {active === 'photos' ? (
          <Section title={`Photos (${photos.length})`} defaultOpen={true}>
            <div className="space-y-3">
              <PhotoGallery photos={galleryPhotos} />
              {!record.locked ? (
                <PhotoUploaderSection
                  attachAction={async (ids) => {
                    'use server'
                    const ctx = await requireRequestContext()
                    if (ids.length === 0) return
                    await ctx.db((tx) =>
                      tx.insert(inspectionRecordAttachments).values(
                        ids.map((attachmentId) => ({
                          tenantId: ctx.tenantId,
                          recordId: id,
                          attachmentId,
                        })),
                      ),
                    )
                    await logRecordAudit(
                      ctx,
                      id,
                      `Attached ${ids.length} photo${ids.length === 1 ? '' : 's'}`,
                      'update',
                    )
                    revalidatePath(`/inspections/records/${id}`)
                  }}
                />
              ) : null}
            </div>
          </Section>
        ) : null}

        {active === 'signature' ? (
          <CustomerSignatureCard
            recordId={id}
            currentSignature={record.customerSignatureDataUrl}
            currentSignerName={record.customerSignerName}
            signedAt={record.customerSignedAt}
            locked={record.locked}
            saveAction={saveCustomerSignature}
          />
        ) : null}

        {active === 'activity' ? (
          <Section title={`Activity (${activity.length})`} defaultOpen={true}>
            <ActivityFeed entries={activity} />
          </Section>
        ) : null}
      </div>

      {/*
       * Per-criterion edit drawer. URL-driven via `?drawer=edit-criterion&id=…`.
       * Lets the inspector adjust every answer field in one place — handy for
       * follow-up clean-ups (mark corrected, switch severity, reassign) without
       * piecemeal form submits.
       */}
      <UrlDrawer
        open={Boolean(editingRow) && !record.locked}
        closeHref={closeHref}
        title="Edit criterion answer"
        description={editingRow?.c.questionTextSnapshot ?? undefined}
        size="lg"
        footer={
          <>
            <Link href={closeHref}>
              <Button variant="ghost">Cancel</Button>
            </Link>
            <Button type="submit" form="criterion-edit-form">
              Save
            </Button>
          </>
        }
      >
        {editingRow ? (
          <CriterionEditForm
            formId="criterion-edit-form"
            recordId={id}
            row={editingRow}
            peopleList={peopleList.map((p) => ({
              id: p.id,
              name: `${p.firstName} ${p.lastName}`,
            }))}
            recordOccurredAt={record.occurredAt}
            action={saveCriterionDetailsForm}
          />
        ) : null}
      </UrlDrawer>
    </DetailPageLayout>
  )
}

// ----------------------------------------------------------------------------
// Inline subcomponents — kept route-local so the page file is self-contained
// ----------------------------------------------------------------------------

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent: 'emerald' | 'red' | 'slate' | 'amber' | 'teal'
}) {
  const tone =
    accent === 'emerald'
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : accent === 'red'
        ? 'text-red-700 bg-red-50 border-red-200'
        : accent === 'amber'
          ? 'text-amber-700 bg-amber-50 border-amber-200'
          : accent === 'teal'
            ? 'text-teal-700 bg-teal-50 border-teal-200'
            : 'text-slate-700 bg-slate-50 border-slate-200'
  return (
    <div className={`rounded-md border px-3 py-2 ${tone}`}>
      <div className="text-xs tracking-wide uppercase">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

/**
 * Severity → Tailwind class triple. Mirrors the legacy app's colour map:
 * low=slate, medium=amber, high=orange, critical=rose.
 */
function severityBadgeClasses(severity: 'low' | 'medium' | 'high' | 'critical' | null): string {
  switch (severity) {
    case 'low':
      return 'border-slate-300 bg-slate-100 text-slate-700'
    case 'medium':
      return 'border-amber-300 bg-amber-100 text-amber-800'
    case 'high':
      return 'border-orange-300 bg-orange-100 text-orange-800'
    case 'critical':
      return 'border-rose-300 bg-rose-100 text-rose-800'
    default:
      return 'border-slate-200 bg-white text-slate-500'
  }
}

/**
 * A finding is overdue when:
 *   - it's marked `fail`
 *   - it has an assigned due date that's strictly in the past
 *   - it has NOT been corrected yet (`correctedOn` is null)
 * The inspection's `occurredAt` is the floor: if the due date is before the
 * inspection itself we treat that as a data-entry artefact and don't flag.
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
  // Don't flag findings whose due date pre-dates the inspection itself.
  const floor = new Date(args.recordOccurredAt)
  floor.setHours(0, 0, 0, 0)
  return due >= floor
}

function CriterionCard(props: {
  rowId: string
  recordId: string
  index: number
  question: string
  answer: 'pass' | 'fail' | 'n_a' | null
  severity: 'low' | 'medium' | 'high' | 'critical' | null
  nonComplianceDescription: string | null
  actionTaken: string | null
  compliantNote: string | null
  assignedToPersonId: string | null
  assignedDueDate: string | null
  correctedOn: string | null
  photoAttachmentIds: string[]
  correctiveActionRef: string | null
  correctiveActionId: string | null
  requiresPhoto: boolean
  requiresComment: boolean
  assignee: { id: string; name: string } | null
  peopleList: { id: string; name: string }[]
  criterionPhotoMap: Map<string, { id: string; url: string; filename: string }>
  locked: boolean
  allowCompliantNotes: boolean
  recordOccurredAt: Date
  editHref: string
}) {
  const {
    rowId,
    recordId,
    index,
    question,
    answer,
    severity,
    nonComplianceDescription,
    actionTaken,
    compliantNote,
    assignedToPersonId,
    assignedDueDate,
    correctedOn,
    photoAttachmentIds,
    correctiveActionRef,
    correctiveActionId,
    requiresPhoto,
    assignee,
    peopleList,
    criterionPhotoMap,
    locked,
    allowCompliantNotes,
    recordOccurredAt,
    editHref,
  } = props
  const overdue = isOverdue({ answer, assignedDueDate, correctedOn, recordOccurredAt })

  const photoPreviews = photoAttachmentIds
    .map((aid) => criterionPhotoMap.get(aid))
    .filter((p): p is { id: string; url: string; filename: string } => Boolean(p))

  return (
    <div
      className={`rounded-md border bg-white p-3 transition-colors ${
        answer === 'fail'
          ? 'border-red-200 bg-red-50/40'
          : answer === 'pass'
            ? 'border-emerald-200 bg-emerald-50/40'
            : answer === 'n_a'
              ? 'border-slate-200 bg-slate-50/40'
              : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-slate-500">#{index + 1}</div>
          <div className="mt-0.5 text-sm font-medium text-slate-900">{question}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            {requiresPhoto ? <Badge variant="secondary">Photo required</Badge> : null}
            {severity && answer === 'fail' ? (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${severityBadgeClasses(severity)}`}
              >
                {severity}
              </span>
            ) : null}
            {overdue ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-red-700 uppercase">
                <AlertOctagon size={10} /> Overdue
              </span>
            ) : null}
            {correctedOn && answer === 'fail' ? (
              <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">
                Corrected {correctedOn}
              </span>
            ) : null}
            {correctiveActionRef ? (
              <Link
                href={`/corrective-actions/${correctiveActionId}`}
                className="text-teal-700 hover:underline"
              >
                ↳ {correctiveActionRef}
              </Link>
            ) : null}
            {!locked ? (
              <Link
                href={editHref as any}
                className="ml-auto inline-flex items-center gap-1 text-xs text-teal-700 hover:underline"
              >
                <Pencil size={11} /> Edit details
              </Link>
            ) : null}
          </div>
        </div>
        {locked ? null : (
          <form action={setCriterionAnswer} className="flex shrink-0 items-center gap-1">
            <input type="hidden" name="recordId" value={recordId} />
            <input type="hidden" name="rowId" value={rowId} />
            {(['pass', 'fail', 'n_a'] as const).map((opt) => (
              <button
                key={opt}
                type="submit"
                name="answer"
                value={opt}
                className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  answer === opt
                    ? opt === 'pass'
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : opt === 'fail'
                        ? 'border-red-500 bg-red-500 text-white'
                        : 'border-slate-500 bg-slate-500 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {opt === 'n_a' ? 'N/A' : opt[0]!.toUpperCase() + opt.slice(1)}
              </button>
            ))}
          </form>
        )}
        {locked ? (
          <Badge variant="outline">{answer ? (answer === 'n_a' ? 'N/A' : answer) : '—'}</Badge>
        ) : null}
      </div>

      {answer === 'fail' && !locked ? (
        <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 text-sm">
          <form action={setCriterionSeverity} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="recordId" value={recordId} />
            <input type="hidden" name="rowId" value={rowId} />
            <div className="space-y-1">
              <Label className="text-xs">Severity</Label>
              <Select name="severity" defaultValue={severity ?? ''}>
                <option value="">— pick —</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High (spawns CA)</option>
                <option value="critical">Critical (spawns CA)</option>
              </Select>
            </div>
            <Button type="submit" size="sm" variant="outline">
              Save
            </Button>
          </form>

          <form action={setCriterionNonCompliance} className="space-y-1">
            <input type="hidden" name="recordId" value={recordId} />
            <input type="hidden" name="rowId" value={rowId} />
            <Label className="text-xs">Reason for non-compliance</Label>
            <Textarea
              name="value"
              rows={2}
              defaultValue={nonComplianceDescription ?? ''}
              placeholder="What's wrong?"
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" variant="outline">
                Save reason
              </Button>
            </div>
          </form>

          <form action={setCriterionAssignment} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="recordId" value={recordId} />
            <input type="hidden" name="rowId" value={rowId} />
            <div className="space-y-1">
              <Label className="text-xs">Assigned to</Label>
              <Select name="assignedToPersonId" defaultValue={assignedToPersonId ?? ''}>
                <option value="">— unassigned —</option>
                {peopleList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Due date</Label>
              <Input name="assignedDueDate" type="date" defaultValue={assignedDueDate ?? ''} />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Save
            </Button>
          </form>

          <form action={addCriterionPhoto} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="recordId" value={recordId} />
            <input type="hidden" name="rowId" value={rowId} />
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Attach photo (by attachment id)</Label>
              <Input name="attachmentId" placeholder="upload via Photos tab, then paste id here" />
            </div>
            <Button type="submit" size="sm" variant="outline">
              Link photo
            </Button>
          </form>
          <p className="text-xs text-slate-500">
            Tip: upload from the Photos tab first, then copy the attachment id and paste it here.
            Per-criterion photo upload widget lands in a follow-up — the data model already supports
            it.
          </p>
        </div>
      ) : null}

      {allowCompliantNotes && answer && answer !== 'fail' && !locked ? (
        <form
          action={setCriterionCompliantNote}
          className="mt-3 space-y-1 border-t border-slate-200 pt-3"
        >
          <input type="hidden" name="recordId" value={recordId} />
          <input type="hidden" name="rowId" value={rowId} />
          <Label className="text-xs">Compliant notes (optional)</Label>
          <Textarea
            name="value"
            rows={1}
            defaultValue={compliantNote ?? ''}
            placeholder="Anything worth noting?"
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="ghost">
              Save note
            </Button>
          </div>
        </form>
      ) : null}

      {photoPreviews.length > 0 ? (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <div className="mb-1 text-xs tracking-wide text-slate-500 uppercase">
            Photos ({photoPreviews.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {photoPreviews.map((p) => (
              <a
                key={p.id}
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="block h-16 w-16 overflow-hidden rounded border border-slate-200"
              >
                <img src={p.url} alt={p.filename} className="h-full w-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {locked ? (
        <div className="mt-2 space-y-1 text-xs text-slate-600">
          {severity ? <div>Severity: {severity}</div> : null}
          {nonComplianceDescription ? <div>Non-compliance: {nonComplianceDescription}</div> : null}
          {actionTaken ? <div>Action taken: {actionTaken}</div> : null}
          {assignee ? <div>Assigned: {assignee.name}</div> : null}
          {assignedDueDate ? <div>Due: {assignedDueDate}</div> : null}
          {correctedOn ? <div>Corrected on: {correctedOn}</div> : null}
          {compliantNote ? <div>Notes: {compliantNote}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

// ----------------------------------------------------------------------------
// Per-criterion edit form (rendered inside the drawer). Captures every
// answer-depth field in one go and posts to the bulk save action.
// ----------------------------------------------------------------------------
function CriterionEditForm({
  formId,
  recordId,
  row,
  peopleList,
  recordOccurredAt,
  action,
}: {
  formId: string
  recordId: string
  row: {
    c: {
      id: string
      answer: 'pass' | 'fail' | 'n_a' | null
      severity: 'low' | 'medium' | 'high' | 'critical' | null
      nonComplianceDescription: string | null
      actionTaken: string | null
      compliantNote: string | null
      assignedToPersonId: string | null
      assignedDueDate: string | null
      correctedOn: string | null
      questionTextSnapshot: string
    }
    ca: { reference: string } | null
  }
  peopleList: { id: string; name: string }[]
  recordOccurredAt: Date
  action: (formData: FormData) => Promise<void>
}) {
  const a = row.c.answer
  const overdue = isOverdue({
    answer: a,
    assignedDueDate: row.c.assignedDueDate,
    correctedOn: row.c.correctedOn,
    recordOccurredAt,
  })
  return (
    <form id={formId} action={action} className="space-y-4">
      <input type="hidden" name="recordId" value={recordId} />
      <input type="hidden" name="rowId" value={row.c.id} />

      {overdue ? (
        <Alert variant="destructive">
          <AlertTitle className="flex items-center gap-2">
            <AlertOctagon size={14} /> This finding is overdue
          </AlertTitle>
          <AlertDescription>
            Due date {row.c.assignedDueDate} has passed without a correction. Set the "Corrected on"
            date below to clear the flag.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="space-y-1.5">
        <Label className="text-xs tracking-wide text-slate-500 uppercase">Result</Label>
        <Select name="answer" defaultValue={a ?? ''}>
          <option value="">— Unanswered —</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail (non-compliant)</option>
          <option value="n_a">N/A</option>
        </Select>
        <p className="text-xs text-slate-500">
          Switching to pass or N/A clears the failure metadata below.
        </p>
      </div>

      <fieldset className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
        <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Non-compliance
        </legend>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Severity</Label>
            <Select name="severity" defaultValue={row.c.severity ?? ''}>
              <option value="">— pick —</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High (spawns CA)</option>
              <option value="critical">Critical (spawns CA)</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Assigned to</Label>
            <Select name="assignedToPersonId" defaultValue={row.c.assignedToPersonId ?? ''}>
              <option value="">— unassigned —</option>
              {peopleList.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Due date</Label>
            <Input name="assignedDueDate" type="date" defaultValue={row.c.assignedDueDate ?? ''} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Corrected on</Label>
            <Input name="correctedOn" type="date" defaultValue={row.c.correctedOn ?? ''} />
            <p className="text-[11px] text-slate-500">
              Fill this in once the fix is verified — clears the overdue flag.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Reason for non-compliance</Label>
          <Textarea
            name="nonComplianceDescription"
            rows={3}
            defaultValue={row.c.nonComplianceDescription ?? ''}
            placeholder="What's wrong?"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Action taken on the spot</Label>
          <Textarea
            name="actionTaken"
            rows={3}
            defaultValue={row.c.actionTaken ?? ''}
            placeholder="What did the inspector do about it right away?"
          />
          {row.ca?.reference ? (
            <p className="text-[11px] text-slate-500">
              Synced to corrective action{' '}
              <Link href="/corrective-actions" className="text-teal-700 hover:underline">
                {row.ca.reference}
              </Link>
              .
            </p>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Compliant context (only used on pass / N/A)
        </legend>
        <div className="space-y-1.5">
          <Label className="text-xs">Compliant note</Label>
          <Textarea
            name="compliantNote"
            rows={2}
            defaultValue={row.c.compliantNote ?? ''}
            placeholder='e.g. "torque verified at 50 ft-lbs"'
          />
        </div>
      </fieldset>
    </form>
  )
}
