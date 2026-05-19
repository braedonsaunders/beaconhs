// "My acknowledgments" — documents this user has, or has not, acknowledged.
//
// We treat every published document as something a tenant member could be
// expected to read, then split rows into "outstanding" (no ack at the latest
// published version) and "acknowledged" (ack exists, possibly for an older
// version which gets called out).
//
// The narrower "what's explicitly assigned to me" view would require resolving
// document_assignment_audience entries against the user's role + trade +
// department; that lives behind the regular /documents/assignments listing.
// Here we lean on the everyone-reads-published-docs default so the page is
// useful even before assignments are wired up.

import Link from 'next/link'
import { BookCheck, BookOpen, CheckCircle2 } from 'lucide-react'
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  documentAcknowledgments,
  documentVersions,
  documents,
  people,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { SearchInput } from '@/components/search-input'
import { parseListParams } from '@/lib/list-params'

export const metadata = { title: 'My acknowledgments' }
export const dynamic = 'force-dynamic'

const TABS = ['outstanding', 'acknowledged'] as const
type Tab = (typeof TABS)[number]

type DocRow = {
  docId: string
  title: string
  key: string
  category: string | null
  status: string
  latestVersionId: string | null
  latestVersionNum: number | null
  latestPublishedAt: Date | null
  myAckVersionId: string | null
  myAckAt: Date | null
}

