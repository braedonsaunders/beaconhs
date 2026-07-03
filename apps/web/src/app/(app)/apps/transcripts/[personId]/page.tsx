import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText } from 'lucide-react'
import { and, eq, isNull } from 'drizzle-orm'
import {
  Badge,
  DetailHeader,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { people } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { Section } from '@/components/section'
import { DetailGrid } from '@/components/detail-grid'
import { SortableTh } from '@/components/sortable-th'
import { parseListParams } from '@/lib/list-params'
import { formCategoryLabel } from '../../_lib/category-label'
import { loadPersonTranscript } from '../../_lib/participants'

export const dynamic = 'force-dynamic'

const SORTS = ['date', 'form', 'category', 'status'] as const

export async function generateMetadata({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params
  return { title: `Form transcript · ${personId.slice(0, 8)}` }
}

export default async function FormTranscriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { personId } = await params
  const sp = await searchParams
  const listParams = parseListParams(sp, { sort: 'date', dir: 'desc', allowedSorts: SORTS })
  const ctx = await requireRequestContext()

  // A transcript is a person's ENTIRE cross-record form history, so it needs
  // the reviewer read tier — except for your own transcript, which you may
  // always view.
  const canReadAll = can(ctx, 'forms.response.read.all')
  const data = await ctx.db(async (tx) => {
    const [p] = await tx
      .select()
      .from(people)
      .where(and(eq(people.id, personId), isNull(people.deletedAt)))
      .limit(1)
    if (!p) return null
    if (!canReadAll && p.userId !== ctx.userId) return null
    return p
  })
  if (!data) notFound()
  const person = data

  const transcript = await loadPersonTranscript(ctx, personId)
  const { totals } = transcript
  const dir = listParams.dir === 'asc' ? 1 : -1
  const rows = [...transcript.rows].sort((a, b) => {
    const cmp =
      listParams.sort === 'form'
        ? a.templateName.localeCompare(b.templateName)
        : listParams.sort === 'category'
          ? (a.category ?? '').localeCompare(b.category ?? '')
          : listParams.sort === 'status'
            ? a.status.localeCompare(b.status)
            : (a.occurredOn ?? '').localeCompare(b.occurredOn ?? '')
    return cmp * dir
  })
  const categories = Object.entries(totals.byCategory)
    .map(([k, n]) => `${formCategoryLabel(k)} (${n})`)
    .join(', ')
  const sortProps = {
    basePath: `/apps/transcripts/${personId}`,
    currentParams: sp,
    dir: listParams.dir,
  }

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/apps/transcripts', label: 'Back to transcripts' }}
          title={`${person.firstName} ${person.lastName}`}
          subtitle={person.jobTitle ?? 'Form transcript'}
          badge={<Badge variant="secondary">{totals.responses} forms</Badge>}
        />
      }
    >
      <div className="space-y-5">
        <Section title="Summary">
          <DetailGrid
            rows={[
              { label: 'Person', value: `${person.lastName}, ${person.firstName}` },
              { label: 'Job title', value: person.jobTitle ?? '—' },
              { label: 'Status', value: person.status },
              { label: 'Forms participated in', value: totals.responses },
              { label: 'Signed for', value: `${totals.signed} / ${totals.responses}` },
              { label: 'By category', value: categories || '—' },
            ]}
          />
        </Section>

        <Section title={`Forms (${rows.length})`}>
          {rows.length === 0 ? (
            <EmptyState
              icon={<FileText size={24} />}
              title="No form participation"
              description="This person has not appeared on a submitted form."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTh {...sortProps} column="date" active={listParams.sort === 'date'}>
                    Date
                  </SortableTh>
                  <SortableTh {...sortProps} column="form" active={listParams.sort === 'form'}>
                    Form
                  </SortableTh>
                  <SortableTh
                    {...sortProps}
                    column="category"
                    active={listParams.sort === 'category'}
                  >
                    Category
                  </SortableTh>
                  <SortableTh {...sortProps} column="status" active={listParams.sort === 'status'}>
                    Status
                  </SortableTh>
                  <TableHead>Signed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.participantId}>
                    <TableCell>{r.occurredOn ?? '—'}</TableCell>
                    <TableCell>
                      <Link
                        href={`/apps/responses/${r.responseId}`}
                        className="font-medium hover:underline"
                      >
                        {r.templateName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {r.category ? formCategoryLabel(r.category) : '—'}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {r.status.replace('_', ' ')}
                    </TableCell>
                    <TableCell>
                      {r.signed ? (
                        <Badge variant="success">Yes</Badge>
                      ) : (
                        <Badge variant="secondary">No</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Section>
      </div>
    </DetailPageLayout>
  )
}
