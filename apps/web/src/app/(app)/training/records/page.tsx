import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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

import { notFound } from 'next/navigation'
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
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { latestTrainingRecordOnly } from '@/lib/training-latest'
import { moduleScopeWhere } from '@/lib/visibility'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SearchFilter } from '@/components/search-filter'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { startTrainingRecord } from './_actions'
import { TrainingRecordsTable, type TrainingRecordsTableRow } from './_records-table'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0a14bf1b44e910') }
}
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'completed_on',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const sourceFilter = pickString(sp.source)
  const expiryFilter = pickString(sp.expiry)
  const personFilter = pickString(sp.person)
  const courseFilter = pickString(sp.course)
  const ctx = await requireRequestContext()
  // Access control: viewing certificates requires a training-read permission.
  // read.all (or super-admin) sees the whole tenant; read.self is scoped to the
  // viewer's own person by moduleScopeWhere below. No training-read permission
  // at all → 404, mirroring the find_training_records assistant-tool gate.
  if (!ctx.isSuperAdmin && !can(ctx, 'training.read.all') && !can(ctx, 'training.read.self'))
    notFound()
  // Bulk-action availability — the floating bar and row checkboxes render only
  // when the viewer can act. Renew/Revoke need training.record.create; bulk CSV
  // export is restricted to all-viewers (a self-only viewer must not export
  // arbitrary ids). The server actions re-check these via assertCan.
  const canManage = can(ctx, 'training.record.create')
  const canExport = can(ctx, 'training.read.all')
  const today = new Date().toISOString().slice(0, 10)
  const todayMs = new Date(today).getTime()

  const { rows, total, sourceCounts, expiryCounts, peopleList, coursesList } = await ctx.db(
    async (tx) => {
      // read.self → only the viewer's own records; read.all → the whole tenant.
      const vis = await moduleScopeWhere(ctx, tx, {
        prefix: 'training',
        personCol: trainingRecords.personId,
      })
      const filters: SQL<unknown>[] = [isNull(trainingRecords.deletedAt)]
      if (vis) filters.push(vis)
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
      if (personFilter) filters.push(eq(trainingRecords.personId, personFilter))
      if (courseFilter) filters.push(eq(trainingRecords.courseId, courseFilter))
      // Defaults to "current" when no expiry param is present; the "All" chip
      // navigates to an explicit `all` sentinel to show every record.
      const effectiveExpiry = expiryFilter ?? 'current'
      if (effectiveExpiry === 'expired') {
        // "Expired" = the person's current standing for the course has lapsed.
        // A record superseded by retraining isn't an outstanding expiry — it
        // stays visible under "All" only.
        filters.push(isNotNull(trainingRecords.expiresOn))
        filters.push(lte(trainingRecords.expiresOn, today))
        filters.push(latestTrainingRecordOnly())
      } else if (effectiveExpiry === 'current') {
        // "Current" = either no expiry at all, or expiry > today.
        const c = or(isNull(trainingRecords.expiresOn), gt(trainingRecords.expiresOn, today))
        if (c) filters.push(c)
      }

      const whereClause = and(...filters)

      const orderBy =
        params.sort === 'expires_on'
          ? [
              params.dir === 'asc'
                ? asc(trainingRecords.expiresOn)
                : desc(trainingRecords.expiresOn),
            ]
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
          // Rows replaced by a newer record for the same person + course render
          // a "Superseded" badge instead of "Expired" (visible under "All").
          isLatest: latestTrainingRecordOnly().mapWith(Boolean),
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
        .where(and(isNull(trainingRecords.deletedAt), vis))
        .groupBy(trainingRecords.source)

      const [expiredCount] = await tx
        .select({ c: count() })
        .from(trainingRecords)
        .where(
          and(
            isNull(trainingRecords.deletedAt),
            isNotNull(trainingRecords.expiresOn),
            lte(trainingRecords.expiresOn, today),
            latestTrainingRecordOnly(),
            vis,
          ),
        )
      const [currentCount] = await tx
        .select({ c: count() })
        .from(trainingRecords)
        .where(
          and(
            isNull(trainingRecords.deletedAt),
            or(isNull(trainingRecords.expiresOn), gt(trainingRecords.expiresOn, today)),
            vis,
          ),
        )

      // Filter option lists. People scoped to the records the viewer can see
      // (vis) so a self-only viewer doesn't get the whole directory; courses are
      // tenant-wide catalogue entries.
      const peopleList = await tx
        .selectDistinct({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
        })
        .from(trainingRecords)
        .innerJoin(people, eq(people.id, trainingRecords.personId))
        .where(and(isNull(trainingRecords.deletedAt), vis))
        .orderBy(asc(people.lastName), asc(people.firstName))
      const coursesList = await tx
        .select({ id: trainingCourses.id, name: trainingCourses.name, code: trainingCourses.code })
        .from(trainingCourses)
        .where(isNull(trainingCourses.deletedAt))
        .orderBy(asc(trainingCourses.name))

      return {
        rows: data,
        total: Number(tot?.c ?? 0),
        sourceCounts: Object.fromEntries(sources.map((s) => [s.s, Number(s.c)])),
        expiryCounts: {
          expired: Number(expiredCount?.c ?? 0),
          current: Number(currentCount?.c ?? 0),
        } as Record<string, number>,
        peopleList,
        coursesList,
      }
    },
  )
  const tableRows: TrainingRecordsTableRow[] = rows.map(({ record, person, course, isLatest }) => {
    let daysToExpiry: number | null = null
    if (record.expiresOn) {
      const exp = new Date(record.expiresOn).getTime()
      daysToExpiry = Math.round((exp - todayMs) / 86_400_000)
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
      superseded: !isLatest,
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_0a14bf1b44e910')}
            description={tGenerated('m_14c4285df5033b')}
            actions={
              canManage ? (
                <form action={startTrainingRecord}>
                  <Button type="submit">
                    <GeneratedText id="m_0889fafbafcb00" />
                  </Button>
                </form>
              ) : undefined
            }
          />
          <TrainingSubNav active="records" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_13cc8f5d50e7ff')} />
            <GeneratedValue
              value={
                peopleList.length > 0 ? (
                  <SearchFilter
                    basePath="/training/records"
                    currentParams={sp}
                    paramKey="person"
                    placeholder={tGenerated('m_0110de6e7a2824')}
                    searchPlaceholder={tGenerated('m_0b842b664b4f3b')}
                    options={peopleList.map((p) => ({
                      value: p.id,
                      label: `${p.lastName}, ${p.firstName}`,
                      hint: p.employeeNo ?? undefined,
                    }))}
                  />
                ) : null
              }
            />
            <GeneratedValue
              value={
                coursesList.length > 0 ? (
                  <SearchFilter
                    basePath="/training/records"
                    currentParams={sp}
                    paramKey="course"
                    placeholder={tGenerated('m_1eff369e8cceb6')}
                    searchPlaceholder={tGenerated('m_030db64e0bf790')}
                    options={coursesList.map((c) => ({
                      value: c.id,
                      label: c.code ? `${c.code} · ${c.name}` : c.name,
                    }))}
                  />
                ) : null
              }
            />
            <FilterChips
              basePath="/training/records"
              currentParams={sp}
              paramKey="source"
              label={tGenerated('m_1d05fa7a091a9b')}
              options={SOURCE_OPTIONS.map((o) => ({
                ...o,
                count: sourceCounts[o.value],
              }))}
            />
            <FilterChips
              basePath="/training/records"
              currentParams={sp}
              paramKey="expiry"
              label={tGenerated('m_0fe9bb2ac8cee6')}
              defaultValue="current"
              options={EXPIRY_OPTIONS.map((o) => ({
                ...o,
                count: expiryCounts[o.value],
              }))}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          tableRows.length === 0 ? (
            <EmptyState
              icon={<Award size={32} />}
              title={tGeneratedValue(
                params.q || sourceFilter || expiryFilter || personFilter || courseFilter
                  ? tGenerated('m_147d4483853536')
                  : tGenerated('m_049950ab11f977'),
              )}
              description={tGenerated('m_089ad5abb00e33')}
              action={
                canManage ? (
                  <form action={startTrainingRecord}>
                    <Button type="submit">
                      <GeneratedText id="m_0889fafbafcb00" />
                    </Button>
                  </form>
                ) : undefined
              }
            />
          ) : (
            <>
              <TrainingRecordsTable
                rows={tableRows}
                basePath="/training/records"
                currentParams={sp}
                sort={params.sort}
                dir={params.dir}
                canManage={canManage}
                canExport={canExport}
              />
              <Pagination
                basePath="/training/records"
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
