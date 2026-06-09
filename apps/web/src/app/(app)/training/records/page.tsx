// Dedicated /training/records list page. The /training landing page is the
// rolled-up dashboard; this is the flat, paginated, bulk-actionable list of
// every training_record row scoped to the tenant.
//
// The list supports the same patterns as the other entity pages:
//   - Search by employee name / employee# / course code or name
//   - Filter chips by source (class / self_paced / evaluator / external_upload /
//     migrated)
//   - Filter chip "Expired" toggle
//   - Sort by completedOn / expiresOn / source / employee / course

import Link from 'next/link'
import { Award } from 'lucide-react'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
} from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { people, trainingCourses, trainingRecords } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { TrainingRecordsTable, type TrainingRecordsTableRow } from './_records-table'

export const metadata = { title: 'Training Records' }
export const dynamic = 'force-dynamic'

const SORTS = ['completed_on', 'expires_on', 'source', 'employee', 'course'] as const

const SOURCE_OPTIONS = [
  { value: 'class', label: 'Class' },
  { value: 'self_paced', label: 'Self-paced' },
  { value: 'evaluator', label: 'Evaluator' },
  { value: 'external_upload', label: 'External upload' },
  { value: 'migrated', label: 'Migrated' },
]

const EXPIRY_OPTIONS = [
  { value: 'expired', label: 'Expired only' },
  { value: 'current', label: 'Current only' },
]

export default async function TrainingRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'completed_on',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const sourceFilter = pickString(sp.source)
  const expiryFilter = pickString(sp.expiry)
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)

  const { rows, total, sourceCounts, expiryCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(trainingRecords.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(people.firstName, term),
        ilike(people.lastName, term),
        ilike(people.employeeNo, term),
        ilike(trainingCourses.code, term),
        ilike(trainingCourses.name, term),
      )
      if (cond) filters.push(cond)
    }
    if (sourceFilter) filters.push(eq(trainingRecords.source, sourceFilter as any))
    if (expiryFilter === 'expired') {
      filters.push(isNotNull(trainingRecords.expiresOn))
      filters.push(lte(trainingRecords.expiresOn, today))
    } else if (expiryFilter === 'current') {
      // "Current" = either no expiry at all, or expiry > today.
      const c = or(isNull(trainingRecords.expiresOn), gt(trainingRecords.expiresOn, today))
      if (c) filters.push(c)
    }

    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'expires_on'
        ? [params.dir === 'asc' ? asc(trainingRecords.expiresOn) : desc(trainingRecords.expiresOn)]
        : params.sort === 'source'
          ? [params.dir === 'asc' ? asc(trainingRecords.source) : desc(trainingRecords.source)]
          : params.sort === 'employee'
            ? params.dir === 'asc'
              ? [asc(people.lastName), asc(people.firstName)]
              : [desc(people.lastName), desc(people.firstName)]
            : params.sort === 'course'
              ? [params.dir === 'asc' ? asc(trainingCourses.code) : desc(trainingCourses.code)]
              : [
                  params.dir === 'asc'
                    ? asc(trainingRecords.completedOn)
                    : desc(trainingRecords.completedOn),
                ]

    const [tot] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(whereClause)
    const data = await tx
      .select({
        record: trainingRecords,
        person: people,
        course: trainingCourses,
      })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const sources = await tx
      .select({ s: trainingRecords.source, c: count() })
      .from(trainingRecords)
      .where(isNull(trainingRecords.deletedAt))
      .groupBy(trainingRecords.source)

    const [expiredCount] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .where(
        and(
          isNull(trainingRecords.deletedAt),
          isNotNull(trainingRecords.expiresOn),
          lte(trainingRecords.expiresOn, today),
        ),
      )
    const [currentCount] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .where(
        and(
          isNull(trainingRecords.deletedAt),
          or(isNull(trainingRecords.expiresOn), gt(trainingRecords.expiresOn, today)),
        ),
      )

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      sourceCounts: Object.fromEntries(sources.map((s) => [s.s, Number(s.c)])),
      expiryCounts: {
        expired: Number(expiredCount?.c ?? 0),
        current: Number(currentCount?.c ?? 0),
      } as Record<string, number>,
    }
  })

  const tableRows: TrainingRecordsTableRow[] = rows.map(({ record, person, course }) => {
    let daysToExpiry: number | null = null
    if (record.expiresOn) {
      const exp = new Date(record.expiresOn).getTime()
      const now = Date.now()
      daysToExpiry = Math.round((exp - now) / 86_400_000)
    }
    return {
      id: record.id,
      personId: person.id,
      personFirstName: person.firstName,
      personLastName: person.lastName,
      personEmployeeNo: person.employeeNo,
      courseId: course.id,
      courseCode: course.code,
      courseName: course.name,
      completedOn: record.completedOn,
      expiresOn: record.expiresOn,
      source: record.source,
      daysToExpiry,
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Training Records"
            description="Every issued training record — flat, paginated, bulk-actionable."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/training">
                  <Button variant="outline">Dashboard</Button>
                </Link>
                <Link href="/training/records/new">
                  <Button>Log a record</Button>
                </Link>
              </div>
            }
          />
          <TrainingSubNav active="records" />
          <TableToolbar>
            <SearchInput placeholder="Search employee, employee #, course…" />
            <FilterChips
              basePath="/training/records"
              currentParams={sp}
              paramKey="source"
              label="Source"
              options={SOURCE_OPTIONS.map((o) => ({
                ...o,
                count: sourceCounts[o.value],
              }))}
            />
            <FilterChips
              basePath="/training/records"
              currentParams={sp}
              paramKey="expiry"
              label="Expiry"
              options={EXPIRY_OPTIONS.map((o) => ({
                ...o,
                count: expiryCounts[o.value],
              }))}
            />
          </TableToolbar>
        </>
      }
    >
      {tableRows.length === 0 ? (
        <EmptyState
          icon={<Award size={32} />}
          title={
            params.q || sourceFilter || expiryFilter
              ? 'No training records match these filters'
              : 'No training records yet'
          }
          description="Issue a certificate, complete a class, or upload an external record."
          action={
            <Link href="/training/records/new">
              <Button>Log your first record</Button>
            </Link>
          }
        />
      ) : (
        <>
          <TrainingRecordsTable rows={tableRows} />
          <Pagination
            basePath="/training/records"
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
