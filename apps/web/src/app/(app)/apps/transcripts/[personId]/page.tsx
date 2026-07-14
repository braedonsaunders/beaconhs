import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileText } from 'lucide-react'
import { and, eq, isNull } from 'drizzle-orm'
import { primaryPersonTitleName } from '@beaconhs/db'
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
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { TableToolbar } from '@/components/table-toolbar'
import { formCategoryLabel } from '../../_lib/category-label'
import { loadPersonTranscript } from '../../_lib/participants'

export const dynamic = 'force-dynamic'

const SORTS = ['date', 'form', 'category', 'status'] as const
const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'non_compliant', label: 'Non-compliant' },
  { value: 'in_review', label: 'In review' },
  { value: 'closed', label: 'Closed' },
  { value: 'rejected', label: 'Rejected' },
] as const

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
  if (!isUuid(personId)) notFound()
  const sp = await searchParams
  const listParams = parseListParams(sp, {
    sort: 'date',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const rawStatus = pickString(sp.status)
  const statusFilter = STATUS_OPTIONS.find((option) => option.value === rawStatus)?.value
  const ctx = await requireRequestContext()

  // A transcript is a person's ENTIRE cross-record form history, so it needs
  // the reviewer read tier — except for your own transcript, which you may
  // always view.
  const canReadAll = can(ctx, 'forms.response.read.all')
  const data = await ctx.db(async (tx) => {
    const [p] = await tx
      .select({
        person: people,
        jobTitle: primaryPersonTitleName(people.id, people.tenantId),
      })
      .from(people)
      .where(and(eq(people.id, personId), isNull(people.deletedAt)))
      .limit(1)
    if (!p) return null
    if (!canReadAll && p.person.userId !== ctx.userId) return null
    return { ...p.person, jobTitle: p.jobTitle }
  })
  if (!data) notFound()
  const person = data

  const transcript = await loadPersonTranscript(ctx, personId, {
    q: listParams.q,
    status: statusFilter,
    sort: listParams.sort,
    dir: listParams.dir,
    page: listParams.page,
    perPage: listParams.perPage,
  })
  const { rows, total, totals } = transcript
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

        <Section title={`Forms (${total})`}>
          <TableToolbar>
            <SearchInput placeholder="Search form, category, status, or date…" />
            <FilterChips
              basePath={`/apps/transcripts/${personId}`}
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={[...STATUS_OPTIONS]}
            />
          </TableToolbar>
          {rows.length === 0 ? (
            <EmptyState
              icon={<FileText size={24} />}
              title={
                listParams.q || statusFilter
                  ? 'No forms match these filters'
                  : 'No form participation'
              }
              description={
                listParams.q || statusFilter
                  ? 'Clear or change the current search and status filter.'
                  : 'This person has not appeared on a submitted form.'
              }
            />
          ) : (
            <>
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
                    <SortableTh
                      {...sortProps}
                      column="status"
                      active={listParams.sort === 'status'}
                    >
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
              <Pagination
                basePath={`/apps/transcripts/${personId}`}
                currentParams={sp}
                total={total}
                page={Math.min(listParams.page, Math.max(1, Math.ceil(total / listParams.perPage)))}
                perPage={listParams.perPage}
              />
            </>
          )}
        </Section>
      </div>
    </DetailPageLayout>
  )
}
