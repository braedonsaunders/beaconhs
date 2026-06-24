import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { people, ppeItems, ppeTypes } from '@beaconhs/db/schema'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['type', 'serial', 'size', 'status', 'holder'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'type',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const ctx = await requireExportContext()

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(ppeItems.serialNumber, term), ilike(ppeTypes.name, term))
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(ppeItems.status, statusFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

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
      .limit(10_000)
  })

  await recordAudit(ctx, {
    entityType: 'ppe_item',
    action: 'export',
    summary: `Exported ${rows.length} PPE items to CSV`,
    metadata: { format: 'csv', filters: { q: params.q ?? null, status: statusFilter ?? null } },
  })

  return csvResponse({
    filename: csvFilename('ppe'),
    headers: [
      'Type',
      'Serial #',
      'Size',
      'Status',
      'Holder',
      'Purchase date',
      'Expires on',
      'Next inspection',
    ],
    rows: rows.map(({ item, type, holder }) => [
      type.name,
      item.serialNumber ?? '',
      item.size ?? '',
      item.status,
      holder ? `${holder.firstName} ${holder.lastName}` : '',
      item.purchaseDate ?? '',
      item.expiresOn ?? '',
      item.nextInspectionDue ?? '',
    ]),
  })
}
