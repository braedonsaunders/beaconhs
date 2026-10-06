import { ppeRegisterQuery } from '@/lib/ppe-register-query'
import type { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
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

import { isRouterPrefetch } from '@/lib/router-prefetch'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (isRouterPrefetch(req)) return new Response(null, { status: 204 })

  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const {
    params,
    statusFilter,
    inspectionFilter,
    typeFilter,
    holderFilter,
    where: whereClause,
    orderBy,
  } = ppeRegisterQuery(sp)
  const ctx = await requireExportContext()
  // PPE has a single read tier (read.all); gate the tenant-wide export on it.
  assertCan(ctx, 'ppe.read.all')

  const rows = await ctx.db(async (tx) => {
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
    metadata: {
      format: 'csv',
      filters: {
        q: params.q ?? null,
        status: statusFilter ?? null,
        type: typeFilter ?? null,
        holder: holderFilter ?? null,
        inspection: inspectionFilter ?? null,
      },
    },
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
