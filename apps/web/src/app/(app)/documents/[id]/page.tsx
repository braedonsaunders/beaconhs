import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, desc, eq, isNull } from 'drizzle-orm'
import {
  Activity,
  BadgeCheck,
  Check,
  ClipboardCheck,
  FileText,
  History,
  Info,
  Mail,
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
  documentAcknowledgments,
  documentCategories,
  documentDrafts,
  documentReviews,
  documentTypes,
  documentVersions,
  documents,
  people,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiSettings } from '@/lib/ai-config'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { pickString } from '@/lib/list-params'
import { ActivityFeed } from '@/components/activity-feed'
import { DocumentOverview } from './_overview'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { GenericSendEmailDialog } from '@/components/send-email-dialog'
import { sendDocumentEmail } from './_send-email'
import { listDocumentComments, publishDraft } from './_actions'
import { DocumentPdfButton } from './_pdf-viewer'
import { DocumentPane } from './_document-pane'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'versions', 'acknowledgments', 'reviews', 'activity'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Document · ${id.slice(0, 8)}` }
}

// ---------- Server actions ----------

async function publish(formData: FormData) {
  'use server'
  const id = String(formData.get('id') ?? '')
  if (!id) return
  // Snapshots the live draft into an immutable version (or publishes the latest
  // existing version for legacy / uploaded-file documents). Handles audit +
  // revalidate + PDF re-render internally.
  await publishDraft({ documentId: id })
}

async function unpublish(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
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

async function acknowledge(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const documentId = String(formData.get('documentId') ?? '')
  const versionId = String(formData.get('versionId') ?? '')
  if (!documentId || !versionId) return

  // Find the person record for the current user
  const person = await ctx.db(async (tx) => {
    const [p] = await tx.select().from(people).where(eq(people.userId, ctx.userId)).limit(1)
    return p ?? null
  })
  if (!person) return

  // Skip if already acked for this version
  const existing = await ctx.db(async (tx) => {
    const [e] = await tx
      .select()
      .from(documentAcknowledgments)
      .where(eq(documentAcknowledgments.documentId, documentId))
      .limit(1)
    return e
  })

  if (existing && existing.versionId === versionId && existing.personId === person.id) {
    return
  }

  await ctx.db((tx) =>
    tx.insert(documentAcknowledgments).values({
      tenantId: ctx.tenantId,
      documentId,
      versionId,
      personId: person.id,
    }),
  )
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: documentId,
    action: 'sign',
    summary: 'Acknowledged by current user',
    after: { personId: person.id, versionId },
  })
  revalidatePath(`/documents/${documentId}`)
}

async function recordReviewAction(input: {
  documentId: string
  outcome: 'approved_no_change' | 'updated' | 'retired'
  notes: string | null
  nextReviewOn: string | null
}): Promise<{ ok: boolean; error?: string }> {
  'use server'
  const ctx = await requireRequestContext()
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
        const dateStr = next.toISOString().slice(0, 10)
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
  const data = await ctx.db(async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, id)).limit(1)
    if (!doc) return null
    const [versions, acks, reviews, currentPerson, draft] = await Promise.all([
      tx
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.documentId, id))
        .orderBy(desc(documentVersions.version)),
      tx
        .select({ ack: documentAcknowledgments, person: people })
        .from(documentAcknowledgments)
        .innerJoin(people, eq(people.id, documentAcknowledgments.personId))
        .where(eq(documentAcknowledgments.documentId, id))
        .orderBy(desc(documentAcknowledgments.acknowledgedAt)),
      tx
        .select({ review: documentReviews, member: tenantUsers, account: user })
        .from(documentReviews)
        .leftJoin(tenantUsers, eq(tenantUsers.id, documentReviews.reviewedByTenantUserId))
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(eq(documentReviews.documentId, id))
        .orderBy(desc(documentReviews.reviewedAt)),
      tx.select().from(people).where(eq(people.userId, ctx.userId)).limit(1),
      tx.select().from(documentDrafts).where(eq(documentDrafts.documentId, id)).limit(1),
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
      draft: draft[0] ?? null,
      categories,
      types,
    }
  })

  if (!data) notFound()
  const { doc, versions, acks, reviews, currentPerson, draft, categories, types } = data
  const currentVersion = versions[0]
  const publishedVersion = versions.find((v) => v.publishedAt) ?? null
  const basePath = `/documents/${id}`

  // Right pane: the live editor for in-app docs, or the PDF for uploaded-file docs.
  const isFileDoc = !draft && !!currentVersion?.contentAttachmentId
  const initialJson = (draft?.contentJson ?? publishedVersion?.contentJson ?? null) as Record<
    string,
    unknown
  > | null
  const initialHtml = draft?.contentHtml ?? publishedVersion?.contentMarkdown ?? ''
  const initialLayout = {
    pageSize: (doc.pageSize === 'A4' ? 'A4' : 'Letter') as 'Letter' | 'A4',
    headerText: doc.headerText ?? '',
    footerText: doc.footerText ?? '',
    printHeader: doc.printHeader,
    printFooter: doc.printFooter,
  }
  const comments = isFileDoc ? [] : await listDocumentComments(id)
  const aiSettings = await getTenantAiSettings(ctx)
  const aiEnabled = aiSettings.enabled && aiSettings.hasKey

  const myAck = currentPerson
    ? acks.find(
        (a) =>
          a.ack.personId === currentPerson.id &&
          (!publishedVersion || a.ack.versionId === publishedVersion.id),
      )
    : null

  const activity =
    active === 'activity' ? await recentActivityForEntity(ctx, 'document', id, 50) : []

  const todayIso = new Date().toISOString().slice(0, 10)
  const isOverdue = doc.nextReviewOn ? doc.nextReviewOn < todayIso : false

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-900">
        <Link
          href="/documents"
          className="shrink-0 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Documents
        </Link>
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
          <DocumentPdfButton documentId={id} />
          <Link
            href={`/documents/${id}?send=1${active !== 'overview' ? `&tab=${active}` : ''}` as any}
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
                { key: 'activity', label: 'Activity', icon: <Activity size={16} /> },
              ]}
            />
          </div>
          <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-4">
            {isOverdue ? (
              <Alert variant="warning" className="mb-4">
                <AlertTitle>Periodic review overdue</AlertTitle>
                <AlertDescription>
                  Due on {doc.nextReviewOn}.{' '}
                  <Link
                    href={`${basePath}?tab=reviews&drawer=record-review`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    Record a review →
                  </Link>
                </AlertDescription>
              </Alert>
            ) : null}

            {active === 'overview' ? (
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
                  pageSize: doc.pageSize === 'A4' ? 'A4' : 'Letter',
                  printHeader: doc.printHeader,
                  printFooter: doc.printFooter,
                  headerText: doc.headerText ?? '',
                  footerText: doc.footerText ?? '',
                }}
              />
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
                        title="No versions yet"
                        description="Add a draft version below — once it's filled out, publish the document."
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
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
                <div className="flex justify-end">
                  <form action={publish}>
                    <input type="hidden" name="id" value={id} />
                    <Button type="submit">
                      <Check size={14} /> Publish new version
                    </Button>
                  </form>
                </div>
              </div>
            ) : null}

            {active === 'acknowledgments' ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Acknowledgments ({acks.length})</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {currentPerson ? (
                      myAck ? (
                        <Alert variant="success">
                          <Check size={16} />
                          <AlertTitle>You've acknowledged this</AlertTitle>
                          <AlertDescription>
                            Recorded {new Date(myAck.ack.acknowledgedAt).toLocaleString()}.
                          </AlertDescription>
                        </Alert>
                      ) : publishedVersion ? (
                        <form
                          action={acknowledge}
                          className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-900"
                        >
                          <span>
                            By acknowledging you confirm you've read and understood this document.
                          </span>
                          <input type="hidden" name="documentId" value={id} />
                          <input type="hidden" name="versionId" value={publishedVersion.id} />
                          <Button type="submit">
                            <Check size={14} /> Acknowledge
                          </Button>
                        </form>
                      ) : (
                        <Alert variant="warning">
                          <AlertTitle>Not yet published</AlertTitle>
                          <AlertDescription>
                            Publish a version of this document before users can acknowledge it.
                          </AlertDescription>
                        </Alert>
                      )
                    ) : (
                      <Alert variant="warning">
                        <AlertTitle>Your account isn't linked to a person record</AlertTitle>
                        <AlertDescription>
                          Acknowledgments require a person record in the directory.
                        </AlertDescription>
                      </Alert>
                    )}

                    {acks.length === 0 ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        No-one has acknowledged this yet.
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                        {acks.map((row) => (
                          <li key={row.ack.id} className="flex items-center justify-between py-2">
                            <Link
                              href={`/people/${row.person.id}`}
                              className="font-medium hover:underline"
                            >
                              {row.person.firstName} {row.person.lastName}
                            </Link>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {new Date(row.ack.acknowledgedAt).toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </div>
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
                <div className="flex justify-end">
                  <Link href={`${basePath}?tab=reviews&drawer=record-review`}>
                    <Button type="button">
                      <Check size={14} /> Record review
                    </Button>
                  </Link>
                </div>
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

        {/* Right pane: the live editor, or the PDF for uploaded-file documents */}
        <div className="min-h-0 flex-1">
          <DocumentPane
            documentId={id}
            defaultMode={isFileDoc ? 'pdf' : 'write'}
            initialTitle={doc.title}
            initialHtml={initialHtml}
            initialJson={initialJson}
            initialLayout={initialLayout}
            initialComments={comments}
            aiEnabled={aiEnabled}
          />
        </div>
      </div>

      <GenericSendEmailDialog
        open={pickString(sp.send) === '1'}
        title="Send document"
        description="Sends the document content + a link to the in-app view. Defaults to the tenant admin distribution list when no recipients are specified."
        reference={doc.key}
        defaultSubjectPrefix="FYI"
        sendAction={async (fd) => {
          'use server'
          fd.set('id', id)
          await sendEmailAction(fd)
        }}
      />
      <DocumentDrawers
        documentId={id}
        openDrawer={pickString(sp.drawer) === 'record-review' ? 'record-review' : null}
        closeHref={`${basePath}${active === 'overview' ? '' : `?tab=${active}`}`}
        defaultNextReviewOn={doc.nextReviewOn ?? null}
        recordReviewAction={recordReviewAction}
      />
    </div>
  )
}
