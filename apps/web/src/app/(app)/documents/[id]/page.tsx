import Link from 'next/link'
import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { FileText } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
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
import { DetailGrid } from '@/components/detail-grid'
import { Section } from '@/components/section'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { PageContainer } from '@/components/page-layout'

export const dynamic = 'force-dynamic'

const TABS = ['overview', 'versions', 'acknowledgments', 'reviews'] as const
type Tab = (typeof TABS)[number]

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Document · ${id.slice(0, 8)}` }
}

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
    const [versions, acks, reviews] = await Promise.all([
      tx.select().from(documentVersions).where(eq(documentVersions.documentId, id)).orderBy(desc(documentVersions.version)),
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
    ])
    return { doc, versions, acks, reviews }
  })

  if (!data) notFound()
  const { doc, versions, acks, reviews } = data
  const currentVersion = versions[0]
  const basePath = `/documents/${id}`

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/documents', label: 'Back to documents' }}
          title={doc.title}
          subtitle={`${doc.category ?? 'document'} · ${doc.key}`}
          badge={
            <div className="flex items-center gap-2">
              <Badge variant={doc.status === 'published' ? 'success' : 'secondary'}>{doc.status}</Badge>
              {currentVersion ? <Badge variant="outline">v{currentVersion.version}</Badge> : null}
            </div>
          }
          actions={
            <>
              <Button variant="outline">
                <FileText size={14} /> PDF
              </Button>
              {doc.status === 'published' ? (
                <Button variant="outline">Unpublish</Button>
              ) : (
                <Button variant="outline">Publish</Button>
              )}
            </>
          }
        />

        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'versions', label: 'Versions', count: versions.length },
            { key: 'acknowledgments', label: 'Acknowledgments', count: acks.length },
            { key: 'reviews', label: 'Reviews', count: reviews.length },
          ]}
        />

        {active === 'overview' ? (
          <>
            <Section title="General">
              <DetailGrid
                rows={[
                  { label: 'Title', value: doc.title },
                  { label: 'Key', value: <span className="font-mono">{doc.key}</span> },
                  { label: 'Category', value: doc.category ?? '—' },
                  { label: 'Status', value: doc.status },
                  { label: 'Review every', value: doc.reviewFrequencyMonths ? `${doc.reviewFrequencyMonths} months` : '—' },
                  { label: 'Next review on', value: doc.nextReviewOn ?? '—' },
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
          <Card>
            <CardHeader>
              <CardTitle>Version history</CardTitle>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <p className="text-sm text-slate-500">No versions yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {versions.map((v) => (
                    <li key={v.id} className="py-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Version {v.version}</span>
                        <span className="text-xs text-slate-500">
                          {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : 'unpublished'}
                        </span>
                      </div>
                      {v.changelog ? <p className="mt-1 text-xs text-slate-600">{v.changelog}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}

        {active === 'acknowledgments' ? (
          <Card>
            <CardHeader>
              <CardTitle>Acknowledgments ({acks.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {acks.length === 0 ? (
                <p className="text-sm text-slate-500">No-one has acknowledged this yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {acks.map((row) => (
                    <li key={row.ack.id} className="flex items-center justify-between py-2">
                      <Link href={`/people/${row.person.id}`} className="font-medium hover:underline">
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
        ) : null}

        {active === 'reviews' ? (
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
                        <span className="font-medium">{row.account?.name ?? row.member?.displayName ?? 'Reviewer'}</span>
                        <Badge variant={row.review.outcome === 'approved_no_change' ? 'success' : row.review.outcome === 'updated' ? 'warning' : 'destructive'}>
                          {row.review.outcome.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {new Date(row.review.reviewedAt).toLocaleDateString()}
                        {row.review.nextReviewOn ? ` · next ${row.review.nextReviewOn}` : ''}
                      </div>
                      {row.review.notes ? <p className="mt-1 text-sm text-slate-700">{row.review.notes}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageContainer>
  )
}
