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
import { people, tenants, trainingCourses, trainingRecords } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { parseListParams, pickString } from '@/lib/list-params'
import { enabledCredentialOutputs } from '@/lib/credential-designs'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { TrainingRecordsTable, type TrainingRecordsTableRow } from './_records-table'

export const metadata = { title: 'Certificates' }
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

  const { rows, total, sourceCounts, expiryCounts, tenantSettings } = await ctx.db(async (tx) => {
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

    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      sourceCounts: Object.fromEntries(sources.map((s) => [s.s, Number(s.c)])),
      expiryCounts: {
        expired: Number(expiredCount?.c ?? 0),
        current: Number(currentCount?.c ?? 0),
      } as Record<string, number>,
      tenantSettings: tenant?.settings ?? {},
    }
  })
  const credentialOutputs = enabledCredentialOutputs(tenantSettings)

  const tableRows: TrainingRecordsTableRow[] = rows.map(({ record, person, course }) => {
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
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Certificates"
            description="Training records with completion dates and expiry tracking."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/training/courses/new">
                  <Button variant="outline">New course</Button>
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
            params.q || sourceFilter || expiryFilter ? 'No matching records' : 'No training records'
          }
          description="Issue a certificate, complete a class, or upload an external record."
          action={
            <Link href="/training/records/new">
              <Button>Log a record</Button>
            </Link>
          }
        />
      ) : (
        <>
          <TrainingRecordsTable
            rows={tableRows}
            credentialOutputs={credentialOutputs}
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
      )}
    </ListPageLayout>
  )
}
