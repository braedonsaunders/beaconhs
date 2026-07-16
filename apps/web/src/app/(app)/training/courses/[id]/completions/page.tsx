import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or } from 'drizzle-orm'
import {
  Badge,
  Button,
  DetailHeader,
  EmptyState,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { CheckCircle2, Clock3 } from 'lucide-react'
import { people, trainingCourses, trainingEnrollments } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { DetailPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { TableToolbar } from '@/components/table-toolbar'
import { ConfirmButton } from '@/components/confirm-button'
import { formatDateTime } from '@/lib/datetime'
import { isUuid, parseListParams } from '@/lib/list-params'
import { completeOnlineCourseEnrollment } from './_actions'
import { GeneratedText } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'

export const dynamic = 'force-dynamic'
const SORTS = ['requested', 'person'] as const

export default async function OnlineCourseCompletionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const status =
    typeof sp.status === 'string' && ['pending', 'completed', 'all'].includes(sp.status)
      ? sp.status
      : 'pending'
  const list = parseListParams(sp, {
    sort: 'requested',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const ctx = await requireModuleManage('training')

  const data = await ctx.db(async (tx) => {
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, id))
      .limit(1)
    if (!course || course.deliveryType !== 'online') return null
    const base = and(eq(trainingEnrollments.courseId, id), isNull(trainingEnrollments.deletedAt))
    const statusWhere =
      status === 'pending'
        ? and(
            isNotNull(trainingEnrollments.completionRequestedAt),
            isNull(trainingEnrollments.completedAt),
          )
        : status === 'completed'
          ? isNotNull(trainingEnrollments.completedAt)
          : undefined
    const searchWhere = list.q
      ? or(
          ilike(people.firstName, `%${list.q}%`),
          ilike(people.lastName, `%${list.q}%`),
          ilike(people.employeeNo, `%${list.q}%`),
        )
      : undefined
    const where = and(base, statusWhere, searchWhere)
    const [[totalRow], rows] = await Promise.all([
      tx
        .select({ c: count() })
        .from(trainingEnrollments)
        .innerJoin(people, eq(people.id, trainingEnrollments.personId))
        .where(where),
      tx
        .select({ enrollment: trainingEnrollments, person: people })
        .from(trainingEnrollments)
        .innerJoin(people, eq(people.id, trainingEnrollments.personId))
        .where(where)
        .orderBy(
          list.sort === 'person'
            ? list.dir === 'asc'
              ? asc(people.lastName)
              : desc(people.lastName)
            : list.dir === 'asc'
              ? asc(trainingEnrollments.completionRequestedAt)
              : desc(trainingEnrollments.completionRequestedAt),
          asc(people.firstName),
        )
        .limit(list.perPage)
        .offset((list.page - 1) * list.perPage),
    ])
    return { course, rows, total: Number(totalRow?.c ?? 0) }
  })
  if (!data) notFound()

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: `/training/courses/${id}`, label: 'Back to course' }}
          title={tGenerated('m_0f5beb1d90d669')}
          subtitle={data.course.name}
        />
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          <GeneratedText id="m_042c245325930a" />
        </p>
        <TableToolbar>
          <SearchInput placeholder={tGenerated('m_177e2342690354')} />
          <FilterChips
            basePath={`/training/courses/${id}/completions`}
            currentParams={sp}
            paramKey="status"
            label={tGenerated('m_0b9da892d6faf0')}
            defaultValue="pending"
            hideAll
            options={[
              { value: 'pending', label: 'Awaiting verification' },
              { value: 'completed', label: 'Completed' },
              { value: 'all', label: 'All' },
            ]}
          />
        </TableToolbar>
        {data.rows.length === 0 ? (
          <EmptyState
            icon={<Clock3 size={24} />}
            title={tGenerated('m_159a479a62273e')}
            description={tGenerated('m_0aba53bce928e4')}
          />
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <GeneratedText id="m_1bdb8ab23643f7" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_0c823c3949ebd6" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_0b9da892d6faf0" />
                  </TableHead>
                  <TableHead>
                    <GeneratedText id="m_06bd85b54c842c" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map(({ enrollment, person }) => {
                  const completed = enrollment.status === 'completed'
                  const action = completeOnlineCourseEnrollment.bind(null, id, enrollment.id)
                  return (
                    <TableRow key={enrollment.id}>
                      <TableCell>
                        <div className="font-medium">
                          {person.lastName}, {person.firstName}
                        </div>
                        {person.employeeNo ? (
                          <div className="text-xs text-slate-500">#{person.employeeNo}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {enrollment.completionRequestedAt
                          ? formatDateTime(
                              enrollment.completionRequestedAt,
                              ctx.timezone,
                              ctx.locale,
                            )
                          : '—'}
                      </TableCell>
                      <TableCell>
                        {completed ? (
                          <Badge variant="success">
                            <CheckCircle2 size={11} /> <GeneratedText id="m_0ba7a5e1b2fa32" />
                          </Badge>
                        ) : enrollment.completionRequestedAt ? (
                          <Badge variant="warning">
                            <GeneratedText id="m_1524abecc62483" />
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <GeneratedText id="m_1e8eae5c65ba70" />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {completed ? (
                          enrollment.recordId ? (
                            <Link
                              className="text-sm text-teal-700 hover:underline dark:text-teal-300"
                              href={`/training/records/${enrollment.recordId}`}
                            >
                              <GeneratedText id="m_0a83a3980102b3" />
                            </Link>
                          ) : (
                            <GeneratedText id="m_0ba7a5e1b2fa32" />
                          )
                        ) : enrollment.completionRequestedAt ? (
                          <form action={action} className="flex min-w-72 items-center gap-2">
                            <Input
                              name="note"
                              maxLength={2000}
                              placeholder={tGenerated('m_1ffd98aa741e0b')}
                            />
                            <ConfirmButton size="sm" message={tGenerated('m_135bf4dafb7a14')}>
                              <GeneratedText id="m_01e70d6bbee256" />
                            </ConfirmButton>
                          </form>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Pagination
              basePath={`/training/courses/${id}/completions`}
              currentParams={sp}
              total={data.total}
              page={list.page}
              perPage={list.perPage}
            />
          </div>
        )}
      </div>
    </DetailPageLayout>
  )
}
