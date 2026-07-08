import Link from 'next/link'
import { SmartBackLink } from '@/components/smart-back-link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
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
  user,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { DocumentOverview } from './_overview'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { GenericSendEmailDialog } from '@/components/send-email-dialog'
import { sendDocumentEmail } from './_send-email'
import { publishDocumentVersion } from './_master-actions'
import { deleteDocument } from '../_actions'
import { ConfirmButton } from '@/components/confirm-button'
import { getTenantAiSettings } from '@/lib/ai-config'
import { DocumentPane } from './_document-pane'
import { AcknowledgmentsPanel, type AckRow } from './_acknowledgments-panel'
import { DocumentCompliancePanel, loadDocumentObligations } from './_compliance-panel'

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
  const { id } = await params
  return { title: `Document · ${id.slice(0, 8)}` }
}

// ---------- Server actions ----------

async function publish(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  // Snapshots the DOCX master into an immutable numbered version and queues
  // its PDF render. Handles audit + revalidate internally.
  await publishDocumentVersion(id)
}

async function unpublish(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) => tx.update(documents).set({ status: 'draft' }).where(eq(documents.id, id)))
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: id,
    action: 'update',
    summary: 'Document unpublished (set to draft)',
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
    await tx.insert(documentReviews).values({
      tenantId: ctx.tenantId,
      documentId,
      reviewedByTenantUserId: ctx.membership!.id,
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
      const [doc] = await tx
        .select({ months: documents.reviewFrequencyMonths })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1)
      if (doc?.months) {
        const next = new Date()
        next.setMonth(next.getMonth() + doc.months)
        const dateStr = dateIsoInTz(next, ctx.timezone)
        await tx
          .update(documents)
          .set({ nextReviewOn: dateStr })
          .where(eq(documents.id, documentId))
      }
    }
    if (outcome === 'retired') {
      await tx.update(documents).set({ status: 'archived' }).where(eq(documents.id, documentId))
    }
  })
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: documentId,
    action: 'update',
    summary: `Review recorded: ${outcome.replace(/_/g, ' ')}`,
    after: { outcome, notes, nextReviewOn: nextReviewOnRaw },
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
  const { id } = await params
  const sp = await searchParams
  const active: Tab = pickActiveTab(sp, TABS, 'overview')

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
    const [versions, acks, reviews, currentPerson, masterAtt] = await Promise.all([
      tx
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, id))
        .orderBy(desc(documentVersions.version)),
      tx
        .select({
          ackId: documentAcknowledgments.id,
          personId: documentAcknowledgments.personId,
          firstName: people.firstName,
          lastName: people.lastName,
          acknowledgedAt: documentAcknowledgments.acknowledgedAt,
          versionId: documentAcknowledgments.versionId,
          sessionId: documentAcknowledgments.sessionId,
          sessionTitle: documentAcknowledgmentSessions.title,
          r2Key: attachments.r2Key,
        })
        .from(documentAcknowledgments)
        .innerJoin(people, eq(people.id, documentAcknowledgments.personId))
        .leftJoin(
          documentAcknowledgmentSessions,
          eq(documentAcknowledgmentSessions.id, documentAcknowledgments.sessionId),
        )
        .leftJoin(attachments, eq(attachments.id, documentAcknowledgments.signatureAttachmentId))
        .where(eq(documentAcknowledgments.documentId, id))
        .orderBy(desc(documentAcknowledgments.acknowledgedAt))
        .limit(2000),
      tx
        .select({ review: documentReviews, member: tenantUsers, account: user })
        .from(documentReviews)
        .leftJoin(tenantUsers, eq(tenantUsers.id, documentReviews.reviewedByTenantUserId))
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(documentReviews.documentId, id))
        .orderBy(desc(documentReviews.reviewedAt)),
      tx.select().from(people).where(eq(people.userId, ctx.userId)).limit(1),
      doc.sourceAttachmentId
        ? tx
            .select({ id: attachments.id, filename: attachments.filename })
            .from(attachments)
            .where(eq(attachments.id, doc.sourceAttachmentId))
            .limit(1)
        : Promise.resolve([]),
    ])
    const categories = await tx
      .select({ id: documentCategories.id, name: documentCategories.name })
      .from(documentCategories)
      .where(isNull(documentCategories.deletedAt))
      .orderBy(asc(documentCategories.name))
    const types = await tx
      .select({ id: documentTypes.id, name: documentTypes.name })
      .from(documentTypes)
      .where(isNull(documentTypes.deletedAt))
      .orderBy(asc(documentTypes.name))
    return {
      doc,
      versions,
      acks,
      reviews,
      currentPerson: currentPerson[0] ?? null,
      masterAtt: masterAtt[0] ?? null,
      categories,
      types,
    }
  })

  if (!data) notFound()
  const { doc, versions, acks, reviews, currentPerson, masterAtt, categories, types } = data
  // Non-managers may only view PUBLISHED documents — same rule the list page
  // applies via `eq(documents.status, 'published')`.
  if (!canManage && doc.status !== 'published') notFound()
  const currentVersion = versions[0]
  const publishedVersion = versions.find((v) => v.publishedAt) ?? null
  const basePath = `/documents/${id}`

  // Right pane: the inline Writer for authored docs, or the PDF for
  // uploaded-file docs and read-only users.
  const isFileDoc = !doc.sourceAttachmentId && !!currentVersion?.contentAttachmentId
  const canReview = can(ctx, 'documents.review')
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
    signatureUrl: a.r2Key ? publicUrl(a.r2Key) : null,
  }))
  const myAck = currentPerson
    ? acks.find(
        (a) =>
          a.personId === currentPerson.id &&
          (!publishedVersion || a.versionId === publishedVersion.id),
      )
    : null
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
  const obligations = active === 'compliance' ? await loadDocumentObligations(ctx, id) : []

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'document', id, 50) : []

  const todayIso = dateIsoInTz(new Date(), ctx.timezone)
  const isOverdue = doc.nextReviewOn ? doc.nextReviewOn < todayIso : false

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <SmartBackLink
          href="/documents"
          label="Documents"
          className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              {doc.title}
            </span>
            <Badge variant={doc.status === 'published' ? 'success' : 'secondary'}>
              {doc.status}
            </Badge>
            {currentVersion ? <Badge variant="outline">v{currentVersion.version}</Badge> : null}
            {isOverdue ? <Badge variant="destructive">Review overdue</Badge> : null}
          </div>
          <div className="truncate text-xs text-slate-500 dark:text-slate-400">
            {doc.category ?? 'document'} · <span className="font-mono">{doc.key}</span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {canManage ? (
            <>
              <Link
                href={
                  `/documents/${id}?send=1${active !== 'overview' ? `&tab=${active}` : ''}` as any
                }
                scroll={false}
              >
                <Button variant="outline">
                  <Mail size={14} /> Send email
                </Button>
              </Link>
              {doc.status === 'published' ? (
                <form action={unpublish} className="inline">
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="outline">
                    Unpublish
                  </Button>
                </form>
              ) : (
                <form action={publish} className="inline">
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit">
                    <Check size={14} /> Publish
                  </Button>
                </form>
              )}
              <form action={deleteDocument} className="inline">
                <input type="hidden" name="id" value={id} />
                <ConfirmButton
                  message="Delete this document? Readers lose access, it is removed from books, and it disappears from every list. Version history is kept for audit."
                  size="md"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  <Trash2 size={14} /> Delete
                </ConfirmButton>
              </form>
            </>
          ) : null}
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
                  count: versions.length,
                  icon: <History size={16} />,
                },
                {
                  key: 'acknowledgments',
                  label: 'Acknowledgments',
                  count: acks.length,
                  icon: <BadgeCheck size={16} />,
                },
                {
                  key: 'reviews',
                  label: 'Reviews',
                  count: reviews.length,
                  icon: <ClipboardCheck size={16} />,
                },
                { key: 'compliance', label: 'Compliance', icon: <ShieldCheck size={16} /> },
                { key: 'activity', label: 'Activity', icon: <Activity size={16} /> },
              ]}
            />
          </div>
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-4">
            {isOverdue ? (
              <Alert variant="warning" className="mb-4">
                <AlertTitle>Periodic review overdue</AlertTitle>
                <AlertDescription>
                  Due on {doc.nextReviewOn}.
                  {canReview ? (
                    <>
                      {' '}
                      <Link
                        href={`${basePath}?tab=reviews&drawer=record-review`}
                        className="font-medium underline-offset-2 hover:underline"
                      >
                        Record a review →
                      </Link>
                    </>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            {active === 'overview' ? (
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
                      doc.reviewFrequencyMonths != null ? String(doc.reviewFrequencyMonths) : '',
                    nextReviewOn: doc.nextReviewOn ?? '',
                  }}
                />
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle>Document details</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DetailGrid
                      rows={[
                        { label: 'Title', value: doc.title },
                        { label: 'Key', value: doc.key },
                        {
                          label: 'Category',
                          value:
                            (doc.categoryId
                              ? categories.find((c) => c.id === doc.categoryId)?.name
                              : doc.category) ?? '—',
                        },
                        {
                          label: 'Type',
                          value:
                            (doc.typeId ? types.find((t) => t.id === doc.typeId)?.name : null) ??
                            '—',
                        },
                        { label: 'Description', value: doc.description ?? '—' },
                        { label: 'Next review', value: doc.nextReviewOn ?? '—' },
                      ]}
                    />
                  </CardContent>
                </Card>
              )
            ) : null}

            {active === 'versions' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Version history</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {versions.length === 0 ? (
                      <EmptyState
                        icon={<FileText size={24} />}
                        title="No versions"
                        description="Add a draft version below, then publish the document."
                      />
                    ) : (
                      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                        {versions.map((v) => (
                          <li key={v.id} className="py-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">Version {v.version}</span>
                                {v.publishedAt ? (
                                  <Badge variant="success">published</Badge>
                                ) : (
                                  <Badge variant="secondary">draft</Badge>
                                )}
                              </div>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                {v.publishedAt
                                  ? `published ${new Date(v.publishedAt).toLocaleDateString()}`
                                  : `created ${new Date(v.createdAt).toLocaleDateString()}`}
                              </span>
                            </div>
                            {v.changelog ? (
                              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                                {v.changelog}
                              </p>
                            ) : null}
                            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs">
                              {v.pdfAttachmentId || v.contentAttachmentId ? (
                                <a
                                  href={`${basePath}/versions/${v.id}/download`}
                                  className="text-teal-700 hover:underline dark:text-teal-300"
                                >
                                  PDF
                                </a>
                              ) : v.renderStatus === 'pending' ||
                                v.renderStatus === 'processing' ? (
                                <span className="text-slate-400 dark:text-slate-500">
                                  PDF rendering…
                                </span>
                              ) : v.renderStatus === 'failed' ? (
                                <span
                                  className="text-rose-600 dark:text-rose-400"
                                  title={v.renderError ?? undefined}
                                >
                                  PDF render failed
                                </span>
                              ) : null}
                              {v.docxAttachmentId ? (
                                <>
                                  <a
                                    href={`${basePath}/versions/${v.id}/download?kind=docx`}
                                    className="text-teal-700 hover:underline dark:text-teal-300"
                                  >
                                    DOCX
                                  </a>
                                  {canManage ? (
                                    <Link
                                      href={`${basePath}/editor?version=${v.id}`}
                                      className="text-teal-700 hover:underline dark:text-teal-300"
                                    >
                                      Open read-only
                                    </Link>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
                {canManage ? (
                  <div className="flex justify-end">
                    <form action={publish}>
                      <input type="hidden" name="id" value={id} />
                      <Button type="submit">
                        <Check size={14} /> Publish new version
                      </Button>
                    </form>
                  </div>
                ) : null}
              </div>
            ) : null}

            {active === 'acknowledgments' ? (
              <AcknowledgmentsPanel
                documentId={id}
                versionId={publishedVersion?.id ?? null}
                signOffHref={`${basePath}/sign-off`}
                acks={ackRows}
                selfStatus={selfStatus}
                selfAckedAt={selfAckedAt}
                canManageSignOff={canManage}
              />
            ) : null}

            {active === 'compliance' ? (
              <DocumentCompliancePanel
                documentId={id}
                obligations={obligations}
                canAssign={canAssign}
              />
            ) : null}

            {active === 'reviews' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Review history ({reviews.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {reviews.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No reviews recorded.
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                        {reviews.map((row) => (
                          <li key={row.review.id} className="py-3">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">
                                {row.account?.name ?? row.member?.displayName ?? 'Reviewer'}
                              </span>
                              <Badge
                                variant={
                                  row.review.outcome === 'approved_no_change'
                                    ? 'success'
                                    : row.review.outcome === 'updated'
                                      ? 'warning'
                                      : 'destructive'
                                }
                              >
                                {row.review.outcome.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              {new Date(row.review.reviewedAt).toLocaleDateString()}
                              {row.review.nextReviewOn ? ` · next ${row.review.nextReviewOn}` : ''}
                            </div>
                            {row.review.notes ? (
                              <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                                {row.review.notes}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
                {canReview ? (
                  <div className="flex justify-end">
                    <Link href={`${basePath}?tab=reviews&drawer=record-review`}>
                      <Button type="button">
                        <Check size={14} /> Record review
                      </Button>
                    </Link>
                  </div>
                ) : null}
              </div>
            ) : null}

            {active === 'activity' ? (
              <Card>
                <CardHeader>
                  <CardTitle>Activity</CardTitle>
                </CardHeader>
                <CardContent>
                  <ActivityFeed entries={activity} />
                </CardContent>
              </Card>
            ) : null}
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

      {canManage ? (
        <GenericSendEmailDialog
          open={pickString(sp.send) === '1'}
          title="Send document"
          description="Sends the document content and a link to the in-app view to the recipients you enter below."
          reference={doc.key}
          defaultSubjectPrefix="FYI"
          sendAction={async (fd) => {
            'use server'
            fd.set('id', id)
            await sendEmailAction(fd)
          }}
        />
      ) : null}
      {canReview ? (
        <DocumentDrawers
          documentId={id}
          openDrawer={pickString(sp.drawer) === 'record-review' ? 'record-review' : null}
          closeHref={`${basePath}${active === 'overview' ? '' : `?tab=${active}`}`}
          defaultNextReviewOn={doc.nextReviewOn ?? null}
          recordReviewAction={recordReviewAction}
        />
      ) : null}
    </div>
  )
}
