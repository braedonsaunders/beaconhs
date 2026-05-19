import Link from 'next/link'
import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { asc, desc, eq } from 'drizzle-orm'
import { Check, FileText, Plus } from 'lucide-react'
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
  Textarea,
} from '@beaconhs/ui'
import {
  documentAcknowledgments,
  documentReviews,
  documentVersions,
  documents,
  people,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recentActivityForEntity, recordAudit } from '@/lib/audit'
import { ActivityFeed } from '@/components/activity-feed'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { DetailPageLayout } from '@/components/page-layout'

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
  const ctx = await requireRequestContext()
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db(async (tx) => {
    await tx.update(documents).set({ status: 'published' }).where(eq(documents.id, id))
    // Mark the latest version as published if not yet
    const [latest] = await tx
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, id))
      .orderBy(desc(documentVersions.version))
      .limit(1)
    if (latest && !latest.publishedAt) {
      await tx
        .update(documentVersions)
        .set({ publishedAt: new Date(), publishedBy: ctx.userId })
        .where(eq(documentVersions.id, latest.id))
    }
  })
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: id,
    action: 'publish',
    summary: 'Document published',
  })
  revalidatePath(`/documents/${id}`)
  revalidatePath('/documents')
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

async function recordReview(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const documentId = String(formData.get('documentId') ?? '')
  const outcome = String(formData.get('outcome') ?? '') as
    | 'approved_no_change'
    | 'updated'
    | 'retired'
  const notes = String(formData.get('notes') ?? '').trim() || null
  const nextReviewOnRaw = String(formData.get('nextReviewOn') ?? '').trim() || null
  if (!documentId || !outcome) return
  if (!ctx.membership?.id) return

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
}

