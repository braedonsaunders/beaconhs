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

export const metadata = { title: 'Assessment types' }
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
            title="Assessment types"
            description="Quiz templates with question banks and passing scores."
            actions={
              <div className="flex items-center gap-2">
                <SmartBackLink
                  href="/training/assessments"
                  label="Back to attempts"
                  className="text-sm text-teal-700 hover:underline dark:text-teal-400"
                />
                <form action={createAssessmentType}>
                  <Button type="submit">New assessment type</Button>
                </form>
              </div>
            }
          />
          <TrainingSubNav active="assessment-types" />
          <TableToolbar>
            <SearchInput placeholder="Search assessment types" />
            <FilterChips
              basePath="/training/assessments/types"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS.map((o) => ({
                ...o,
                count: statusCounts[o.value],
              }))}
            />
            <FilterChips
              basePath="/training/assessments/types"
              currentParams={sp}
              paramKey="linked"
              label="Course linkage"
              options={[
                { value: 'yes', label: 'Linked to course' },
                { value: 'no', label: 'Standalone' },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title={params.q ? `No assessment types match "${params.q}"` : 'No assessment types'}
          description="Create a type to build a graded question bank."
          action={
            <form action={createAssessmentType}>
              <Button type="submit">New assessment type</Button>
            </form>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                  Name
                </SortableTh>
                <TableHead>Linked course</TableHead>
                <SortableTh {...sortProps} column="passing" active={params.sort === 'passing'}>
                  Passing
                </SortableTh>
                <SortableTh {...sortProps} column="questions" active={params.sort === 'questions'}>
                  Questions
                </SortableTh>
                <SortableTh {...sortProps} column="attempts" active={params.sort === 'attempts'}>
                  Attempts
                </SortableTh>
                <TableHead>Pass rate</TableHead>
                <TableHead>Graded</TableHead>
                <TableHead>Status</TableHead>
                <SortableTh {...sortProps} column="updated" active={params.sort === 'updated'}>
                  Updated
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ type, course, questionCount, attemptCount, passCount }) => {
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
                        {type.name}
                      </Link>
                      {type.description ? (
                        <div className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                          {type.description}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {course ? (
                        <Link href={`/training/courses/${course.id}`} className="hover:underline">
                          <span className="font-mono text-xs">{course.code}</span>
                          {course.code ? ' · ' : ''}
                          {course.name}
                        </Link>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{type.passingScore}%</TableCell>
                    <TableCell className="tabular-nums">{questionCount}</TableCell>
                    <TableCell className="tabular-nums">{attempts}</TableCell>
                    <TableCell className="tabular-nums">
                      {passPct != null ? (
                        <Badge
                          variant={
                            passPct >= 80 ? 'success' : passPct >= 50 ? 'warning' : 'destructive'
                          }
                        >
                          {passPct}%
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {type.graded ? (
                        <Badge variant="outline" className="text-xs">
                          Graded
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          Pass-only
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {type.active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      {type.updatedAt ? formatDate(new Date(type.updatedAt), ctx.timezone) : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
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
      )}
    </ListPageLayout>
  )
}
