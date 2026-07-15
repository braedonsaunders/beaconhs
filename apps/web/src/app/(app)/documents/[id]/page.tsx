import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { SmartBackLink } from '@/components/smart-back-link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm'
import {
  Activity,
  BadgeCheck,
  Check,
  ClipboardCheck,
  FileText,
  History,
  Info,
  Mail,
  ShieldCheck,
  Trash2,
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
  EmptyState,
} from '@beaconhs/ui'
import { DocumentDrawers } from './_drawers'
import {
  attachments,
  documentAcknowledgmentSessions,
  documentAcknowledgments,
  documentCategories,
  documentReviews,
  documentTypes,
  documentVersions,
  documents,
  people,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import { attachmentUrl } from '@/lib/attachment-url'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { activityPageForEntity, recordAuditInTransaction } from '@/lib/audit'
import { assertUploadedDocumentPdf } from '@/lib/document-version-policy'
import { assertDocumentNotInPublishedBook } from '@/lib/document-book-lifecycle'
import {
  assertComplianceTargetCanRetire,
  materializeEvidenceTargetObligations,
} from '@beaconhs/compliance'
import { isUuid, parsePrefixedListParams, pickString } from '@/lib/list-params'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { DocumentOverview } from './_overview'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { GenericSendEmailDialog } from '@/components/send-email-dialog'
import { sendDocumentEmail } from './_send-email'
import { deleteDocument } from '../_actions'
import { ConfirmButton } from '@/components/confirm-button'
import { getTenantAiSettings } from '@/lib/ai-config'
import { DocumentPane } from './_document-pane'
import { AcknowledgmentsPanel, type AckRow } from './_acknowledgments-panel'
import { DocumentCompliancePanel, loadDocumentObligations } from './_compliance-panel'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'

export const dynamic = 'force-dynamic'

const TABS = [
  'overview',
  'versions',
  'acknowledgments',
  'reviews',
  'compliance',
  'activity',
] as const
type Tab = (typeof TABS)[number]

const VERSION_SORTS = ['recent', 'oldest'] as const
const ACK_SORTS = ['recent', 'name'] as const
const REVIEW_SORTS = ['recent', 'oldest'] as const
const ACTIVITY_SORTS = ['recent', 'oldest'] as const

// yyyy-mm-dd of an instant in the viewer's IANA timezone. Date columns are
// entered as local dates, so "today" / auto-computed review dates must be
// formatted in the same frame of reference — never toISOString().slice(),
// which converts to UTC and can drift a day.
function dateIsoInTz(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_081723366ddedf', { value0: id.slice(0, 8) }) }
}

// ---------- Server actions ----------

// Publish for FILE-ONLY documents (uploaded PDFs): there is no draft to
// snapshot — the latest uploaded version simply becomes visible to readers.
// Authored documents publish from the Write toolbar (publishDocumentVersion:
// changelog + numbered snapshot + render); this page never shows both.
async function publishFileDocument(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const id = String(formData.get('id') ?? '')
  if (!isUuid(id)) throw new Error('Document not found')
  const changed = await ctx.db(async (tx) => {
    const [doc] = await tx
      .select({ status: documents.status, sourceAttachmentId: documents.sourceAttachmentId })
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1)
      .for('update')
    if (!doc) throw new Error('Document not found')
    if (doc.sourceAttachmentId) {
      throw new Error('Authored documents publish from the Write tab')
    }
    const [version] = await tx
      .select({
        id: documentVersions.id,
        version: documentVersions.version,
        contentAttachmentId: documentVersions.contentAttachmentId,
        publishedAt: documentVersions.publishedAt,
      })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, id))
      .orderBy(desc(documentVersions.version))
      .limit(1)
    if (!version?.contentAttachmentId) throw new Error('Upload a PDF before publishing')
    const [attachment] = await tx
      .select({ kind: attachments.kind, contentType: attachments.contentType })
      .from(attachments)
      .where(eq(attachments.id, version.contentAttachmentId))
      .limit(1)
    if (!attachment) throw new Error('The uploaded PDF is missing')
    assertUploadedDocumentPdf(attachment)

    if (version.publishedAt && doc.status === 'published') return false
    const publishedAt = version.publishedAt ?? new Date()
    await tx
      .update(documentVersions)
      .set({ publishedAt, publishedBy: ctx.userId })
      .where(and(eq(documentVersions.id, version.id), isNull(documentVersions.publishedAt)))
    await tx.update(documents).set({ status: 'published' }).where(eq(documents.id, id))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document',
      entityId: id,
      action: 'publish',
      summary: 'Published the uploaded document',
      after: { versionId: version.id, version: version.version, publishedAt },
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'document',
      targetRef: { documentId: id },
    })
    return true
  })
  if (changed) {
    revalidatePath(`/documents/${id}`)
    revalidatePath('/documents')
  }
}

async function unpublish(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const id = String(formData.get('id') ?? '')
  if (!isUuid(id)) throw new Error('Document not found.')
  await ctx.db(async (tx) => {
    const [document] = await tx
      .select({ status: documents.status })
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, ctx.tenantId),
          eq(documents.id, id),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!document) throw new Error('Document not found.')
    if (document.status === 'draft') return
    await assertDocumentNotInPublishedBook(tx, ctx.tenantId, id)
    await assertComplianceTargetCanRetire(tx, ctx.tenantId, 'document', id)
    await tx
      .update(documents)
      .set({ status: 'draft' })
      .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.id, id)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document',
      entityId: id,
      action: 'update',
      summary: 'Document unpublished (set to draft)',
      before: { status: document.status },
      after: { status: 'draft' },
    })
  })
  revalidatePath(`/documents/${id}`)
  revalidatePath('/documents')
}