async function newVersion(formData: FormData) {
  'use server'
  const ctx = await requireRequestContext()
  const documentId = String(formData.get('documentId') ?? '')
  const changelog = String(formData.get('changelog') ?? '').trim() || null
  const contentMarkdown = String(formData.get('contentMarkdown') ?? '').trim() || null
  if (!documentId) return

  await ctx.db(async (tx) => {
    const [latest] = await tx
      .select({ version: documentVersions.version })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.version))
      .limit(1)
    const nextNumber = (latest?.version ?? 0) + 1
    await tx.insert(documentVersions).values({
      tenantId: ctx.tenantId,
      documentId,
      version: nextNumber,
      changelog,
      contentMarkdown,
      // publishedAt left null = draft
    })
    // Move the document back to draft status until the new version is published
    await tx
      .update(documents)
      .set({ status: 'draft' })
      .where(eq(documents.id, documentId))
  })
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: documentId,
    action: 'create',
    summary: 'New draft version created',
    after: { changelog },
  })
  revalidatePath(`/documents/${documentId}`)
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
    const [versions, acks, reviews, currentPerson] = await Promise.all([
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
    ])
    return { doc, versions, acks, reviews, currentPerson: currentPerson[0] ?? null }
  })

  if (!data) notFound()
  const { doc, versions, acks, reviews, currentPerson } = data
  const currentVersion = versions[0]
  const publishedVersion = versions.find((v) => v.publishedAt) ?? null
  const basePath = `/documents/${id}`

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
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/documents', label: 'Back to documents' }}
          title={doc.title}
          subtitle={`${doc.category ?? 'document'} · ${doc.key}`}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={doc.status === 'published' ? 'success' : 'secondary'}>
                {doc.status}
              </Badge>
              {currentVersion ? <Badge variant="outline">v{currentVersion.version}</Badge> : null}
              {isOverdue ? <Badge variant="destructive">Review overdue</Badge> : null}
            </div>
          }
          actions={
            <>
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
            </>
          }
        />
      }
      alerts={
        isOverdue ? (
          <Alert variant="warning">
            <AlertTitle>Periodic review overdue</AlertTitle>
            <AlertDescription>
              This document was due for review on {doc.nextReviewOn}. Record a review on the Reviews
              tab.
            </AlertDescription>
          </Alert>
        ) : null
      }
      subtabs={
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'versions', label: 'Versions', count: versions.length },
            { key: 'acknowledgments', label: 'Acknowledgments', count: acks.length },
            { key: 'reviews', label: 'Reviews', count: reviews.length },
            { key: 'activity', label: 'Activity' },
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
                  { label: 'Title', value: doc.title },
                  { label: 'Key', value: <span className="font-mono">{doc.key}</span> },
                  { label: 'Category', value: doc.category ?? '—' },
                  { label: 'Status', value: doc.status },
                  {
                    label: 'Review every',
                    value: doc.reviewFrequencyMonths ? `${doc.reviewFrequencyMonths} months` : '—',
                  },
                  {
                    label: 'Next review on',
                    value: doc.nextReviewOn ? (
                      <span className={isOverdue ? 'font-medium text-red-700' : ''}>
                        {doc.nextReviewOn}
                      </span>
                    ) : (
                      '—'
                    ),
                  },
                  { label: 'Print header', value: doc.printHeader ? 'Yes' : 'No' },
                  { label: 'Print footer', value: doc.printFooter ? 'Yes' : 'No' },
                ]}
              />
            </Section>
            {currentVersion?.contentMarkdown ? (
              <Section title={`Content (v${currentVersion.version})`}>
                <pre className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50/50 p-4 text-sm text-slate-800">
                  {currentVersion.contentMarkdown}
                </pre>
              </Section>
            ) : null}
          </>
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
                  <ul className="divide-y divide-slate-100 text-sm">
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
                          <span className="text-xs text-slate-500">
                            {v.publishedAt
                              ? `published ${new Date(v.publishedAt).toLocaleDateString()}`
                              : `created ${new Date(v.createdAt).toLocaleDateString()}`}
                          </span>
                        </div>
                        {v.changelog ? (
                          <p className="mt-1 text-xs text-slate-600">{v.changelog}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Section title="Create a new draft version">
              <form action={newVersion} className="space-y-3 text-sm">
                <input type="hidden" name="documentId" value={id} />
                <Field label="Changelog">
                  <Input
                    name="changelog"
                    placeholder="e.g. Updated PPE section per new ANSI standard"
                  />
                </Field>
                <Field label="Content (markdown, optional)">
                  <Textarea name="contentMarkdown" rows={6} placeholder="# Document body…" />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit">
                    <Plus size={14} /> Create draft
                  </Button>
                </div>
              </form>
            </Section>
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
                    <form action={acknowledge} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                      <span>By acknowledging you confirm you've read and understood this document.</span>
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
                  <p className="text-sm text-slate-500">No-one has acknowledged this yet.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {acks.map((row) => (
                      <li key={row.ack.id} className="flex items-center justify-between py-2">
                        <Link
                          href={`/people/${row.person.id}`}
                          className="font-medium hover:underline"
                        >
                          {row.person.firstName} {row.person.lastName}
                        </Link>
                        <span className="text-xs text-slate-500">
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
                  <p className="text-sm text-slate-500">No reviews recorded.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
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
                        <div className="mt-0.5 text-xs text-slate-500">
                          {new Date(row.review.reviewedAt).toLocaleDateString()}
                          {row.review.nextReviewOn ? ` · next ${row.review.nextReviewOn}` : ''}
                        </div>
                        {row.review.notes ? (
                          <p className="mt-1 text-sm text-slate-700">{row.review.notes}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Section title="Record a new review">
              <form action={recordReview} className="space-y-3 text-sm">
                <input type="hidden" name="documentId" value={id} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Outcome" required>
                    <Select name="outcome" required defaultValue="approved_no_change">
                      <option value="approved_no_change">Approved — no change</option>
                      <option value="updated">Updated</option>
                      <option value="retired">Retired</option>
                    </Select>
                  </Field>
                  <Field label="Next review on">
                    <Input
                      name="nextReviewOn"
                      type="date"
                      defaultValue={doc.nextReviewOn ?? ''}
                    />
                  </Field>
                  <Field label="Notes" className="sm:col-span-2">
                    <Textarea name="notes" rows={3} placeholder="What did you change?" />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <Button type="submit">
                    <Check size={14} /> Record review
                  </Button>
                </div>
              </form>
            </Section>
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
