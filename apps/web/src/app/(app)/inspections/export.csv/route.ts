import type { NextRequest } from 'next/server'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import {
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypes,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import { requireExportContext } from '@/lib/auth'
import { assertCan } from '@beaconhs/tenant'
import { moduleScopeWhere } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import {
  CSV_EXPORT_QUERY_LIMIT,
  csvExportOverflowResponse,
  csvFilename,
  csvResponse,
} from '@/lib/csv'
import { csvColumns, selectCsvColumns } from '@/lib/export-columns'
import { parseListParams, pickString } from '@/lib/list-params'
import { parseDateFilter } from '../_datetime'

export const dynamic = 'force-dynamic'

// Mirrors the filters/sort of the native records list (/inspections/records)
// so "Export CSV" honours whatever the user is currently looking at.
const SORTS = ['occurred_at', 'reference', 'type', 'status'] as const

const STATUS_VALUES = ['draft', 'in_progress', 'submitted', 'closed'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'occurred_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Whitelist the status param — unknown values would throw a Postgres enum
  // error, so they fall back to "no filter" (mirrors the list page).
  const statusRaw = pickString(sp.status)
  const statusFilter = (STATUS_VALUES as readonly string[]).includes(statusRaw ?? '')
    ? (statusRaw as (typeof STATUS_VALUES)[number])
    : undefined
  const typeFilter = pickString(sp.type)
  const siteFilter = pickString(sp.site)
  const inspectorFilter = pickString(sp.inspector)
  const signedFilter = pickString(sp.signed) // 'yes' | 'no'
  const dateFrom = parseDateFilter(pickString(sp.dateFrom), 'start')
  const dateTo = parseDateFilter(pickString(sp.dateTo), 'end')
  const ctx = await requireExportContext()
  // Read-tier gate: must hold at least the self read tier, and the export is
  // bounded to the caller's tier (read.self/site can't dump the whole tenant).
  assertCan(ctx, 'inspections.read.self')

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(inspectionRecords.deletedAt)]
    const scopeWhere = await moduleScopeWhere(ctx, tx, {
      prefix: 'inspections',
      ownerCols: [
        inspectionRecords.inspectorTenantUserId,
        inspectionRecords.submittedByTenantUserId,
      ],
      siteCol: inspectionRecords.siteOrgUnitId,
    })
    if (scopeWhere) filters.push(scopeWhere)
    if (params.q) {
      const term = `%${params.q}%`
      const c = or(
        ilike(inspectionRecords.reference, term),
        ilike(inspectionTypes.name, term),
        ilike(inspectionRecords.location, term),
        ilike(inspectionRecords.foremanText, term),
      )
      if (c) filters.push(c)
    }
    if (statusFilter) filters.push(eq(inspectionRecords.status, statusFilter))
    if (typeFilter) filters.push(eq(inspectionRecords.typeId, typeFilter))
    if (siteFilter) filters.push(eq(inspectionRecords.siteOrgUnitId, siteFilter))
    if (inspectorFilter) filters.push(eq(inspectionRecords.inspectorTenantUserId, inspectorFilter))
    if (signedFilter === 'yes') filters.push(isNotNull(inspectionRecords.customerSignedAt))
    if (signedFilter === 'no') filters.push(isNull(inspectionRecords.customerSignedAt))
    if (dateFrom) filters.push(gte(inspectionRecords.occurredAt, dateFrom))
    if (dateTo) filters.push(lte(inspectionRecords.occurredAt, dateTo))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [
            params.dir === 'asc'
              ? asc(inspectionRecords.reference)
              : desc(inspectionRecords.reference),
          ]
        : params.sort === 'type'
          ? [params.dir === 'asc' ? asc(inspectionTypes.name) : desc(inspectionTypes.name)]
          : params.sort === 'status'
            ? [
                params.dir === 'asc'
                  ? asc(inspectionRecords.status)
                  : desc(inspectionRecords.status),
              ]
            : [
                params.dir === 'asc'
                  ? asc(inspectionRecords.occurredAt)
                  : desc(inspectionRecords.occurredAt),
              ]

    return tx
      .select({
        record: inspectionRecords,
        type: inspectionTypes,
        inspectorName: user.name,
        passCount:
          sql<number>`coalesce(sum(case when ${inspectionRecordCriteria.answer} = 'pass' then 1 else 0 end), 0)`.mapWith(
            Number,
          ),
        failCount:
          sql<number>`coalesce(sum(case when ${inspectionRecordCriteria.answer} = 'fail' then 1 else 0 end), 0)`.mapWith(
            Number,
          ),
        naCount:
          sql<number>`coalesce(sum(case when ${inspectionRecordCriteria.answer} = 'n_a' then 1 else 0 end), 0)`.mapWith(
            Number,
          ),
      })
      .from(inspectionRecords)
      .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, inspectionRecords.inspectorTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .leftJoin(
        inspectionRecordCriteria,
        eq(inspectionRecordCriteria.recordId, inspectionRecords.id),
      )
      .where(whereClause)
      .groupBy(inspectionRecords.id, inspectionTypes.id, user.id)
      .orderBy(...orderBy)
      .limit(CSV_EXPORT_QUERY_LIMIT)
  })

  const overflow = csvExportOverflowResponse(rows.length)
  if (overflow) return overflow

  await recordAudit(ctx, {
    entityType: 'inspection_record',
    action: 'export',
    summary: `Exported ${rows.length} inspection records to CSV`,
    metadata: { format: 'csv', filters: { q: params.q ?? null, status: statusFilter ?? null } },
  })

  const columns = csvColumns([
    'Reference',
    'Type',
    'Status',
    'Occurred',
    'Location',
    'Inspector',
    'Pass',
    'Fail',
    'N/A',
    'Signed',
  ])
  const selection = selectCsvColumns(url.searchParams, columns)

  return csvResponse({
    filename: csvFilename('inspections'),
    headers: selection.headers,
    rows: rows.map((r) =>
      selection.project([
        r.record.reference,
        r.type.name,
        r.record.status,
        new Date(r.record.occurredAt).toISOString(),
        r.record.location ?? '',
        r.inspectorName ?? '',
        String(r.passCount ?? 0),
        String(r.failCount ?? 0),
        String(r.naCount ?? 0),
        r.record.customerSignedAt ? 'Signed' : 'Unsigned',
      ]),
    ),
  })
}
