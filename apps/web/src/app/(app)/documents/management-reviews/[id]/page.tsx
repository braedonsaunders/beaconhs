import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq, inArray, isNull } from 'drizzle-orm'
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
  documentManagementReviewDocuments,
  documentManagementReviews,
  documentVersions,
  documents,
  tenantUsers,
  users as userTable,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { DetailPageLayout } from '@/components/page-layout'
import { isUuid } from '@/lib/list-params'
import { ActionItemsPicker, DocumentMultiPicker } from './_components/document-multi-picker'
import { OverviewEditor } from './_components/overview-editor'
import { deleteManagementReviewAndRedirect } from './actions'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'documents', 'decisions', 'action-items'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_058fb8c62dfce5', { value0: id.slice(0, 8) }) }
}

export default async function ManagementReviewDetailPage({
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
  // Board-level discussion notes, decisions, and the member directory are a
  // manage-only surface — mirrors the list page and every write action.
  if (!can(ctx, 'documents.manage')) notFound()

  const data = await ctx.db(async (tx) => {
    const [review] = await tx
      .select()
      .from(documentManagementReviews)
      .where(and(eq(documentManagementReviews.id, id), isNull(documentManagementReviews.deletedAt)))
      .limit(1)
    if (!review) return null

    const reviewedDocs = await tx
      .select({
        id: documents.id,
        title: documents.title,
        status: documents.status,
        documentVersionId: documentVersions.id,
        version: documentVersions.version,
      })
      .from(documentManagementReviewDocuments)
      .innerJoin(
        documents,
        and(
          eq(documents.tenantId, documentManagementReviewDocuments.tenantId),
          eq(documents.id, documentManagementReviewDocuments.documentId),
        ),
      )
      .innerJoin(
        documentVersions,
        and(
          eq(documentVersions.tenantId, documentManagementReviewDocuments.tenantId),
          eq(documentVersions.documentId, documentManagementReviewDocuments.documentId),
          eq(documentVersions.id, documentManagementReviewDocuments.documentVersionId),
        ),
      )
      .where(
        and(
          eq(documentManagementReviewDocuments.tenantId, ctx.tenantId),
          eq(documentManagementReviewDocuments.managementReviewId, id),
        ),
      )
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

    return { review, reviewedDocs, reviewedCAs, participantMembers }
  })

  if (!data) notFound()
  const { review, reviewedDocs, reviewedCAs, participantMembers } = data
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
          title={tGeneratedValue(review.title)}
          subtitle={tGenerated('m_03b7d2341ad281', {
            value0: review.periodStart ?? '—',
            value1: review.periodEnd,
          })}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant="secondary">
                <Gavel size={10} className="mr-1" /> <GeneratedText id="m_1c39984a4260aa" />
              </Badge>
              <GeneratedValue
                value={
                  review.nextReviewOn ? (
                    <Badge variant="outline">
                      <GeneratedText id="m_1bb70a21a912c1" />{' '}
                      <GeneratedValue value={review.nextReviewOn} />
                    </Badge>
                  ) : null
                }
              />
            </div>
          }
          actions={
            <form action={deleteManagementReviewAndRedirect} className="inline">
              <input type="hidden" name="id" value={id} />
              <Button type="submit" variant="outline">
                <Trash2 size={14} /> <GeneratedText id="m_11773f3c3f7558" />
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
              count: reviewedDocs.length,
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
        <GeneratedValue
          value={
            active === 'overview' ? (
              <>
                <Section title={tGenerated('m_031c356c80b70f')}>
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
                        value: `${reviewedDocs.length}`,
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
                  members={participantMembers.map((m) => ({
                    id: m.id,
                    label: m.displayName ?? m.accountName ?? m.id.slice(0, 8),
                  }))}
                />
              </>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'documents' ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_1e8c4796a4ec7d" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <DocumentMultiPicker
                    reviewId={id}
                    initial={reviewedDocs.map((document) => document.id)}
                    available={reviewedDocs.map((d) => ({
                      id: d.id,
                      label: `${d.title} (v${d.version})`,
                    }))}
                  />
                  <GeneratedValue
                    value={
                      reviewedDocs.length > 0 ? (
                        <div className="space-y-2">
                          <Label>
                            <GeneratedText id="m_0942c87bbaebd9" />
                          </Label>
                          <ul className="space-y-1 text-sm">
                            <GeneratedValue
                              value={reviewedDocs.map((d) => (
                                <li
                                  key={d.id}
                                  className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50/40 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900/40"
                                >
                                  <Link
                                    href={`/documents/${d.id}`}
                                    className="text-teal-700 hover:underline dark:text-teal-400"
                                  >
                                    <GeneratedValue value={d.title} />{' '}
                                    <GeneratedText id="m_03cf121dcd22e3" />
                                    <GeneratedValue value={d.version} />
                                  </Link>
                                  <Badge variant="outline">
                                    <GeneratedValue value={d.status} />
                                  </Badge>
                                </li>
                              ))}
                            />
                          </ul>
                        </div>
                      ) : null
                    }
                  />
                </CardContent>
              </Card>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'decisions' ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_1e2f0d17292ecf" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DecisionsView
                    discussionNotes={review.discussionNotes}
                    decisions={review.decisions}
                  />
                </CardContent>
              </Card>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'action-items' ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    <GeneratedText id="m_0a0b2d1cbc1963" />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ActionItemsPicker
                    reviewId={id}
                    initial={review.actionItemsCreated}
                    available={reviewedCAs.map((ca) => ({
                      id: ca.id,
                      label: `${ca.reference} — ${ca.title} (${ca.status})`,
                    }))}
                  />
                  <GeneratedValue
                    value={
                      reviewedCAs.length > 0 ? (
                        <div className="space-y-2">
                          <Label>
                            <GeneratedText id="m_0ed96cdd625359" />
                          </Label>
                          <ul className="space-y-1 text-sm">
                            <GeneratedValue
                              value={reviewedCAs.map((ca) => (
                                <li
                                  key={ca.id}
                                  className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50/40 px-3 py-1.5 dark:border-slate-800 dark:bg-slate-900/40"
                                >
                                  <Link
                                    href={`/corrective-actions/${ca.id}`}
                                    className="text-teal-700 hover:underline dark:text-teal-400"
                                  >
                                    <GeneratedValue value={ca.reference} /> ·{' '}
                                    <GeneratedValue value={ca.title} />
                                  </Link>
                                  <Badge variant="outline">
                                    <GeneratedValue value={ca.status} />
                                  </Badge>
                                </li>
                              ))}
                            />
                          </ul>
                        </div>
                      ) : null
                    }
                  />
                </CardContent>
              </Card>
            ) : null
          }
        />
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
        <Label>
          <GeneratedText id="m_03daa461b09c21" />
        </Label>
        <GeneratedValue
          value={
            discussionNotes ? (
              <pre className="mt-1 rounded-md border border-slate-200 bg-slate-50/50 p-3 text-sm whitespace-pre-wrap text-slate-800 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200">
                {discussionNotes}
              </pre>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_1f54e243d87eaf" />
              </p>
            )
          }
        />
      </div>
      <div>
        <Label>
          <GeneratedText id="m_1c33c753a806d2" />
        </Label>
        <GeneratedValue
          value={
            decisions ? (
              <pre className="mt-1 rounded-md border border-slate-200 bg-slate-50/50 p-3 text-sm whitespace-pre-wrap text-slate-800 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200">
                {decisions}
              </pre>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_0533cb62bd7427" />
              </p>
            )
          }
        />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_001269e026b542" />
      </p>
    </div>
  )
}