async function recordReviewAction(input: {
  documentId: string
  outcome: 'approved_no_change' | 'updated' | 'retired'
  notes: string | null
  nextReviewOn: string | null
}): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.review')
  const { documentId, outcome, notes, nextReviewOn: nextReviewOnRaw } = input
  if (!documentId || !outcome) return { ok: false, error: 'Missing fields' }
  if (!ctx.membership?.id) {
    return { ok: false, error: 'Membership required to record reviews' }
  }

  await ctx.db(async (tx) => {
    const [document] = await tx
      .select({
        id: documents.id,
        reviewFrequencyMonths: documents.reviewFrequencyMonths,
      })
      .from(documents)
      .where(
        and(
          eq(documents.tenantId, ctx.tenantId),
          eq(documents.id, documentId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1)
      .for('update')
    if (!document) throw new Error('Document not found.')
    const [reviewedVersion] = await tx
      .select({ id: documentVersions.id, version: documentVersions.version })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.tenantId, ctx.tenantId),
          eq(documentVersions.documentId, documentId),
          isNotNull(documentVersions.publishedAt),
        ),
      )
      .orderBy(desc(documentVersions.version), desc(documentVersions.id))
      .limit(1)
    if (!reviewedVersion) {
      throw new Error('Publish the document before recording a periodic review.')
    }
    if (outcome === 'retired') {
      await assertDocumentNotInPublishedBook(tx, ctx.tenantId, documentId)
    }
    await tx.insert(documentReviews).values({
      tenantId: ctx.tenantId,
      documentId,
      documentVersionId: reviewedVersion.id,
      reviewedByTenantUserId: ctx.membership!.id,
      status: 'completed',
      outcome,
      notes,
      nextReviewOn: nextReviewOnRaw,
    })
    // Bump nextReviewOn on the document if supplied
    if (nextReviewOnRaw) {
      await tx
        .update(documents)
        .set({ nextReviewOn: nextReviewOnRaw })
        .where(eq(documents.id, documentId))
    } else {
      // Auto-compute from reviewFrequencyMonths
      if (document.reviewFrequencyMonths) {
        const next = new Date()
        next.setMonth(next.getMonth() + document.reviewFrequencyMonths)
        const dateStr = dateIsoInTz(next, ctx.timezone)
        await tx
          .update(documents)
          .set({ nextReviewOn: dateStr })
          .where(eq(documents.id, documentId))
      }
    }
    if (outcome === 'retired') {
      await tx
        .update(documents)
        .set({ status: 'archived' })
        .where(and(eq(documents.tenantId, ctx.tenantId), eq(documents.id, documentId)))
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document',
      entityId: documentId,
      action: 'update',
      summary: `Review recorded: ${outcome.replace(/_/g, ' ')}`,
      after: {
        outcome,
        notes,
        nextReviewOn: nextReviewOnRaw,
        documentVersionId: reviewedVersion.id,
        documentVersion: reviewedVersion.version,
      },
    })
  })
  revalidatePath(`/documents/${documentId}`)
  return { ok: true }
}

// Inline server action for the Send-email dialog. Reads the dialog form
// fields, delegates to `sendDocumentEmail` which composes the email +
// writes the audit row, then revalidates the detail page.
async function sendEmailAction(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
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
  await sendDocumentEmail(ctx, id, {
    recipients: recipients.length > 0 ? recipients : undefined,
    cc: cc.length > 0 ? cc : undefined,
    subjectPrefix,
    messageOverride,
  })
  revalidatePath(`/documents/${id}`)
}

// ---------- Page ----------

