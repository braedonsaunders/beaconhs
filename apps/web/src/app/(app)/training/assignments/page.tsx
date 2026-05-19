import Link from 'next/link'
import { CalendarRange } from 'lucide-react'
import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
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
  trainingAssessmentTypes,
  trainingAudienceAssignmentTargets,
  trainingAudienceAssignments,
  trainingCourses,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { readAssignmentCompliance } from '../_lib/audience'

export const metadata = { title: 'Training assignments' }
export const dynamic = 'force-dynamic'

const SORTS = ['name', 'due', 'created'] as const

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
]

export default async function TrainingAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'created',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status) ?? 'active'
  const itemKindFilter = pickString(sp.itemKind)
  const ctx = await requireRequestContext()

  const { rows, total, compliance, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (statusFilter !== 'all') {
      if (statusFilter === 'archived') {
        filters.push(eq(trainingAudienceAssignments.status, 'archived'))
      } else {
        filters.push(eq(trainingAudienceAssignments.status, 'active'))
        filters.push(isNull(trainingAudienceAssignments.deletedAt))
      }
    }
    if (itemKindFilter === 'course') {
      filters.push(eq(trainingAudienceAssignments.itemKind, 'course'))
    } else if (itemKindFilter === 'assessment_type') {
      filters.push(eq(trainingAudienceAssignments.itemKind, 'assessment_type'))
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'name'
        ? [
            params.dir === 'asc'
              ? asc(trainingAudienceAssignments.name)
              : desc(trainingAudienceAssignments.name),
          ]
        : params.sort === 'due'
          ? [
              params.dir === 'asc'
                ? asc(trainingAudienceAssignments.dueOn)
                : desc(trainingAudienceAssignments.dueOn),
            ]
          : [
              params.dir === 'asc'
                ? asc(trainingAudienceAssignments.createdAt)
                : desc(trainingAudienceAssignments.createdAt),
            ]

    const [tot] = await tx
      .select({ c: count() })
      .from(trainingAudienceAssignments)
      .where(whereClause)
    const data = await tx
      .select({
        a: trainingAudienceAssignments,
        course: trainingCourses,
        type: trainingAssessmentTypes,
        targetCount: sql<number>`count(distinct ${trainingAudienceAssignmentTargets.id})`.mapWith(
          Number,
        ),
        personTargets: sql<number>`count(distinct case when ${trainingAudienceAssignmentTargets.kind} = 'person' then ${trainingAudienceAssignmentTargets.id} end)`.mapWith(
          Number,
        ),
        tradeTargets: sql<number>`count(distinct case when ${trainingAudienceAssignmentTargets.kind} = 'trade' then ${trainingAudienceAssignmentTargets.id} end)`.mapWith(
          Number,
        ),
      })
      .from(trainingAudienceAssignments)
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingAudienceAssignments.courseId))
      .leftJoin(
        trainingAssessmentTypes,
        eq(trainingAssessmentTypes.id, trainingAudienceAssignments.assessmentTypeId),
      )
      .leftJoin(
        trainingAudienceAssignmentTargets,
        eq(trainingAudienceAssignmentTargets.assignmentId, trainingAudienceAssignments.id),
      )
      .where(whereClause)
      .groupBy(trainingAudienceAssignments.id, trainingCourses.id, trainingAssessmentTypes.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const tenantId = ctx.tenantId as string
    const comp = await readAssignmentCompliance(
      tx,
      tenantId,
      data.map((r) => r.a.id),
    )

    const counts = await tx
      .select({ status: trainingAudienceAssignments.status, c: count() })
      .from(trainingAudienceAssignments)
      .groupBy(trainingAudienceAssignments.status)
    const sc: Record<string, number> = { all: 0, active: 0, archived: 0 }
    for (const r of counts) {
      sc.all = (sc.all ?? 0) + Number(r.c)
      if (r.status === 'active') sc.active = (sc.active ?? 0) + Number(r.c)
      else if (r.status === 'archived')
        sc.archived = (sc.archived ?? 0) + Number(r.c)
    }

    return { rows: data, total: Number(tot?.c ?? 0), compliance: comp, statusCounts: sc }
  })

  const sortProps = { basePath: '/training/assignments', currentParams: sp, dir: params.dir }
  const today = new Date().toISOString().slice(0, 10)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Training assignments"
            description="Assign required courses or assessments to people, trades, or roles. Compliance is computed from training records + assessment passes."
            actions={
              <Link href="/training/assignments/new">
                <Button>New assignment</Button>
              </Link>
            }
          />
          <TrainingSubNav active="assignments" />
          <FilterChips
            basePath="/training/assignments"
            currentParams={sp}
            paramKey="status"
            label="Status"
            options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
          />
          <FilterChips
            basePath="/training/assignments"
            currentParams={sp}
            paramKey="itemKind"
            label="Type"
            options={[
              { value: 'course', label: 'Course' },
              { value: 'assessment_type', label: 'Assessment' },
            ]}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<CalendarRange size={32} />}
          title="No training assignments yet"
          description="Create one to push training requirements to specific people, trades, or roles."
          action={
            <Link href="/training/assignments/new">
              <Button>Create your first assignment</Button>
            </Link>
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
                <TableHead>Kind</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Audience</TableHead>
                <SortableTh {...sortProps} column="due" active={params.sort === 'due'}>
                  Due
                </SortableTh>
                <TableHead>Compliance</TableHead>
                <TableHead>Overdue</TableHead>
                <TableHead>Remind before</TableHead>
                <TableHead>Recurrence</TableHead>
                <SortableTh {...sortProps} column="created" active={params.sort === 'created'}>
                  Created
                </SortableTh>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ a, course, type, targetCount, personTargets, tradeTargets }) => {
                const stats = compliance.get(a.id) ?? { total: 0, completed: 0, overdue: 0 }
                const pct = stats.total === 0 ? 0 : Math.round((stats.completed / stats.total) * 100)
                const overdueExists = a.dueOn && a.dueOn < today
                const audienceCount = Number(targetCount ?? 0)
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link
                        href={`/training/assignments/${a.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {a.name}
                      </Link>
                      {a.notes ? (
                        <div className="text-xs text-slate-500 line-clamp-1">{a.notes}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {a.itemKind === 'course' ? 'Course' : 'Assessment'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs">
                      {a.itemKind === 'course' && course ? (
                        <Link
                          href={`/training/courses/${course.id}`}
                          className="hover:underline"
                        >
                          <span className="font-mono">{course.code}</span> · {course.name}
                        </Link>
                      ) : a.itemKind === 'assessment_type' && type ? (
                        <Link
                          href={`/training/assessments/types/${type.id}`}
                          className="hover:underline"
                        >
                          {type.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      <Badge variant="secondary">{audienceCount}</Badge>
                      <div className="mt-0.5 text-slate-500">
                        {Number(personTargets ?? 0)} ppl · {Number(tradeTargets ?? 0)} trades
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-600 tabular-nums text-xs">
                      {a.dueOn ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={
                              pct >= 90
                                ? 'h-full bg-green-500'
                                : pct >= 50
                                  ? 'h-full bg-amber-500'
                                  : 'h-full bg-red-500'
                            }
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-slate-600">
                          {stats.completed}/{stats.total} ({pct}%)
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {stats.overdue > 0 ? (
                        <Badge variant="destructive">{stats.overdue}</Badge>
                      ) : (
                        <span className="text-slate-400 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {a.remindBeforeDays}d
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {a.recurrenceCron ? (
                        <span className="font-mono">{a.recurrenceCron}</span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 tabular-nums">
                      {new Date(a.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {a.status === 'archived' ? (
                        <Badge variant="outline">Archived</Badge>
                      ) : overdueExists ? (
                        <Badge variant="destructive">Past due</Badge>
                      ) : (
                        <Badge variant="success">Active</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/training/assignments"
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
