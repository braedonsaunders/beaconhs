import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import { primaryPersonTitleName } from '@beaconhs/db'
import { departments, people, trades } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  CSV_EXPORT_QUERY_LIMIT,
  csvExportOverflowResponse,
  csvFilename,
  csvResponse,
} from '@/lib/csv'
import { csvColumns, selectCsvColumns } from '@/lib/export-columns'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = [
  'name',
  'employee_no',
  'title',
  'hire_date',
  'department',
  'trade',
  'status',
] as const
const STATUS_FILTERS = ['active', 'inactive', 'terminated', 'all'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, { sort: 'name', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  // Mirror the /people list's filters exactly so the export matches what the
  // user sees: default status=active, optional department, never soft-deleted.
  const rawStatus = pickString(sp.status) ?? 'active'
  const statusFilter: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(rawStatus)
    ? (rawStatus as StatusFilter)
    : 'active'
  const departmentFilter = pickString(sp.department) ?? null
  const ctx = await requireExportContext()
  assertCan(ctx, 'admin.users.manage')

  const rows = await ctx.db(async (tx) => {
    const primaryTitleName = primaryPersonTitleName(people.id, people.tenantId)
    const filters: SQL<unknown>[] = [isNull(people.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(people.firstName, term),
        ilike(people.lastName, term),
        ilike(people.employeeNo, term),
        ilike(primaryTitleName, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter !== 'all') filters.push(eq(people.status, statusFilter))
    if (departmentFilter) filters.push(eq(people.departmentId, departmentFilter))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'name'
        ? params.dir === 'asc'
          ? [asc(people.lastName), asc(people.firstName)]
          : [desc(people.lastName), desc(people.firstName)]
        : params.sort === 'employee_no'
          ? [params.dir === 'asc' ? asc(people.employeeNo) : desc(people.employeeNo)]
          : params.sort === 'title'
            ? [params.dir === 'asc' ? asc(primaryTitleName) : desc(primaryTitleName)]
            : params.sort === 'hire_date'
              ? [params.dir === 'asc' ? asc(people.hireDate) : desc(people.hireDate)]
              : params.sort === 'department'
                ? [params.dir === 'asc' ? asc(departments.name) : desc(departments.name)]
                : params.sort === 'status'
                  ? [params.dir === 'asc' ? asc(people.status) : desc(people.status)]
                  : [params.dir === 'asc' ? asc(trades.name) : desc(trades.name)]

    return tx
      .select({
        person: people,
        department: departments,
        trade: trades,
        primaryTitleName,
      })
      .from(people)
      .leftJoin(departments, eq(departments.id, people.departmentId))
      .leftJoin(trades, eq(trades.id, people.tradeId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(CSV_EXPORT_QUERY_LIMIT)
  })

  const overflow = csvExportOverflowResponse(rows.length)
  if (overflow) return overflow

  await recordAudit(ctx, {
    entityType: 'people',
    action: 'export',
    summary: `Exported ${rows.length} people to CSV`,
    metadata: {
      format: 'csv',
      filters: { q: params.q ?? null, status: statusFilter, department: departmentFilter },
    },
  })

  const columns = csvColumns([
    'Last name',
    'First name',
    'Employee #',
    'Primary job title',
    'Department',
    'Trade',
    'Hire date',
    'Email',
    'Phone',
    'Status',
  ])
  const selection = selectCsvColumns(url.searchParams, columns)

  return csvResponse({
    filename: csvFilename('people'),
    headers: selection.headers,
    rows: rows.map((r) =>
      selection.project([
        r.person.lastName,
        r.person.firstName,
        r.person.employeeNo ?? '',
        r.primaryTitleName ?? '',
        r.department?.name ?? '',
        r.trade?.name ?? '',
        r.person.hireDate ?? '',
        r.person.email ?? '',
        r.person.phone ?? '',
        r.person.status,
      ]),
    ),
  })
}