export default async function DocumentDetailPage({
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
  const versionParams = parsePrefixedListParams(sp, 'version', {
    sort: 'recent',
    perPage: 12,
    allowedSorts: VERSION_SORTS,
  })
  const ackParams = parsePrefixedListParams(sp, 'ack', {
    sort: 'recent',
    perPage: 12,
    allowedSorts: ACK_SORTS,
  })
  const reviewParams = parsePrefixedListParams(sp, 'review', {
    sort: 'recent',
    perPage: 12,
    allowedSorts: REVIEW_SORTS,
  })
  const complianceParams = parsePrefixedListParams(sp, 'compliance', {
    sort: 'title',
    dir: 'asc',
    perPage: 12,
    allowedSorts: ['title'] as const,
  })
  const activityParams = parsePrefixedListParams(sp, 'activity', {
    sort: 'recent',
    perPage: 15,
    allowedSorts: ACTIVITY_SORTS,
  })
  const requestedVersionStatus = pickString(sp.versionStatus)
  const versionStatus =
    requestedVersionStatus === 'published' || requestedVersionStatus === 'draft'
      ? requestedVersionStatus
      : undefined
  const requestedAckType = pickString(sp.ackType)
  const ackType =
    requestedAckType === 'individual' || requestedAckType === 'group' ? requestedAckType : undefined
  const requestedReviewOutcome = pickString(sp.reviewOutcome)
  const reviewOutcome =
    requestedReviewOutcome === 'approved_no_change' ||
    requestedReviewOutcome === 'updated' ||
    requestedReviewOutcome === 'retired' ||
    requestedReviewOutcome === 'not_recorded'
      ? requestedReviewOutcome
      : undefined
  const requestedReviewStatus = pickString(sp.reviewStatus)
  const reviewStatus =
    requestedReviewStatus === 'in_progress' || requestedReviewStatus === 'completed'
      ? requestedReviewStatus
      : undefined
  const requestedComplianceStatus = pickString(sp.complianceStatus)
  const complianceStatus =
    requestedComplianceStatus === 'active' ||
    requestedComplianceStatus === 'paused' ||
    requestedComplianceStatus === 'archived'
      ? requestedComplianceStatus
      : undefined
  const activityAction = pickString(sp.activityAction)?.slice(0, 100) || undefined

  const ctx = await requireRequestContext()
  // Viewing a document requires documents.read; managers hold it implicitly via
  // documents.manage. Mirrors the /documents list page so the direct-URL detail
  // route can't leak drafts / under-review / archived docs to users who only see
  // the published library (or have no document access at all).
  const canManage = ctx.isSuperAdmin || can(ctx, 'documents.manage')
  const canRead = canManage || can(ctx, 'documents.read')
  if (!canRead) notFound()

  const data = await ctx.db(async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1)
    if (!doc) return null

    const [
      currentVersions,
      publishedVersions,
      currentPeople,
      masterAttachments,
      categories,
      types,
      versionTotalRows,
      ackTotalRows,
      reviewTotalRows,
    ] = await Promise.all([
      tx
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, id))
        .orderBy(desc(documentVersions.version))
        .limit(1),
      tx
        .select()
        .from(documentVersions)
        .where(and(eq(documentVersions.documentId, id), isNotNull(documentVersions.publishedAt)))
        .orderBy(desc(documentVersions.version))
        .limit(1),
      tx.select().from(people).where(eq(people.userId, ctx.userId)).limit(1),
      doc.sourceAttachmentId
        ? tx
            .select({ id: attachments.id, filename: attachments.filename })
            .from(attachments)
            .where(eq(attachments.id, doc.sourceAttachmentId))
            .limit(1)
        : Promise.resolve([]),
      tx
        .select({ id: documentCategories.id, name: documentCategories.name })
        .from(documentCategories)
        .where(isNull(documentCategories.deletedAt))
        .orderBy(asc(documentCategories.name)),
      tx
        .select({ id: documentTypes.id, name: documentTypes.name })
        .from(documentTypes)
        .where(isNull(documentTypes.deletedAt))
        .orderBy(asc(documentTypes.name)),
      tx
        .select({ count: count() })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, id)),
      tx
        .select({ count: count() })
        .from(documentAcknowledgments)
        .where(eq(documentAcknowledgments.documentId, id)),
      tx.select({ count: count() }).from(documentReviews).where(eq(documentReviews.documentId, id)),
    ])

    const versionWhere = and(
      eq(documentVersions.documentId, id),
      versionParams.q
        ? or(
            ilike(documentVersions.changelog, `%${versionParams.q}%`),
            sql`${documentVersions.version}::text ilike ${`%${versionParams.q}%`}`,
          )
        : undefined,
      versionStatus === 'published'
        ? isNotNull(documentVersions.publishedAt)
        : versionStatus === 'draft'
          ? isNull(documentVersions.publishedAt)
          : undefined,
    )
    const [versionFilteredRows, versions] =
      active === 'versions'
        ? await Promise.all([
            tx.select({ count: count() }).from(documentVersions).where(versionWhere),
            tx
              .select()
              .from(documentVersions)
              .where(versionWhere)
              .orderBy(
                versionParams.sort === 'oldest'
                  ? asc(documentVersions.version)
                  : desc(documentVersions.version),
                versionParams.sort === 'oldest'
                  ? asc(documentVersions.id)
                  : desc(documentVersions.id),
              )
              .limit(versionParams.perPage)
              .offset((versionParams.page - 1) * versionParams.perPage),
          ])
        : [[], []]

    const ackSearch = ackParams.q
      ? or(
          ilike(people.firstName, `%${ackParams.q}%`),
          ilike(people.lastName, `%${ackParams.q}%`),
          ilike(people.employeeNo, `%${ackParams.q}%`),
          ilike(documentAcknowledgmentSessions.title, `%${ackParams.q}%`),
        )
      : undefined
    const ackWhere = and(
      eq(documentAcknowledgments.documentId, id),
      ackSearch,
      ackType === 'group'
        ? isNotNull(documentAcknowledgments.sessionId)
        : ackType === 'individual'
          ? isNull(documentAcknowledgments.sessionId)
          : undefined,
    )
    const [ackFilteredRows, acks] =
      active === 'acknowledgments'
        ? await Promise.all([
            tx
              .select({ count: count() })
              .from(documentAcknowledgments)
              .innerJoin(people, eq(people.id, documentAcknowledgments.personId))
              .leftJoin(
                documentAcknowledgmentSessions,
                eq(documentAcknowledgmentSessions.id, documentAcknowledgments.sessionId),
              )
              .where(ackWhere),
            tx
              .select({
                ackId: documentAcknowledgments.id,
                personId: documentAcknowledgments.personId,
                firstName: people.firstName,
                lastName: people.lastName,
                acknowledgedAt: documentAcknowledgments.acknowledgedAt,
                sessionId: documentAcknowledgments.sessionId,
                sessionTitle: documentAcknowledgmentSessions.title,
                signatureAttachmentId: attachments.id,
              })
              .from(documentAcknowledgments)
              .innerJoin(people, eq(people.id, documentAcknowledgments.personId))
              .leftJoin(
                documentAcknowledgmentSessions,
                eq(documentAcknowledgmentSessions.id, documentAcknowledgments.sessionId),
              )
              .leftJoin(
                attachments,
                eq(attachments.id, documentAcknowledgments.signatureAttachmentId),
              )
              .where(ackWhere)
              .orderBy(
                ...(ackParams.sort === 'name'
                  ? [asc(people.lastName), asc(people.firstName)]
                  : [desc(documentAcknowledgments.acknowledgedAt)]),
                asc(documentAcknowledgments.id),
              )
              .limit(ackParams.perPage)
              .offset((ackParams.page - 1) * ackParams.perPage),
          ])
        : [[], []]

    const reviewWhere = and(
      eq(documentReviews.documentId, id),
      reviewParams.q
        ? or(
            ilike(documentReviews.notes, `%${reviewParams.q}%`),
            ilike(user.name, `%${reviewParams.q}%`),
            ilike(tenantUsers.displayName, `%${reviewParams.q}%`),
            ilike(documentReviews.outcome, `%${reviewParams.q}%`),
          )
        : undefined,
      reviewOutcome === 'not_recorded'
        ? isNull(documentReviews.outcome)
        : reviewOutcome
          ? eq(documentReviews.outcome, reviewOutcome)
          : undefined,
      reviewStatus ? eq(documentReviews.status, reviewStatus) : undefined,
    )
    const [reviewFilteredRows, reviews] =
      active === 'reviews'
        ? await Promise.all([
            tx
              .select({ count: count() })
              .from(documentReviews)
              .leftJoin(tenantUsers, eq(tenantUsers.id, documentReviews.reviewedByTenantUserId))
              .leftJoin(user, eq(user.id, tenantUsers.userId))
              .where(reviewWhere),
            tx
              .select({
                review: documentReviews,
                member: tenantUsers,
                account: user,
                documentVersion: documentVersions.version,
              })
              .from(documentReviews)
              .leftJoin(tenantUsers, eq(tenantUsers.id, documentReviews.reviewedByTenantUserId))
              .leftJoin(user, eq(user.id, tenantUsers.userId))
              .innerJoin(
                documentVersions,
                and(
                  eq(documentVersions.id, documentReviews.documentVersionId),
                  eq(documentVersions.documentId, documentReviews.documentId),
                ),
              )
              .where(reviewWhere)
              .orderBy(
                reviewParams.sort === 'oldest'
                  ? asc(documentReviews.reviewedAt)
                  : desc(documentReviews.reviewedAt),
                reviewParams.sort === 'oldest' ? asc(documentReviews.id) : desc(documentReviews.id),
              )
              .limit(reviewParams.perPage)
              .offset((reviewParams.page - 1) * reviewParams.perPage),
          ])
        : [[], []]

    const currentPerson = currentPeople[0] ?? null
    const publishedVersion = publishedVersions[0] ?? null
    const myAck =
      currentPerson && publishedVersion
        ? ((
            await tx
              .select({ acknowledgedAt: documentAcknowledgments.acknowledgedAt })
              .from(documentAcknowledgments)
              .where(
                and(
                  eq(documentAcknowledgments.documentId, id),
                  eq(documentAcknowledgments.personId, currentPerson.id),
                  eq(documentAcknowledgments.versionId, publishedVersion.id),
                ),
              )
              .orderBy(desc(documentAcknowledgments.acknowledgedAt))
              .limit(1)
          )[0] ?? null)
        : null

    return {
      doc,
      currentVersion: currentVersions[0],
      publishedVersion,
      versions,
      versionTotal: Number(versionTotalRows[0]?.count ?? 0),
      versionFilteredTotal: Number(versionFilteredRows[0]?.count ?? 0),
      acks,
      ackTotal: Number(ackTotalRows[0]?.count ?? 0),
      ackFilteredTotal: Number(ackFilteredRows[0]?.count ?? 0),
      reviews,
      reviewTotal: Number(reviewTotalRows[0]?.count ?? 0),
      reviewFilteredTotal: Number(reviewFilteredRows[0]?.count ?? 0),
      currentPerson,
      myAck,
      masterAtt: masterAttachments[0] ?? null,
      categories,
      types,
    }
  })

  if (!data) notFound()
  const {
    doc,
    currentVersion,
    publishedVersion,
    versions,
    versionTotal,
    versionFilteredTotal,
    acks,
    ackTotal,
    ackFilteredTotal,
    reviews,
    reviewTotal,
    reviewFilteredTotal,
    currentPerson,
    myAck,
    masterAtt,
    categories,
    types,
  } = data
  const categoryName = doc.categoryId
    ? (categories.find((category) => category.id === doc.categoryId)?.name ?? null)
    : null
  // Non-managers may only view PUBLISHED documents — same rule the list page
  // applies via `eq(documents.status, 'published')`.
  if (!canManage && doc.status !== 'published') notFound()
  const basePath = `/documents/${id}`

  // Right pane: the inline Writer for authored docs, or the PDF for
  // uploaded-file docs and read-only users.
  const isFileDoc = !doc.sourceAttachmentId && !!currentVersion?.contentAttachmentId
  const canEmailPublishedVersion =
    doc.status === 'published' &&
    Boolean(publishedVersion) &&
    Boolean(publishedVersion?.contentAttachmentId || publishedVersion?.pdfAttachmentId)
  const canReview = can(ctx, 'documents.review')
  const canRecordReview = canReview && Boolean(publishedVersion)
  const aiSettings = canManage ? await getTenantAiSettings(ctx) : null
  const aiEnabled = !!aiSettings && aiSettings.enabled && aiSettings.hasKey

  // Acknowledgments → flat rows for the panel (with signature thumbnails).
  const ackRows: AckRow[] = acks.map((a) => ({
    ackId: a.ackId,
    personId: a.personId,
    name: `${a.firstName} ${a.lastName}`.trim() || '(unnamed)',
    acknowledgedAt: a.acknowledgedAt.toISOString(),
    sessionId: a.sessionId,
    sessionTitle: a.sessionTitle,
    signatureUrl: a.signatureAttachmentId ? attachmentUrl(a.signatureAttachmentId) : null,
  }))
  const selfStatus: 'can' | 'acked' | 'unpublished' | 'no-person' = !currentPerson
    ? 'no-person'
    : myAck
      ? 'acked'
      : !publishedVersion
        ? 'unpublished'
        : 'can'
  const selfAckedAt = myAck ? myAck.acknowledgedAt.toISOString() : null

  // Compliance tab: obligations that require this document.
  const canAssign = can(ctx, 'compliance.assign')
  const complianceData =
    active === 'compliance'
      ? await loadDocumentObligations(ctx, id, {
          q: complianceParams.q,
          status: complianceStatus,
          page: complianceParams.page,
          perPage: complianceParams.perPage,
        })
      : { rows: [], total: 0, filteredTotal: 0 }

  const activityData =
    active === 'activity'
      ? await activityPageForEntity(ctx, 'document', id, {
          q: activityParams.q,
          action: activityAction,
          page: activityParams.page,
          perPage: activityParams.perPage,
          dir: activityParams.sort === 'oldest' ? 'asc' : 'desc',
        })
      : { rows: [], total: 0, filteredTotal: 0, actions: [] }

  const todayIso = dateIsoInTz(new Date(), ctx.timezone)
  const isOverdue = doc.nextReviewOn ? doc.nextReviewOn < todayIso : false

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <SmartBackLink
          href="/documents"
          label={tGenerated('m_05caa6a53f9b7f')}
          className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              <GeneratedValue value={doc.title} />
            </span>
            <Badge variant={doc.status === 'published' ? 'success' : 'secondary'}>
              <GeneratedValue value={doc.status} />
            </Badge>
            <GeneratedValue
              value={
                currentVersion ? (
                  <Badge variant="outline">
                    <GeneratedText id="m_1c693e59d64fb2" />
                    <GeneratedValue value={currentVersion.version} />
                  </Badge>
                ) : null
              }
            />
            <GeneratedValue
              value={
                isOverdue ? (
                  <Badge variant="destructive">
                    <GeneratedText id="m_00a1f1b8ed0f00" />
                  </Badge>
                ) : null
              }
            />
          </div>
          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value={categoryName ?? <GeneratedText id="m_08927559ee23e3" />} /> ·{' '}
            <span className="font-mono">
              <GeneratedValue value={doc.key} />
            </span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <GeneratedValue
            value={
              canManage ? (
                <>
                  <GeneratedValue
                    value={
                      canEmailPublishedVersion ? (
                        <Link
                          href={
                            `/documents/${id}?send=1${active !== 'overview' ? `&tab=${active}` : ''}` as any
                          }
                          scroll={false}
                        >
                          <Button variant="outline">
                            <Mail size={14} /> <GeneratedText id="m_09dfca28fc95ba" />
                          </Button>
                        </Link>
                      ) : doc.status === 'published' && publishedVersion ? (
                        <Button variant="outline" disabled title={tGenerated('m_10c935c4eaa746')}>
                          <Mail size={14} /> <GeneratedText id="m_114d1ab8539fc8" />
                        </Button>
                      ) : null
                    }
                  />
                  <GeneratedValue
                    value={
                      doc.status === 'published' ? (
                        <form action={unpublish} className="inline">
                          <input type="hidden" name="id" value={id} />
                          <Button type="submit" variant="outline">
                            <GeneratedText id="m_0d6976fc2d60c8" />
                          </Button>
                        </form>
                      ) : isFileDoc ? (
                        // Authored documents publish from the Write toolbar (with a
                        // changelog) — only file-only PDFs publish from here.
                        <form action={publishFileDocument} className="inline">
                          <input type="hidden" name="id" value={id} />
                          <Button type="submit">
                            <Check size={14} /> <GeneratedText id="m_0c072fb8baf115" />
                          </Button>
                        </form>
                      ) : null
                    }
                  />
                  <form action={deleteDocument} className="inline">
                    <input type="hidden" name="id" value={id} />
                    <ConfirmButton
                      message={tGenerated('m_1c8dd92ce3b2c4')}
                      size="md"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      <Trash2 size={14} /> <GeneratedText id="m_11773f3c3f7558" />
                    </ConfirmButton>
                  </form>
                </>
              ) : null
            }
          />
        </div>
      </div>

      {/* Split body: left 1/3 subtabs · right 2/3 the document */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex min-h-0 w-1/3 max-w-md min-w-[300px] flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-3 pt-2 dark:border-slate-800">
            <TabNav
              basePath={basePath}
              currentParams={sp}
              active={active}
              iconOnly
              tabs={[
                { key: 'overview', label: 'Overview', icon: <Info size={16} /> },
                {
                  key: 'versions',
                  label: 'Versions',
                  count: versionTotal,
                  icon: <History size={16} />,
                },
                {
                  key: 'acknowledgments',
                  label: 'Acknowledgments',
                  count: ackTotal,
                  icon: <BadgeCheck size={16} />,
                },
                {
                  key: 'reviews',
                  label: 'Reviews',
                  count: reviewTotal,
                  icon: <ClipboardCheck size={16} />,
                },
                { key: 'compliance', label: 'Compliance', icon: <ShieldCheck size={16} /> },
                { key: 'activity', label: 'Activity', icon: <Activity size={16} /> },
              ]}
            />
          </div>
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-4">
            <GeneratedValue
              value={
                isOverdue ? (
                  <Alert variant="warning" className="mb-4">
                    <AlertTitle>
                      <GeneratedText id="m_111449cf34e9af" />
                    </AlertTitle>
                    <AlertDescription>
                      <GeneratedText id="m_04bfc1eaee3a4b" />{' '}
                      <GeneratedValue value={doc.nextReviewOn} />.
                      <GeneratedValue
                        value={
                          canRecordReview ? (
                            <>
                              <GeneratedValue value={' '} />
                              <Link
                                href={`${basePath}?tab=reviews&drawer=record-review`}
                                className="font-medium underline-offset-2 hover:underline"
                              >
                                <GeneratedText id="m_0804c5d753d279" />
                              </Link>
                            </>
                          ) : null
                        }
                      />
                    </AlertDescription>
                  </Alert>
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'overview' ? (
                  canManage ? (
                    <DocumentOverview
                      documentId={id}
                      categories={categories}
                      types={types}
                      initialMeta={{
                        title: doc.title,
                        key: doc.key,
                        categoryId: doc.categoryId ?? '',
                        typeId: doc.typeId ?? '',
                        description: doc.description ?? '',
                        reviewFrequencyMonths:
                          doc.reviewFrequencyMonths != null
                            ? String(doc.reviewFrequencyMonths)
                            : '',
                        nextReviewOn: doc.nextReviewOn ?? '',
                      }}
                    />
                  ) : (
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          <GeneratedText id="m_11c253e21845f3" />
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <DetailGrid
                          rows={[
                            { label: 'Title', value: doc.title },
                            { label: 'Key', value: doc.key },
                            {
                              label: 'Category',
                              value: categoryName ?? '—',
                            },
                            {
                              label: 'Type',
                              value:
                                (doc.typeId
                                  ? types.find((t) => t.id === doc.typeId)?.name
                                  : null) ?? '—',
                            },
                            { label: 'Description', value: doc.description ?? '—' },
                            { label: 'Next review', value: doc.nextReviewOn ?? '—' },
                          ]}
                        />
                      </CardContent>
                    </Card>
                  )
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'versions' ? (
                  <div className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          <GeneratedText id="m_12984e1a49d6e9" />
                          <GeneratedValue value={versionTotal} />)
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <TableToolbar className="mb-3">
                          <SearchInput
                            placeholder={tGenerated('m_137dd4dfca48c0')}
                            paramKey="versionQ"
                            pageParamKey="versionPage"
                          />
                          <FilterChips
                            basePath={basePath}
                            currentParams={sp}
                            paramKey="versionStatus"
                            pageParamKey="versionPage"
                            label={tGenerated('m_0b9da892d6faf0')}
                            options={[
                              { value: 'published', label: 'Published' },
                              { value: 'draft', label: 'Draft' },
                            ]}
                          />
                          <FilterChips
                            basePath={basePath}
                            currentParams={sp}
                            paramKey="versionSort"
                            pageParamKey="versionPage"
                            label={tGenerated('m_126e942baf656b')}
                            defaultValue="recent"
                            hideAll
                            options={[
                              { value: 'recent', label: 'Newest first' },
                              { value: 'oldest', label: 'Oldest first' },
                            ]}
                          />
                        </TableToolbar>
                        <GeneratedValue
                          value={
                            versions.length === 0 ? (
                              <EmptyState
                                icon={<FileText size={24} />}
                                title={tGeneratedValue(
                                  versionTotal === 0
                                    ? tGenerated('m_1240d16e7a09e0')
                                    : tGenerated('m_14b62c222c86cf'),
                                )}
                                description={tGeneratedValue(
                                  versionTotal === 0
                                    ? tGenerated('m_193f02f1eb5212')
                                    : tGenerated('m_0815c60c9d0476'),
                                )}
                              />
                            ) : (
                              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                                <GeneratedValue
                                  value={versions.map((v) => (
                                    <li key={v.id} className="py-3">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium">
                                            <GeneratedText id="m_0e5e42c9af5dbe" />{' '}
                                            <GeneratedValue value={v.version} />
                                          </span>
                                          <GeneratedValue
                                            value={
                                              v.publishedAt ? (
                                                <Badge variant="success">
                                                  <GeneratedText id="m_17f8c524f67082" />
                                                </Badge>
                                              ) : (
                                                <Badge variant="secondary">
                                                  <GeneratedText id="m_138f9da1a581b0" />
                                                </Badge>
                                              )
                                            }
                                          />
                                        </div>
                                        <span className="text-xs text-slate-500 dark:text-slate-400">
                                          <GeneratedValue
                                            value={
                                              v.publishedAt ? (
                                                <GeneratedText
                                                  id="m_0b178c0d92c81d"
                                                  values={{
                                                    value0: formatDate(
                                                      new Date(v.publishedAt),
                                                      ctx.timezone,
                                                      ctx.locale,
                                                    ),
                                                  }}
                                                />
                                              ) : (
                                                <GeneratedText
                                                  id="m_159638c62de126"
                                                  values={{
                                                    value0: formatDate(
                                                      new Date(v.createdAt),
                                                      ctx.timezone,
                                                      ctx.locale,
                                                    ),
                                                  }}
                                                />
                                              )
                                            }
                                          />
                                        </span>
                                      </div>
                                      <GeneratedValue
                                        value={
                                          v.changelog ? (
                                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                              {v.changelog}
                                            </p>
                                          ) : null
                                        }
                                      />
                                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                                        <GeneratedValue
                                          value={
                                            v.pdfAttachmentId || v.contentAttachmentId ? (
                                              <a
                                                href={`${basePath}/versions/${v.id}/download`}
                                                className="text-teal-700 hover:underline dark:text-teal-300"
                                              >
                                                <GeneratedText id="m_1a2b2ed6729166" />
                                              </a>
                                            ) : v.renderStatus === 'pending' ||
                                              v.renderStatus === 'processing' ? (
                                              <span className="text-slate-400 dark:text-slate-500">
                                                <GeneratedText id="m_1c9ea41f32bb8f" />
                                              </span>
                                            ) : v.renderStatus === 'failed' ? (
                                              <span
                                                className="text-rose-600 dark:text-rose-400"
                                                title={v.renderError ?? undefined}
                                              >
                                                <GeneratedText id="m_0872eae4a8ab9b" />
                                              </span>
                                            ) : null
                                          }
                                        />
                                        <GeneratedValue
                                          value={
                                            v.docxAttachmentId ? (
                                              <>
                                                <a
                                                  href={`${basePath}/versions/${v.id}/download?kind=docx`}
                                                  className="text-teal-700 hover:underline dark:text-teal-300"
                                                >
                                                  <GeneratedText id="m_18c2e68821b0cd" />
                                                </a>
                                                {canManage ? (
                                                  <Link
                                                    href={`${basePath}/editor?version=${v.id}`}
                                                    className="text-teal-700 hover:underline dark:text-teal-300"
                                                  >
                                                    <GeneratedText id="m_0dd89c337db248" />
                                                  </Link>
                                                ) : null}
                                              </>
                                            ) : null
                                          }
                                        />
                                      </div>
                                    </li>
                                  ))}
                                />
                              </ul>
                            )
                          }
                        />
                        <Pagination
                          basePath={basePath}
                          currentParams={sp}
                          total={versionFilteredTotal}
                          page={versionParams.page}
                          perPage={versionParams.perPage}
                          pageParamKey="versionPage"
                        />
                      </CardContent>
                    </Card>
                  </div>
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'acknowledgments' ? (
                  <AcknowledgmentsPanel
                    documentId={id}
                    versionId={publishedVersion?.id ?? null}
                    signOffHref={`${basePath}/sign-off`}
                    acks={ackRows}
                    total={ackTotal}
                    filteredTotal={ackFilteredTotal}
                    page={ackParams.page}
                    perPage={ackParams.perPage}
                    currentParams={sp}
                    selfStatus={selfStatus}
                    selfAckedAt={selfAckedAt}
                    canManageSignOff={canManage}
                  />
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'compliance' ? (
                  <DocumentCompliancePanel
                    documentId={id}
                    obligations={complianceData.rows}
                    total={complianceData.total}
                    filteredTotal={complianceData.filteredTotal}
                    page={complianceParams.page}
                    perPage={complianceParams.perPage}
                    currentParams={sp}
                    canAssign={canAssign}
                  />
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'reviews' ? (
                  <div className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle>
                          <GeneratedText id="m_1619cc77cdf77a" />
                          <GeneratedValue value={reviewTotal} />)
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <TableToolbar className="mb-3">
                          <SearchInput
                            placeholder={tGenerated('m_0553a00e7b18b9')}
                            paramKey="reviewQ"
                            pageParamKey="reviewPage"
                          />
                          <FilterChips
                            basePath={basePath}
                            currentParams={sp}
                            paramKey="reviewOutcome"
                            pageParamKey="reviewPage"
                            label={tGenerated('m_00da71f1bd869e')}
                            options={[
                              { value: 'approved_no_change', label: 'Approved, no change' },
                              { value: 'updated', label: 'Updated' },
                              { value: 'retired', label: 'Retired' },
                              { value: 'not_recorded', label: 'Outcome not recorded' },
                            ]}
                          />
                          <FilterChips
                            basePath={basePath}
                            currentParams={sp}
                            paramKey="reviewStatus"
                            pageParamKey="reviewPage"
                            label={tGenerated('m_0b9da892d6faf0')}
                            options={[
                              { value: 'completed', label: 'Completed' },
                              { value: 'in_progress', label: 'In progress' },
                            ]}
                          />
                          <FilterChips
                            basePath={basePath}
                            currentParams={sp}
                            paramKey="reviewSort"
                            pageParamKey="reviewPage"
                            label={tGenerated('m_126e942baf656b')}
                            defaultValue="recent"
                            hideAll
                            options={[
                              { value: 'recent', label: 'Newest first' },
                              { value: 'oldest', label: 'Oldest first' },
                            ]}
                          />
                        </TableToolbar>
                        <GeneratedValue
                          value={
                            reviews.length === 0 ? (
                              <p className="text-sm text-slate-500 dark:text-slate-400">
                                <GeneratedValue
                                  value={
                                    reviewTotal === 0 ? (
                                      <GeneratedText id="m_136397e6a0330b" />
                                    ) : (
                                      <GeneratedText id="m_08c6e827a3055e" />
                                    )
                                  }
                                />
                              </p>
                            ) : (
                              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                                <GeneratedValue
                                  value={reviews.map((row) => (
                                    <li key={row.review.id} className="py-3">
                                      <div className="flex items-center justify-between">
                                        <span className="font-medium">
                                          <GeneratedValue
                                            value={
                                              row.account?.name ??
                                              row.member?.displayName ?? (
                                                <GeneratedText id="m_0437e976e882d8" />
                                              )
                                            }
                                          />
                                        </span>
                                        <Badge
                                          variant={
                                            row.review.outcome === 'approved_no_change'
                                              ? 'success'
                                              : row.review.outcome === 'updated'
                                                ? 'warning'
                                                : row.review.outcome === 'retired'
                                                  ? 'destructive'
                                                  : 'secondary'
                                          }
                                        >
                                          <GeneratedValue
                                            value={
                                              row.review.outcome ? (
                                                row.review.outcome.replace(/_/g, ' ')
                                              ) : (
                                                <GeneratedText id="m_065f07a677dff5" />
                                              )
                                            }
                                          />
                                        </Badge>
                                      </div>
                                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                        <GeneratedText id="m_1c693e59d64fb2" />
                                        <GeneratedValue value={row.documentVersion} /> ·
                                        <GeneratedValue value={' '} />
                                        <GeneratedValue
                                          value={formatDate(
                                            new Date(row.review.reviewedAt),
                                            ctx.timezone,
                                            ctx.locale,
                                          )}
                                        />
                                        <GeneratedValue value={' '} />·{' '}
                                        <GeneratedValue
                                          value={row.review.status.replace(/_/g, ' ')}
                                        />
                                        <GeneratedValue
                                          value={
                                            row.review.nextReviewOn ? (
                                              <GeneratedText
                                                id="m_058efd4b3e5a33"
                                                values={{ value0: row.review.nextReviewOn }}
                                              />
                                            ) : (
                                              ''
                                            )
                                          }
                                        />
                                      </div>
                                      <GeneratedValue
                                        value={
                                          row.review.notes ? (
                                            <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                                              {row.review.notes}
                                            </p>
                                          ) : null
                                        }
                                      />
                                    </li>
                                  ))}
                                />
                              </ul>
                            )
                          }
                        />
                        <Pagination
                          basePath={basePath}
                          currentParams={sp}
                          total={reviewFilteredTotal}
                          page={reviewParams.page}
                          perPage={reviewParams.perPage}
                          pageParamKey="reviewPage"
                        />
                      </CardContent>
                    </Card>
                    <GeneratedValue
                      value={
                        canRecordReview ? (
                          <div className="flex justify-end">
                            <Link href={`${basePath}?tab=reviews&drawer=record-review`}>
                              <Button type="button">
                                <Check size={14} /> <GeneratedText id="m_018804ef31e286" />
                              </Button>
                            </Link>
                          </div>
                        ) : null
                      }
                    />
                  </div>
                ) : null
              }
            />

            <GeneratedValue
              value={
                active === 'activity' ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        <GeneratedText id="m_19eb6234e1c976" />
                        <GeneratedValue value={activityData.total} />)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <TableToolbar className="mb-3">
                        <SearchInput
                          placeholder={tGenerated('m_1b028fe99601a3')}
                          paramKey="activityQ"
                          pageParamKey="activityPage"
                        />
                        <FilterChips
                          basePath={basePath}
                          currentParams={sp}
                          paramKey="activityAction"
                          pageParamKey="activityPage"
                          label={tGenerated('m_0bad495a7046e9')}
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
                          label={tGenerated('m_126e942baf656b')}
                          defaultValue="recent"
                          hideAll
                          options={[
                            { value: 'recent', label: 'Newest first' },
                            { value: 'oldest', label: 'Oldest first' },
                          ]}
                        />
                      </TableToolbar>
                      <ActivityFeed
                        entries={activityData.rows}
                        timeZone={ctx.timezone}
                        locale={ctx.locale}
                      />
                      <Pagination
                        basePath={basePath}
                        currentParams={sp}
                        total={activityData.filteredTotal}
                        page={activityParams.page}
                        perPage={activityParams.perPage}
                        pageParamKey="activityPage"
                      />
                    </CardContent>
                  </Card>
                ) : null
              }
            />
          </div>
        </aside>

        {/* Right pane: the live editor for managers, or the published PDF for
            uploaded-file documents and read-only users */}
        <div className="min-h-0 flex-1">
          <DocumentPane
            documentId={id}
            canManage={canManage}
            defaultMode={isFileDoc ? 'pdf' : 'write'}
            master={
              doc.sourceAttachmentId && masterAtt
                ? { attachmentId: masterAtt.id, filename: masterAtt.filename }
                : null
            }
            latestPublished={
              publishedVersion
                ? {
                    version: publishedVersion.version,
                    renderStatus: publishedVersion.renderStatus,
                  }
                : null
            }
            aiEnabled={aiEnabled}
          />
        </div>
      </div>

      <GeneratedValue
        value={
          canManage && canEmailPublishedVersion ? (
            <GenericSendEmailDialog
              open={pickString(sp.send) === '1'}
              title={tGenerated('m_0f6a8e55c3ba4a')}
              description={tGenerated('m_0d51e102b2d695')}
              reference={doc.key}
              defaultSubjectPrefix="FYI"
              sendAction={async (fd) => {
                'use server'
                fd.set('id', id)
                await sendEmailAction(fd)
              }}
            />
          ) : null
        }
      />
      <GeneratedValue
        value={
          canRecordReview ? (
            <DocumentDrawers
              documentId={id}
              openDrawer={pickString(sp.drawer) === 'record-review' ? 'record-review' : null}
              closeHref={`${basePath}${active === 'overview' ? '' : `?tab=${active}`}`}
              defaultNextReviewOn={doc.nextReviewOn ?? null}
              recordReviewAction={recordReviewAction}
            />
          ) : null
        }
      />
    </div>
  )
}
