import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Gavel, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Label,
} from '@beaconhs/ui'
import {
  correctiveActions,
  documentManagementReviews,
  documents,
  tenantUsers,
  user as userTable,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { DetailPageLayout } from '@/components/page-layout'
import { ActionItemsPicker, DocumentMultiPicker } from './_components/document-multi-picker'
import { OverviewEditor } from './_components/overview-editor'
import { deleteManagementReviewAndRedirect } from './actions'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'documents', 'decisions', 'action-items'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Management review · ${id.slice(0, 8)}` }
}

export default async function ManagementReviewDetailPage({
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
    const [review] = await tx
      .select()
      .from(documentManagementReviews)
      .where(and(eq(documentManagementReviews.id, id), isNull(documentManagementReviews.deletedAt)))
      .limit(1)
    if (!review) return null

    const [allDocs, allCAs, tenantMembers] = await Promise.all([
      tx
        .select({ id: documents.id, title: documents.title, status: documents.status })
        .from(documents)
        .where(isNull(documents.deletedAt))
        .orderBy(asc(documents.title))
        .limit(500),
      tx
        .select({
          id: correctiveActions.id,
          reference: correctiveActions.reference,
          title: correctiveActions.title,
          status: correctiveActions.status,
        })
        .from(correctiveActions)
        .where(isNull(correctiveActions.deletedAt))
        .orderBy(asc(correctiveActions.reference))
        .limit(500),
      tx
        .select({
          id: tenantUsers.id,
          displayName: tenantUsers.displayName,
          accountName: userTable.name,
          email: userTable.email,
        })
        .from(tenantUsers)
        .leftJoin(userTable, eq(userTable.id, tenantUsers.userId))
        .where(eq(tenantUsers.status, 'active'))
        .orderBy(asc(tenantUsers.displayName)),
    ])

    const reviewedDocs =
      review.documentsReviewed.length > 0
        ? await tx
            .select({ id: documents.id, title: documents.title, status: documents.status })
            .from(documents)
            .where(inArray(documents.id, review.documentsReviewed))
        : []
    const reviewedCAs =
      review.actionItemsCreated.length > 0
        ? await tx
            .select({
              id: correctiveActions.id,
              reference: correctiveActions.reference,
              title: correctiveActions.title,
              status: correctiveActions.status,
            })
            .from(correctiveActions)
            .where(inArray(correctiveActions.id, review.actionItemsCreated))
        : []
    const participantMembers =
      review.participants.length > 0
        ? await tx
            .select({
              id: tenantUsers.id,
              displayName: tenantUsers.displayName,
              accountName: userTable.name,
            })
            .from(tenantUsers)
            .leftJoin(userTable, eq(userTable.id, tenantUsers.userId))
            .where(inArray(tenantUsers.id, review.participants))
        : []

    return { review, allDocs, allCAs, tenantMembers, reviewedDocs, reviewedCAs, participantMembers }
  })

  if (!data) notFound()
  const { review, allDocs, allCAs, tenantMembers, reviewedDocs, reviewedCAs, participantMembers } =
    data
  const basePath = `/documents/management-reviews/${id}`

  const participantNames = review.participants
    .map((pid) => {
      const m = participantMembers.find((t) => t.id === pid)
      return m?.displayName ?? m?.accountName ?? pid.slice(0, 8)
    })
    .join(', ')

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/documents/management-reviews', label: 'Back to reviews' }}
          title={review.title}
          subtitle={`Period: ${review.periodStart ?? '—'} → ${review.periodEnd}`}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                <Gavel size={10} className="mr-1" /> review
              </Badge>
              {review.nextReviewOn ? (
                <Badge variant="outline">next: {review.nextReviewOn}</Badge>
              ) : null}
            </div>
          }
          actions={
            <form action={deleteManagementReviewAndRedirect} className="inline">
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="outline">
                <Trash2 size={14} /> Delete
              </Button>
            </form>
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
            {
              key: 'documents',
              label: 'Documents reviewed',
              count: review.documentsReviewed.length,
            },
            { key: 'decisions', label: 'Decisions' },
            {
              key: 'action-items',
              label: 'Action items',
              count: review.actionItemsCreated.length,
            },
          ]}
        />
      }
    >
      <div className="space-y-5">
        {active === 'overview' ? (
          <>
            <Section title="Summary">
              <DetailGrid
                rows={[
                  { label: 'Title', value: review.title },
                  { label: 'Period start', value: review.periodStart ?? '—' },
                  { label: 'Period end', value: review.periodEnd },
                  { label: 'Next review on', value: review.nextReviewOn ?? '—' },
                  {
                    label: 'Participants',
                    value: review.participants.length
                      ? `${review.participants.length} (${participantNames})`
                      : '—',
                  },
                  {
                    label: 'Documents reviewed',
                    value: `${review.documentsReviewed.length}`,
                  },
                  {
                    label: 'Action items linked',
                    value: `${review.actionItemsCreated.length}`,
                  },
                ]}
              />
            </Section>

            <OverviewEditor
              reviewId={id}
              initial={{
                title: review.title,
                periodStart: review.periodStart ?? '',
                periodEnd: review.periodEnd,
                nextReviewOn: review.nextReviewOn ?? '',
                discussionNotes: review.discussionNotes ?? '',
                decisions: review.decisions ?? '',
                participants: review.participants,
              }}
              members={tenantMembers.map((m) => ({
                id: m.id,
                label: m.displayName ?? m.accountName ?? m.id.slice(0, 8),
                hint: m.email ?? undefined,
              }))}
            />
          </>
        ) : null}

        {active === 'documents' ? (
          <Card>
            <CardHeader>
              <CardTitle>Documents reviewed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <DocumentMultiPicker
                reviewId={id}
                initial={review.documentsReviewed}
                available={allDocs.map((d) => ({ id: d.id, label: `${d.title} (${d.status})` }))}
              />
              {reviewedDocs.length > 0 ? (
                <div className="space-y-2">
                  <Label>Currently saved</Label>
                  <ul className="space-y-1 text-sm">
                    {reviewedDocs.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50/40 px-3 py-1.5"
                      >
                        <Link href={`/documents/${d.id}`} className="text-teal-700 hover:underline">
                          {d.title}
                        </Link>
                        <Badge variant="outline">{d.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {active === 'decisions' ? (
          <Card>
            <CardHeader>
              <CardTitle>Discussion + decisions</CardTitle>
            </CardHeader>
            <CardContent>
              <DecisionsView
                discussionNotes={review.discussionNotes}
                decisions={review.decisions}
              />
            </CardContent>
          </Card>
        ) : null}

        {active === 'action-items' ? (
          <Card>
            <CardHeader>
              <CardTitle>Linked corrective actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ActionItemsPicker
                reviewId={id}
                initial={review.actionItemsCreated}
                available={allCAs.map((ca) => ({
                  id: ca.id,
                  label: `${ca.reference} — ${ca.title} (${ca.status})`,
                }))}
              />
              {reviewedCAs.length > 0 ? (
                <div className="space-y-2">
                  <Label>Currently linked</Label>
                  <ul className="space-y-1 text-sm">
                    {reviewedCAs.map((ca) => (
                      <li
                        key={ca.id}
                        className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50/40 px-3 py-1.5"
                      >
                        <Link
                          href={`/corrective-actions/${ca.id}`}
                          className="text-teal-700 hover:underline"
                        >
                          {ca.reference} · {ca.title}
                        </Link>
                        <Badge variant="outline">{ca.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </DetailPageLayout>
  )
}

function DecisionsView({
  discussionNotes,
  decisions,
}: {
  discussionNotes: string | null
  decisions: string | null
}) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <Label>Discussion notes</Label>
        {discussionNotes ? (
          <pre className="mt-1 rounded-md border border-slate-200 bg-slate-50/50 p-3 text-sm whitespace-pre-wrap text-slate-800">
            {discussionNotes}
          </pre>
        ) : (
          <p className="text-sm text-slate-500">No discussion notes captured.</p>
        )}
      </div>
      <div>
        <Label>Decisions / outcomes</Label>
        {decisions ? (
          <pre className="mt-1 rounded-md border border-slate-200 bg-slate-50/50 p-3 text-sm whitespace-pre-wrap text-slate-800">
            {decisions}
          </pre>
        ) : (
          <p className="text-sm text-slate-500">No decisions captured.</p>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Edit discussion notes and decisions from the Overview tab.
      </p>
    </div>
  )
}
