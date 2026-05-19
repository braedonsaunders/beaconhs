// "My training" — three-tab personal training view:
//   1. Records   — every training_record the current person has earned
//   2. Expiring  — records expiring within 90 days (the action-needed list)
//   3. Assigned  — audience-assigned items the person hasn't completed yet
//
// All three queries pivot on `people.userId = ctx.userId` -> `people.id` so we
// can hit `training_records` / `training_audience_assignment_records` which
// store the person id rather than the membership / user id.

import Link from 'next/link'
import { GraduationCap } from 'lucide-react'
import { and, asc, count, desc, eq, gte, isNull, lte, or, type SQL } from 'drizzle-orm'
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
  people,
  trainingAudienceAssignmentRecords,
  trainingAudienceAssignments,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams } from '@/lib/list-params'
import { Pagination } from '@/components/pagination'
import { ListPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'

export const metadata = { title: 'My training' }
export const dynamic = 'force-dynamic'

const TABS = ['records', 'expiring', 'assigned'] as const
type Tab = (typeof TABS)[number]

export default async function MyTrainingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const tab: Tab = pickActiveTab(sp, TABS, 'records')
  const params = parseListParams(sp, {
    sort: 'completedOn',
    dir: 'desc',
    perPage: 25,
    allowedSorts: ['completedOn', 'expiresOn', 'course'] as const,
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
        personId: null,
        recordsCount: 0,
        expiringCount: 0,
        assignedCount: 0,
        records: [] as any[],
        expiring: [] as any[],
        assigned: [] as any[],
        total: 0,
      }
    }

    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const ninetyDays = new Date()
    ninetyDays.setDate(ninetyDays.getDate() + 90)
    const ninetyDaysStr = ninetyDays.toISOString().slice(0, 10)

    // ---- Tab counts -----------------------------------------------------
    const [recCntRow] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .where(and(eq(trainingRecords.personId, personId), isNull(trainingRecords.deletedAt)))
    const recordsCount = Number(recCntRow?.c ?? 0)

    const [expCntRow] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .where(
        and(
          eq(trainingRecords.personId, personId),
          isNull(trainingRecords.deletedAt),
          gte(trainingRecords.expiresOn, todayStr),
          lte(trainingRecords.expiresOn, ninetyDaysStr),
        ),
      )
    const expiringCount = Number(expCntRow?.c ?? 0)

    const assignedScope = or(
      eq(trainingAudienceAssignmentRecords.status, 'pending'),
      eq(trainingAudienceAssignmentRecords.status, 'in_progress'),
      eq(trainingAudienceAssignmentRecords.status, 'overdue'),
    ) as SQL<unknown>
    const [assignedCntRow] = await tx
      .select({ c: count() })
      .from(trainingAudienceAssignmentRecords)
      .where(and(eq(trainingAudienceAssignmentRecords.personId, personId), assignedScope))
    const assignedCount = Number(assignedCntRow?.c ?? 0)

    // ---- Active-tab data ------------------------------------------------
    if (tab === 'records') {
      const order =
        params.sort === 'course'
          ? [params.dir === 'asc' ? asc(trainingCourses.name) : desc(trainingCourses.name)]
          : params.sort === 'expiresOn'
            ? [params.dir === 'asc' ? asc(trainingRecords.expiresOn) : desc(trainingRecords.expiresOn)]
            : [params.dir === 'asc' ? asc(trainingRecords.completedOn) : desc(trainingRecords.completedOn)]

      const records = await tx
        .select({ rec: trainingRecords, course: trainingCourses })
        .from(trainingRecords)
        .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
        .where(and(eq(trainingRecords.personId, personId), isNull(trainingRecords.deletedAt)))
        .orderBy(...order)
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage)
      return {
        personId,
        recordsCount,
        expiringCount,
        assignedCount,
        records,
        expiring: [],
        assigned: [],
        total: recordsCount,
      }
    }
    if (tab === 'expiring') {
      const expiring = await tx
        .select({ rec: trainingRecords, course: trainingCourses })
        .from(trainingRecords)
        .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
        .where(
          and(
            eq(trainingRecords.personId, personId),
            isNull(trainingRecords.deletedAt),
            gte(trainingRecords.expiresOn, todayStr),
            lte(trainingRecords.expiresOn, ninetyDaysStr),
          ),
        )
        .orderBy(asc(trainingRecords.expiresOn))
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage)
      return {
        personId,
        recordsCount,
        expiringCount,
        assignedCount,
        records: [],
        expiring,
        assigned: [],
        total: expiringCount,
      }
    }
    // tab === 'assigned'
    const assigned = await tx
      .select({
        rec: trainingAudienceAssignmentRecords,
        assignment: trainingAudienceAssignments,
        course: trainingCourses,
      })
      .from(trainingAudienceAssignmentRecords)
      .innerJoin(
        trainingAudienceAssignments,
        eq(trainingAudienceAssignments.id, trainingAudienceAssignmentRecords.assignmentId),
      )
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingAudienceAssignments.courseId))
      .where(
        and(eq(trainingAudienceAssignmentRecords.personId, personId), assignedScope),
      )
      .orderBy(
        asc(trainingAudienceAssignments.dueOn),
        desc(trainingAudienceAssignmentRecords.lastEvaluatedAt),
      )
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    return {
      personId,
      recordsCount,
      expiringCount,
      assignedCount,
      records: [],
      expiring: [],
      assigned,
      total: assignedCount,
    }
  })

  if (!data.personId) {
    return (
      <ListPageLayout
        header={
          <PageHeader
            title="My training"
            description="Your training records and assignments."
            actions={
              <Link href="/training">
                <Button variant="outline">All training</Button>
              </Link>
            }
          />
        }
      >
        <EmptyState
          icon={<GraduationCap size={32} />}
          title="No person record linked to your account"
          description="Ask an administrator to link your user account to a person record so your training history shows up here."
        />
      </ListPageLayout>
    )
  }

  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="My training"
            description="Your training records, upcoming expirations, and outstanding assignments."
            actions={
              <Link href="/training">
                <Button variant="outline">All training</Button>
              </Link>
            }
          />
          <TabNav
            basePath="/my/training"
            currentParams={sp}
            active={tab}
            tabs={[
              { key: 'records', label: 'Records', count: data.recordsCount },
              { key: 'expiring', label: 'Expiring (90d)', count: data.expiringCount },
              { key: 'assigned', label: 'Assigned', count: data.assignedCount },
            ]}
          />
        </>
      }
    >
      {tab === 'records' ? (
        data.records.length === 0 ? (
          <EmptyState
            icon={<GraduationCap size={32} />}
            title="No training records yet"
            description="As soon as an instructor or evaluator signs you off, it'll appear here."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.records.map(({ rec, course }: any) => {
                  const expiringSoon =
                    rec.expiresOn && rec.expiresOn >= todayStr && rec.expiresOn <= (() => {
                      const d = new Date()
                      d.setDate(d.getDate() + 90)
                      return d.toISOString().slice(0, 10)
                    })()
                  const expired = rec.expiresOn && rec.expiresOn < todayStr
                  return (
                    <TableRow key={rec.id}>
                      <TableCell>
                        <div className="font-medium">{course?.name ?? '—'}</div>
                        {course?.code ? (
                          <div className="text-xs text-slate-500">{course.code}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{rec.completedOn}</TableCell>
                      <TableCell>
                        {rec.expiresOn ? (
                          <span
                            className={
                              expired
                                ? 'font-medium text-red-700'
                                : expiringSoon
                                  ? 'font-medium text-amber-700'
                                  : ''
                            }
                          >
                            {rec.expiresOn}
                            {expired ? ' (expired)' : expiringSoon ? ' (soon)' : ''}
                          </span>
                        ) : (
                          <span className="text-slate-500">No expiry</span>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {rec.source.replace('_', ' ')}
                      </TableCell>
                      <TableCell>
                        {rec.grade != null ? (
                          <Badge variant={rec.grade >= 80 ? 'success' : 'warning'}>
                            {rec.grade}%
                          </Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Pagination
              basePath="/my/training"
              currentParams={sp}
              total={data.total}
              page={params.page}
              perPage={params.perPage}
            />
          </>
        )
      ) : null}

      {tab === 'expiring' ? (
        data.expiring.length === 0 ? (
          <EmptyState
            icon={<GraduationCap size={32} />}
            title="Nothing expiring in the next 90 days"
            description="All your certifications are good for at least the next quarter."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Days left</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.expiring.map(({ rec, course }: any) => {
                  const daysLeft = rec.expiresOn
                    ? Math.ceil(
                        (new Date(rec.expiresOn).getTime() - new Date().getTime()) /
                          (1000 * 60 * 60 * 24),
                      )
                    : null
                  return (
                    <TableRow key={rec.id}>
                      <TableCell>
                        <div className="font-medium">{course?.name ?? '—'}</div>
                      </TableCell>
                      <TableCell>{rec.expiresOn}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            daysLeft != null && daysLeft <= 14
                              ? 'destructive'
                              : daysLeft != null && daysLeft <= 30
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          {daysLeft ?? '—'}d
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600">{rec.completedOn}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Pagination
              basePath="/my/training"
              currentParams={sp}
              total={data.total}
              page={params.page}
              perPage={params.perPage}
            />
          </>
        )
      ) : null}

      {tab === 'assigned' ? (
        data.assigned.length === 0 ? (
          <EmptyState
            icon={<GraduationCap size={32} />}
            title="No outstanding assignments"
            description="When someone assigns a course or assessment to you, it'll show up here until it's completed."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assignment</TableHead>
                  <TableHead>Course / item</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.assigned.map(({ rec, assignment, course }: any) => {
                  const overdue =
                    assignment.dueOn && assignment.dueOn < todayStr && rec.status !== 'completed'
                  return (
                    <TableRow key={rec.id}>
                      <TableCell>
                        <div className="font-medium">{assignment.name}</div>
                        {assignment.notes ? (
                          <div className="text-xs text-slate-500">{assignment.notes}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{course?.name ?? assignment.itemKind}</TableCell>
                      <TableCell>
                        <span className={overdue ? 'font-medium text-red-700' : ''}>
                          {assignment.dueOn ?? '—'}
                          {overdue ? ' (overdue)' : ''}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            rec.status === 'overdue'
                              ? 'destructive'
                              : rec.status === 'completed'
                                ? 'success'
                                : 'warning'
                          }
                        >
                          {rec.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Pagination
              basePath="/my/training"
              currentParams={sp}
              total={data.total}
              page={params.page}
              perPage={params.perPage}
            />
          </>
        )
      ) : null}
    </ListPageLayout>
  )
}
