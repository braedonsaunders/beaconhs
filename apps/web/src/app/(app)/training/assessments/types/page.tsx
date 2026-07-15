import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { SmartBackLink } from '@/components/smart-back-link'
import { ClipboardList } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
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
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingAssessments,
  trainingCourses,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { formatDate } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { TrainingSubNav } from '../../_components/training-sub-nav'
import { createAssessmentType } from '../../_actions/assessment-types'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1469477020449a') }
}
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'passing', 'questions', 'attempts', 'created', 'updated'] as const

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

export default async function AssessmentTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const courseLinkedFilter = pickString(sp.linked) // 'yes' | 'no'
  const ctx = await requireModuleManage('training')

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    filters.push(sql`${trainingAssessmentTypes.deletedAt} IS NULL`)
    if (statusFilter === 'active') filters.push(eq(trainingAssessmentTypes.active, true))
    if (statusFilter === 'inactive') filters.push(eq(trainingAssessmentTypes.active, false))
    if (courseLinkedFilter === 'yes')
      filters.push(sql`${trainingAssessmentTypes.courseId} IS NOT NULL`)
    if (courseLinkedFilter === 'no') filters.push(sql`${trainingAssessmentTypes.courseId} IS NULL`)
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(trainingAssessmentTypes.name, term),
        ilike(trainingAssessmentTypes.description, term),
      )
      if (cond) filters.push(cond)
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'passing'
        ? [
            params.dir === 'asc'
              ? asc(trainingAssessmentTypes.passingScore)
              : desc(trainingAssessmentTypes.passingScore),
          ]
        : params.sort === 'questions'
          ? [
              params.dir === 'asc'
                ? asc(sql`count(distinct ${trainingAssessmentTypeQuestions.id})`)
                : desc(sql`count(distinct ${trainingAssessmentTypeQuestions.id})`),
            ]
          : params.sort === 'attempts'
            ? [
                params.dir === 'asc'
                  ? asc(sql`count(distinct ${trainingAssessments.id})`)
                  : desc(sql`count(distinct ${trainingAssessments.id})`),
              ]
            : params.sort === 'created'
              ? [
                  params.dir === 'asc'
                    ? asc(trainingAssessmentTypes.createdAt)
                    : desc(trainingAssessmentTypes.createdAt),
                ]
              : params.sort === 'updated'
                ? [
                    params.dir === 'asc'
                      ? asc(trainingAssessmentTypes.updatedAt)
                      : desc(trainingAssessmentTypes.updatedAt),
                  ]
                : [
                    params.dir === 'asc'
                      ? asc(trainingAssessmentTypes.name)
                      : desc(trainingAssessmentTypes.name),
                  ]

    const [tot] = await tx.select({ c: count() }).from(trainingAssessmentTypes).where(whereClause)

    const data = await tx
      .select({
        type: trainingAssessmentTypes,
        course: trainingCourses,
        questionCount: sql<number>`count(distinct ${trainingAssessmentTypeQuestions.id})`.mapWith(
          Number,
        ),
        attemptCount: sql<number>`count(distinct ${trainingAssessments.id})`.mapWith(Number),
        passCount:
          sql<number>`count(distinct case when ${trainingAssessments.passed} = true then ${trainingAssessments.id} end)`.mapWith(
            Number,
          ),
      })
      .from(trainingAssessmentTypes)
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingAssessmentTypes.courseId))
      .leftJoin(
        trainingAssessmentTypeQuestions,
        eq(trainingAssessmentTypeQuestions.typeId, trainingAssessmentTypes.id),
      )
      .leftJoin(trainingAssessments, eq(trainingAssessments.typeId, trainingAssessmentTypes.id))
      .where(whereClause)
      .groupBy(trainingAssessmentTypes.id, trainingCourses.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const statusRows = await tx
      .select({ active: trainingAssessmentTypes.active, c: count() })
      .from(trainingAssessmentTypes)
      .where(sql`${trainingAssessmentTypes.deletedAt} IS NULL`)
      .groupBy(trainingAssessmentTypes.active)
    const sc: Record<string, number> = { active: 0, inactive: 0 }
    for (const r of statusRows) {
      if (r.active) sc.active = Number(r.c)
      else sc.inactive = Number(r.c)
    }

    return { rows: data, total: Number(tot?.c ?? 0), statusCounts: sc }
  })

  const sortProps = {
    basePath: '/training/assessments/types',
    currentParams: sp,
    dir: params.dir,
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_1469477020449a')}
            description={tGenerated('m_0b767c59a5737b')}
            actions={
              <div className="flex items-center gap-2">
                <SmartBackLink
                  href="/training/assessments"
                  label={tGenerated('m_1929fed856c90e')}
                  className="text-sm text-teal-700 hover:underline dark:text-teal-400"
                />
                <form action={createAssessmentType}>
                  <Button type="submit">
                    <GeneratedText id="m_1d23e917eeb2e4" />
                  </Button>
                </form>
              </div>
            }
          />
          <TrainingSubNav active="assessment-types" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_1b92223e253fa3')} />
            <FilterChips
              basePath="/training/assessments/types"
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={STATUS_OPTIONS.map((o) => ({
                ...o,
                count: statusCounts[o.value],
              }))}
            />
            <FilterChips
              basePath="/training/assessments/types"
              currentParams={sp}
              paramKey="linked"
              label={tGenerated('m_0eb3d67d3f0ae2')}
              options={[
                { value: 'yes', label: 'Linked to course' },
                { value: 'no', label: 'Standalone' },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<ClipboardList size={32} />}
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_19ada7765f97e1', { value0: params.q })
                  : tGenerated('m_1960adc8a1972f'),
              )}
              description={tGenerated('m_17d80185441551')}
              action={
                <form action={createAssessmentType}>
                  <Button type="submit">
                    <GeneratedText id="m_1d23e917eeb2e4" />
                  </Button>
                </form>
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                      <GeneratedText id="m_02b18d5c7f6f2d" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_0a4456ce9a12f5" />
                    </TableHead>
                    <SortableTh {...sortProps} column="passing" active={params.sort === 'passing'}>
                      <GeneratedText id="m_1cdf12c7dddf29" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="questions"
                      active={params.sort === 'questions'}
                    >
                      <GeneratedText id="m_06d84b0874d447" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="attempts"
                      active={params.sort === 'attempts'}
                    >
                      <GeneratedText id="m_01c2d80ce4b2ca" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_009fe99b6d9fad" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_05407ee4fbb68c" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </TableHead>
                    <SortableTh {...sortProps} column="updated" active={params.sort === 'updated'}>
                      <GeneratedText id="m_014ca61c68ab13" />
                    </SortableTh>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ type, course, questionCount, attemptCount, passCount }) => {
                      const attempts = Number(attemptCount ?? 0)
                      const passes = Number(passCount ?? 0)
                      const passPct = attempts > 0 ? Math.round((passes / attempts) * 100) : null
                      return (
                        <TableRow key={type.id}>
                          <TableCell>
                            <Link
                              href={`/training/assessments/types/${type.id}`}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={type.name} />
                            </Link>
                            <GeneratedValue
                              value={
                                type.description ? (
                                  <div className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                                    <GeneratedValue value={type.description} />
                                  </div>
                                ) : null
                              }
                            />
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            <GeneratedValue
                              value={
                                course ? (
                                  <Link
                                    href={`/training/courses/${course.id}`}
                                    className="hover:underline"
                                  >
                                    <span className="font-mono text-xs">
                                      <GeneratedValue value={course.code} />
                                    </span>
                                    <GeneratedValue value={course.code ? ' · ' : ''} />
                                    <GeneratedValue value={course.name} />
                                  </Link>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="tabular-nums">
                            <GeneratedValue value={type.passingScore} />%
                          </TableCell>
                          <TableCell className="tabular-nums">
                            <GeneratedValue value={questionCount} />
                          </TableCell>
                          <TableCell className="tabular-nums">
                            <GeneratedValue value={attempts} />
                          </TableCell>
                          <TableCell className="tabular-nums">
                            <GeneratedValue
                              value={
                                passPct != null ? (
                                  <Badge
                                    variant={
                                      passPct >= 80
                                        ? 'success'
                                        : passPct >= 50
                                          ? 'warning'
                                          : 'destructive'
                                    }
                                  >
                                    <GeneratedValue value={passPct} />%
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                type.graded ? (
                                  <Badge variant="outline" className="text-xs">
                                    <GeneratedText id="m_05407ee4fbb68c" />
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-xs">
                                    <GeneratedText id="m_1d61d796ca6dea" />
                                  </Badge>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                type.active ? (
                                  <Badge variant="success">
                                    <GeneratedText id="m_1e1b1fdb7dd78e" />
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_0f47ea07c99dba" />
                                  </Badge>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                            <GeneratedValue
                              value={
                                type.updatedAt
                                  ? formatDate(new Date(type.updatedAt), ctx.timezone, ctx.locale)
                                  : '—'
                              }
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  />
                </TableBody>
              </Table>
              <Pagination
                basePath="/training/assessments/types"
                currentParams={sp}
                total={total}
                page={params.page}
                perPage={params.perPage}
              />
            </>
          )
        }
      />
    </ListPageLayout>
  )
}
