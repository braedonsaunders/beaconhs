import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
  const tGenerated = await getGeneratedTranslations()
  const { personId } = await params
  return { title: tGenerated('m_08a328c6c4ddcb', { value0: personId.slice(0, 8) }) }
}

export default async function FormTranscriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ personId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
          title={tGeneratedValue(`${person.firstName} ${person.lastName}`)}
          subtitle={tGeneratedValue(person.jobTitle ?? tGenerated('m_1b54d8bd9f50cf'))}
          badge={
            <Badge variant="secondary">
              <GeneratedValue value={totals.responses} /> <GeneratedText id="m_0c3f6ff3d3678c" />
            </Badge>
          }
        />
      }
    >
      <div className="space-y-5">
        <Section title={tGenerated('m_031c356c80b70f')}>
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

        <Section title={tGenerated('m_1d8dca37d7abf0', { value0: total })}>
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0f71f4f016519c')} />
            <FilterChips
              basePath={`/apps/transcripts/${personId}`}
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={[...STATUS_OPTIONS]}
            />
          </TableToolbar>
          <GeneratedValue
            value={
              rows.length === 0 ? (
                <EmptyState
                  icon={<FileText size={24} />}
                  title={tGeneratedValue(
                    listParams.q || statusFilter
                      ? tGenerated('m_1e3bf77726f6cc')
                      : tGenerated('m_14b1ef771e2929'),
                  )}
                  description={tGeneratedValue(
                    listParams.q || statusFilter
                      ? tGenerated('m_1f90cb0675ecc6')
                      : tGenerated('m_1fb6bf14923a26'),
                  )}
                />
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableTh
                          {...sortProps}
                          column="date"
                          active={listParams.sort === 'date'}
                        >
                          <GeneratedText id="m_0285c38761c540" />
                        </SortableTh>
                        <SortableTh
                          {...sortProps}
                          column="form"
                          active={listParams.sort === 'form'}
                        >
                          <GeneratedText id="m_1dd52d70cc6c4f" />
                        </SortableTh>
                        <SortableTh
                          {...sortProps}
                          column="category"
                          active={listParams.sort === 'category'}
                        >
                          <GeneratedText id="m_108b41637f364f" />
                        </SortableTh>
                        <SortableTh
                          {...sortProps}
                          column="status"
                          active={listParams.sort === 'status'}
                        >
                          <GeneratedText id="m_0b9da892d6faf0" />
                        </SortableTh>
                        <TableHead>
                          <GeneratedText id="m_142c80b0b4c3f4" />
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <GeneratedValue
                        value={rows.map((r) => (
                          <TableRow key={r.participantId}>
                            <TableCell>
                              <GeneratedValue value={r.occurredOn ?? '—'} />
                            </TableCell>
                            <TableCell>
                              <Link
                                href={`/apps/responses/${r.responseId}`}
                                className="font-medium hover:underline"
                              >
                                <GeneratedValue value={r.templateName} />
                              </Link>
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-400">
                              <GeneratedValue
                                value={r.category ? formCategoryLabel(r.category) : '—'}
                              />
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-400">
                              <GeneratedValue value={r.status.replace('_', ' ')} />
                            </TableCell>
                            <TableCell>
                              <GeneratedValue
                                value={
                                  r.signed ? (
                                    <Badge variant="success">
                                      <GeneratedText id="m_1b34c7d70d09bd" />
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary">
                                      <GeneratedText id="m_117d1a5e1ef440" />
                                    </Badge>
                                  )
                                }
                              />
                            </TableCell>
                          </TableRow>
                        ))}
                      />
                    </TableBody>
                  </Table>
                  <Pagination
                    basePath={`/apps/transcripts/${personId}`}
                    currentParams={sp}
                    total={total}
                    page={Math.min(
                      listParams.page,
                      Math.max(1, Math.ceil(total / listParams.perPage)),
                    )}
                    perPage={listParams.perPage}
                  />
                </>
              )
            }
          />
        </Section>
      </div>
    </DetailPageLayout>
  )
}
