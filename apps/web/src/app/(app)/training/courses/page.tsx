import Link from 'next/link'
import { GraduationCap } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import {
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
import { trainingCourses } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { TrainingSubNav } from '../_components/training-sub-nav'

export const metadata = { title: 'Training courses' }

const SORTS = ['name', 'code', 'delivery_type', 'valid_for_months'] as const

const DELIVERY_OPTIONS = [
  { value: 'classroom', label: 'Classroom' },
  { value: 'self_paced', label: 'Self-paced' },
  { value: 'online', label: 'Online' },
  { value: 'on_the_job', label: 'On-the-job' },
  { value: 'external_certificate', label: 'External cert' },
]

export default async function TrainingCoursesPage({
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
  const deliveryFilter = pickString(sp.delivery)
  const ctx = await requireRequestContext()
  const canExport =
    can(ctx, 'admin.data.export') &&
    (can(ctx, 'training.read.all') || can(ctx, 'training.course.manage'))
  // Creating courses is a training-management mutation — hide the entry point
  // for everyone else (createCourse re-checks server-side).
  const canManage = canManageModule(ctx, 'training')

  const { rows, total, deliveryCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(trainingCourses.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(trainingCourses.name, term), ilike(trainingCourses.code, term))
      if (cond) filters.push(cond)
    }
    if (deliveryFilter) filters.push(eq(trainingCourses.deliveryType, deliveryFilter as any))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'code'
        ? [params.dir === 'asc' ? asc(trainingCourses.code) : desc(trainingCourses.code)]
        : params.sort === 'delivery_type'
          ? [
              params.dir === 'asc'
                ? asc(trainingCourses.deliveryType)
                : desc(trainingCourses.deliveryType),
            ]
          : params.sort === 'valid_for_months'
            ? [
                params.dir === 'asc'
                  ? asc(trainingCourses.validForMonths)
                  : desc(trainingCourses.validForMonths),
              ]
            : [params.dir === 'asc' ? asc(trainingCourses.name) : desc(trainingCourses.name)]

    const [tot] = await tx.select({ c: count() }).from(trainingCourses).where(whereClause)
    const data = await tx
      .select()
      .from(trainingCourses)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const dd = await tx
      .select({ s: trainingCourses.deliveryType, c: count() })
      .from(trainingCourses)
      .where(isNull(trainingCourses.deletedAt))
      .groupBy(trainingCourses.deliveryType)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      deliveryCounts: Object.fromEntries(dd.map((x) => [x.s, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/training/courses', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Training courses"
            description="Courses across classroom, self-paced, on-the-job, and external formats."
            actions={
              <div className="flex items-center gap-2">
                {canExport ? (
                  <Link href={buildExportHref('/training/courses/export.csv', sp)}>
                    <Button variant="outline">Export CSV</Button>
                  </Link>
                ) : null}
                {canManage ? (
                  <Link href="/training/courses/new">
                    <Button>New course</Button>
                  </Link>
                ) : null}
              </div>
            }
          />
          <TrainingSubNav active="courses" />
          <TableToolbar>
            <SearchInput placeholder="Search by name or code" />
            <FilterChips
              basePath="/training/courses"
              currentParams={sp}
              paramKey="delivery"
              label="Delivery"
              options={DELIVERY_OPTIONS.map((o) => ({ ...o, count: deliveryCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<GraduationCap size={32} />}
          title={params.q ? 'No matching courses' : 'No courses'}
          description="Add a course to start tracking competencies."
          action={
            canManage ? (
              <Link href="/training/courses/new">
                <Button>New course</Button>
              </Link>
            ) : undefined
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
                <SortableTh {...sortProps} column="code" active={params.sort === 'code'}>
                  Code
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="delivery_type"
                  active={params.sort === 'delivery_type'}
                >
                  Delivery
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="valid_for_months"
                  active={params.sort === 'valid_for_months'}
                >
                  Validity
                </SortableTh>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link
                      href={`/training/courses/${c.id}`}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                    {c.code}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {c.deliveryType.replace(/_/g, ' ')}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {c.validForMonths ? `${c.validForMonths} months` : 'No expiry'}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {c.durationMinutes ? `${c.durationMinutes} min` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/training/courses"
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
