import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import { people, ppeItems, ppeTypes } from '@beaconhs/db/schema'
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

const SORTS = ['type', 'serial', 'size', 'status', 'holder'] as const

const STATUS_VALUES = ['in_stock', 'issued', 'returned', 'damaged', 'discarded', 'expired'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'type',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Mirror the register's status handling exactly: default to issued when no
  // param is present, `all` clears the filter, and unknown values are ignored
  // instead of reaching Postgres as invalid enum input.
  const statusRaw = pickString(sp.status) ?? 'issued'
  const statusFilter = (STATUS_VALUES as readonly string[]).includes(statusRaw)
    ? (statusRaw as (typeof STATUS_VALUES)[number])
    : undefined
  const ctx = await requireExportContext()
  // PPE has a single read tier (read.all); gate the tenant-wide export on it.
  assertCan(ctx, 'ppe.read.all')

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(ppeItems.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(ppeItems.serialNumber, term), ilike(ppeTypes.name, term))
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(ppeItems.status, statusFilter))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'serial'
        ? [params.dir === 'asc' ? asc(ppeItems.serialNumber) : desc(ppeItems.serialNumber)]
        : params.sort === 'size'
          ? [params.dir === 'asc' ? asc(ppeItems.size) : desc(ppeItems.size)]
          : params.sort === 'status'
            ? [params.dir === 'asc' ? asc(ppeItems.status) : desc(ppeItems.status)]
            : params.sort === 'holder'
              ? [params.dir === 'asc' ? asc(people.lastName) : desc(people.lastName)]
              : [params.dir === 'asc' ? asc(ppeTypes.name) : desc(ppeTypes.name)]

    return tx
      .select({ item: ppeItems, type: ppeTypes, holder: people })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(CSV_EXPORT_QUERY_LIMIT)
  })

  const overflow = csvExportOverflowResponse(rows.length)
  if (overflow) return overflow

  await recordAudit(ctx, {
    entityType: 'ppe_item',
    action: 'export',
    summary: `Exported ${rows.length} PPE items to CSV`,
    metadata: { format: 'csv', filters: { q: params.q ?? null, status: statusFilter ?? null } },
  })

  const columns = csvColumns([
    'Type',
    'Serial #',
    'Size',
    'Status',
    'Holder',
    'Purchase date',
    'Expires on',
    'Next inspection',
  ])
  const selection = selectCsvColumns(url.searchParams, columns)

  return csvResponse({
    filename: csvFilename('ppe'),
    headers: selection.headers,
    rows: rows.map(({ item, type, holder }) =>
      selection.project([
        type.name,
        item.serialNumber ?? '',
        item.size ?? '',
        item.status,
        holder ? `${holder.firstName} ${holder.lastName}` : '',
        item.purchaseDate ?? '',
        item.expiresOn ?? '',
        item.nextInspectionDue ?? '',
      ]),
    ),
  })
}
