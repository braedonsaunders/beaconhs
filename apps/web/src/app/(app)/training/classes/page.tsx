import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { CalendarCheck, CalendarDays } from 'lucide-react'
import { and, asc, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm'
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
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { parseListParams, pickString } from '@/lib/list-params'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { ListPageLayout } from '@/components/page-layout'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { startClass } from './_actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_13787d58057c44') }
}
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'starts_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const whenFilter = pickString(sp.when) ?? 'upcoming'
  const ctx = await requireRequestContext()
  // Only class managers get the create affordances; viewing the schedule stays
  // open. Scheduling itself is enforced server-side in startClass.
  const canManageClasses = can(ctx, 'training.class.manage')

  const now = new Date()

  const { rows, total, attendeeCounts, whenCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const search = or(
        ilike(trainingClasses.title, term),
        ilike(trainingCourses.name, term),
        ilike(trainingCourses.code, term),
        ilike(orgUnits.name, term),
      )
      if (search) filters.push(search)
    }
    if (whenFilter === 'upcoming') filters.push(gte(trainingClasses.startsAt, now))
    else if (whenFilter === 'past') filters.push(lt(trainingClasses.startsAt, now))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'course'
        ? [params.dir === 'asc' ? asc(trainingCourses.name) : desc(trainingCourses.name)]
        : params.sort === 'title'
          ? [params.dir === 'asc' ? asc(trainingClasses.title) : desc(trainingClasses.title)]
          : [params.dir === 'asc' ? asc(trainingClasses.startsAt) : desc(trainingClasses.startsAt)]

    const [tot] = await tx
      .select({ c: count() })
      .from(trainingClasses)
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingClasses.courseId))
      .leftJoin(orgUnits, eq(orgUnits.id, trainingClasses.siteOrgUnitId))
      .where(whereClause)
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
      tx.select({ c: count() }).from(trainingClasses).where(gte(trainingClasses.startsAt, now)),
      tx.select({ c: count() }).from(trainingClasses).where(lt(trainingClasses.startsAt, now)),
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
            title={tGenerated('m_13787d58057c44')}
            description={tGenerated('m_140f6134931cdd')}
            actions={
              <div className="flex items-center gap-2">
                <Link href="/training/classes/calendar">
                  <Button variant="outline">
                    <CalendarDays size={14} /> <GeneratedText id="m_1bc992ef921e66" />
                  </Button>
                </Link>
                <GeneratedValue
                  value={
                    canManageClasses ? (
                      <form action={startClass}>
                        <Button type="submit">
                          <GeneratedText id="m_1ed51714de09bd" />
                        </Button>
                      </form>
                    ) : null
                  }
                />
              </div>
            }
          />
          <TrainingSubNav active="classes" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_0b44a104639d3f')} />
            <FilterChips
              basePath="/training/classes"
              currentParams={sp}
              paramKey="when"
              label={tGenerated('m_13cc128f69897c')}
              options={WHEN_OPTIONS.map((o) => ({
                ...o,
                count: whenCounts[o.value as keyof typeof whenCounts],
              }))}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<CalendarCheck size={32} />}
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_1ccbcb9383f578')
                  : whenFilter === 'past'
                    ? tGenerated('m_0626f6b92c5fe9')
                    : tGenerated('m_1f4eb661e5a826'),
              )}
              description={tGeneratedValue(
                params.q ? tGenerated('m_1e7a7de9d352b5') : tGenerated('m_1de55bc61159fc'),
              )}
              action={
                canManageClasses ? (
                  <form action={startClass}>
                    <Button type="submit">
                      <GeneratedText id="m_0373a427c41a8c" />
                    </Button>
                  </form>
                ) : undefined
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
                      <GeneratedText id="m_13cc128f69897c" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="title" active={params.sort === 'title'}>
                      <GeneratedText id="m_0decefd558c355" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="course" active={params.sort === 'course'}>
                      <GeneratedText id="m_14fc1e0739b60e" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_020146dd3d3d5a" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_10ba268d95c8fb" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map((row) => {
                      const startedAt = new Date(row.cls.startsAt)
                      const endsAt = new Date(row.cls.endsAt)
                      const inPast = endsAt < now
                      const attCount = attendeeCounts[row.cls.id] ?? 0
                      return (
                        <TableRow key={row.cls.id}>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            <div className="text-sm">
                              <GeneratedValue
                                value={formatDate(startedAt, ctx.timezone, ctx.locale)}
                              />
                            </div>
                            <div className="text-xs text-slate-400">
                              <GeneratedValue
                                value={startedAt.toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  timeZone: ctx.timezone,
                                })}
                              />
                            </div>
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/training/classes/${row.cls.id}`}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={row.cls.title} />
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/training/courses/${row.course.id}`}
                              className="text-sm text-teal-700 hover:underline dark:text-teal-400"
                            >
                              <GeneratedValue value={row.course.name} />
                            </Link>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            <GeneratedValue value={row.site?.name ?? '—'} />
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              <GeneratedValue value={attCount} />
                              <GeneratedValue
                                value={row.cls.capacity ? ` / ${row.cls.capacity}` : ''}
                              />
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                row.cls.cancelledAt ? (
                                  <Badge variant="destructive">
                                    <GeneratedText id="m_1a7e1cf2be443e" />
                                  </Badge>
                                ) : row.cls.completedAt ? (
                                  <Badge variant="success">
                                    <GeneratedText id="m_0ba7a5e1b2fa32" />
                                  </Badge>
                                ) : inPast ? (
                                  <Badge variant="warning">
                                    <GeneratedText id="m_1ea7f550466859" />
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_14ad4ca1d87e79" />
                                  </Badge>
                                )
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
                basePath="/training/classes"
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
