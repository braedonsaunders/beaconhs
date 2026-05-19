import Link from 'next/link'
import { CalendarCheck, GraduationCap } from 'lucide-react'
import { and, asc, count, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
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
  orgUnits,
  trainingClasses,
  trainingClassAttendees,
  trainingCourses,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TrainingSubNav } from '../_components/training-sub-nav'

export const metadata = { title: 'Training classes' }
export const dynamic = 'force-dynamic'

const SORTS = ['starts_at', 'course', 'title'] as const

const WHEN_OPTIONS = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
]

export default async function TrainingClassesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'starts_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const whenFilter = pickString(sp.when) ?? 'upcoming'
  const ctx = await requireRequestContext()

  const now = new Date()

  const { rows, total, attendeeCounts, whenCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (whenFilter === 'upcoming') filters.push(gte(trainingClasses.startsAt, now))
    else if (whenFilter === 'past') filters.push(lt(trainingClasses.startsAt, now))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'course'
        ? [params.dir === 'asc' ? asc(trainingCourses.name) : desc(trainingCourses.name)]
        : params.sort === 'title'
          ? [params.dir === 'asc' ? asc(trainingClasses.title) : desc(trainingClasses.title)]
          : [
              params.dir === 'asc'
                ? asc(trainingClasses.startsAt)
                : desc(trainingClasses.startsAt),
            ]

    const [tot] = await tx.select({ c: count() }).from(trainingClasses).where(whereClause)
    const data = await tx
      .select({
        cls: trainingClasses,
        course: trainingCourses,
        site: orgUnits,
      })
      .from(trainingClasses)
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingClasses.courseId))
      .leftJoin(orgUnits, eq(orgUnits.id, trainingClasses.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ac =
      data.length === 0
        ? []
        : await tx
            .select({ classId: trainingClassAttendees.classId, c: count() })
            .from(trainingClassAttendees)
            .where(
              sql`${trainingClassAttendees.classId} IN (${sql.join(
                data.map((r) => sql`${r.cls.id}::uuid`),
                sql`, `,
              )})`,
            )
            .groupBy(trainingClassAttendees.classId)

    const [upcomingC, pastC, allC] = await Promise.all([
      tx
        .select({ c: count() })
        .from(trainingClasses)
        .where(gte(trainingClasses.startsAt, now)),
      tx
        .select({ c: count() })
        .from(trainingClasses)
        .where(lt(trainingClasses.startsAt, now)),
      tx.select({ c: count() }).from(trainingClasses),
    ])

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      attendeeCounts: Object.fromEntries(ac.map((x) => [x.classId, Number(x.c)])),
      whenCounts: {
        upcoming: Number(upcomingC[0]?.c ?? 0),
        past: Number(pastC[0]?.c ?? 0),
        all: Number(allC[0]?.c ?? 0),
      },
    }
  })

  const sortProps = { basePath: '/training/classes', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Training classes"
            description="Scheduled instructor-led classes. Roster attendees and mark completion to write training records."
            actions={
              <Link href="/training/classes/new">
                <Button>Schedule new class</Button>
              </Link>
            }
          />
          <TrainingSubNav active="classes" />
          <FilterChips
            basePath="/training/classes"
            currentParams={sp}
            paramKey="when"
            label="When"
            options={WHEN_OPTIONS.map((o) => ({
              ...o,
              count: whenCounts[o.value as keyof typeof whenCounts],
            }))}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck size={32} />}
          title={whenFilter === 'past' ? 'No past classes' : 'No classes scheduled'}
          description="Schedule a class for any course in your catalogue. Roster attendees and mark completion when done."
          action={
            <Link href="/training/classes/new">
              <Button>Schedule your first class</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh
                  {...sortProps}
                  column="starts_at"
                  active={params.sort === 'starts_at'}
                >
                  When
                </SortableTh>
                <SortableTh {...sortProps} column="title" active={params.sort === 'title'}>
                  Title
                </SortableTh>
                <SortableTh {...sortProps} column="course" active={params.sort === 'course'}>
                  Course
                </SortableTh>
                <TableHead>Site</TableHead>
                <TableHead>Attendees</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const startedAt = new Date(row.cls.startsAt)
                const endsAt = new Date(row.cls.endsAt)
                const inPast = endsAt < now
                const attCount = attendeeCounts[row.cls.id] ?? 0
                return (
                  <TableRow key={row.cls.id}>
                    <TableCell className="text-slate-600">
                      <div className="text-sm">{startedAt.toLocaleDateString()}</div>
                      <div className="text-xs text-slate-400">
                        {startedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/training/classes/${row.cls.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {row.cls.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/training/courses/${row.course.id}`}
                        className="text-sm text-teal-700 hover:underline"
                      >
                        {row.course.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">{row.site?.name ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {attCount}
                        {row.cls.capacity ? ` / ${row.cls.capacity}` : ''}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.cls.cancelledAt ? (
                        <Badge variant="destructive">Cancelled</Badge>
                      ) : row.cls.completedAt ? (
                        <Badge variant="success">Completed</Badge>
                      ) : inPast ? (
                        <Badge variant="warning">Awaiting completion</Badge>
                      ) : (
                        <Badge variant="secondary">Scheduled</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/training/classes"
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