export default async function MyAcknowledgmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const tab: Tab = pickActiveTab(sp, TABS, 'outstanding')
  const params = parseListParams(sp, {
    sort: 'title',
    dir: 'asc',
    perPage: 50,
    allowedSorts: ['title'] as const,
  })

  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.userId, ctx.userId))
      .limit(1)
    const personId = person?.id ?? null

    if (!personId) {
      return {
        personId,
        outstanding: [] as DocRow[],
        acknowledged: [] as DocRow[],
      }
    }

    // ---- All published documents (paged, searchable) -------------------
    const docFilters: SQL<unknown>[] = [
      eq(documents.status, 'published'),
      isNull(documents.deletedAt),
    ]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(documents.title, term), ilike(documents.key, term))
      if (cond) docFilters.push(cond)
    }
    const docRows = await tx
      .select({
        id: documents.id,
        title: documents.title,
        key: documents.key,
        category: documents.category,
        status: documents.status,
      })
      .from(documents)
      .where(and(...docFilters))
      .orderBy(params.dir === 'desc' ? desc(documents.title) : asc(documents.title))

    if (docRows.length === 0) {
      return { personId, outstanding: [], acknowledged: [] }
    }

    const docIds = docRows.map((d) => d.id)

    // ---- Latest version per document (published preferred) -------------
    // We pick the highest version number that has a publishedAt set; falling
    // back to the highest version row regardless if no published version
    // exists.
    const versions = await tx
      .select({
        documentId: documentVersions.documentId,
        id: documentVersions.id,
        version: documentVersions.version,
        publishedAt: documentVersions.publishedAt,
      })
      .from(documentVersions)
      .where(sql`${documentVersions.documentId} = ANY(${docIds})`)
      .orderBy(desc(documentVersions.version))

    const latestByDoc = new Map<
      string,
      { id: string; version: number; publishedAt: Date | null }
    >()
    for (const v of versions) {
      const cur = latestByDoc.get(v.documentId)
      if (!cur) {
        latestByDoc.set(v.documentId, {
          id: v.id,
          version: v.version,
          publishedAt: v.publishedAt,
        })
      }
    }

    // ---- This person's acknowledgments (latest per doc) ----------------
    const acks = await tx
      .select({
        documentId: documentAcknowledgments.documentId,
        versionId: documentAcknowledgments.versionId,
        acknowledgedAt: documentAcknowledgments.acknowledgedAt,
      })
      .from(documentAcknowledgments)
      .where(
        and(
          eq(documentAcknowledgments.personId, personId),
          sql`${documentAcknowledgments.documentId} = ANY(${docIds})`,
        ),
      )
      .orderBy(desc(documentAcknowledgments.acknowledgedAt))

    const ackByDoc = new Map<string, { versionId: string; acknowledgedAt: Date }>()
    for (const a of acks) {
      if (!ackByDoc.has(a.documentId)) {
        ackByDoc.set(a.documentId, { versionId: a.versionId, acknowledgedAt: a.acknowledgedAt })
      }
    }

    const merged: DocRow[] = docRows.map((d) => {
      const latest = latestByDoc.get(d.id)
      const myAck = ackByDoc.get(d.id)
      return {
        docId: d.id,
        title: d.title,
        key: d.key,
        category: d.category,
        status: d.status,
        latestVersionId: latest?.id ?? null,
        latestVersionNum: latest?.version ?? null,
        latestPublishedAt: latest?.publishedAt ?? null,
        myAckVersionId: myAck?.versionId ?? null,
        myAckAt: myAck?.acknowledgedAt ?? null,
      }
    })

    // ---- Split into outstanding vs acknowledged ------------------------
    const outstanding = merged.filter(
      (r) => !r.myAckVersionId || r.myAckVersionId !== r.latestVersionId,
    )
    const acknowledged = merged.filter(
      (r) => r.myAckVersionId && r.myAckVersionId === r.latestVersionId,
    )

    return { personId, outstanding, acknowledged }
  })

  if (!data.personId) {
    return (
      <ListPageLayout
        header={
          <PageHeader
            title="My acknowledgments"
            description="Documents you've read & signed."
          />
        }
      >
        <EmptyState
          icon={<BookOpen size={32} />}
          title="No person record linked to your account"
          description="Ask an administrator to link your user account to a person record so we can track your document acknowledgments."
        />
      </ListPageLayout>
    )
  }

  const active = tab === 'outstanding' ? data.outstanding : data.acknowledged
  const counts = {
    outstanding: data.outstanding.length,
    acknowledged: data.acknowledged.length,
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="My acknowledgments"
            description="Documents you have, or have not, acknowledged."
            actions={
              <Link href="/documents">
                <Button variant="outline">All documents</Button>
              </Link>
            }
          />
          <TabNav
            basePath="/my/acknowledgments"
            currentParams={sp}
            active={tab}
            tabs={[
              { key: 'outstanding', label: 'Outstanding', count: counts.outstanding },
              { key: 'acknowledged', label: 'Acknowledged', count: counts.acknowledged },
            ]}
          />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search documents…" />
          </div>
        </>
      }
    >
      {active.length === 0 ? (
        <EmptyState
          icon={tab === 'outstanding' ? <CheckCircle2 size={32} /> : <BookCheck size={32} />}
          title={
            tab === 'outstanding'
              ? 'You are caught up. No outstanding documents.'
              : 'No acknowledgments captured yet'
          }
          description={
            tab === 'outstanding'
              ? 'Documents will appear here whenever a new policy or procedure is published.'
              : 'When you sign off on a document, it shows up here as proof of acknowledgment.'
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Version</TableHead>
              {tab === 'outstanding' ? (
                <TableHead>Status</TableHead>
              ) : (
                <TableHead>Acknowledged at</TableHead>
              )}
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {active.map((r) => {
              const isStale = tab === 'outstanding' && r.myAckVersionId && r.myAckVersionId !== r.latestVersionId
              return (
                <TableRow key={r.docId}>
                  <TableCell>
                    <Link
                      href={`/documents/${r.docId}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {r.title}
                    </Link>
                    <div className="text-xs text-slate-500">{r.key}</div>
                  </TableCell>
                  <TableCell className="text-slate-600">{r.category ?? '—'}</TableCell>
                  <TableCell>
                    {r.latestVersionNum != null ? (
                      <Badge variant="outline">v{r.latestVersionNum}</Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {tab === 'outstanding' ? (
                      isStale ? (
                        <Badge variant="warning">New version</Badge>
                      ) : (
                        <Badge variant="destructive">Outstanding</Badge>
                      )
                    ) : r.myAckAt ? (
                      new Date(r.myAckAt).toLocaleDateString()
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/documents/${r.docId}`}
                      className="text-xs text-teal-700 hover:underline"
                    >
                      {tab === 'outstanding' ? 'Review & acknowledge →' : 'View →'}
                    </Link>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </ListPageLayout>
  )
}
