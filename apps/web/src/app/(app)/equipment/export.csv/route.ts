import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { equipmentItems, equipmentTypes, orgUnits, people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['asset_tag', 'name', 'status', 'site', 'holder', 'purchase_date'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'asset_tag',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(equipmentItems.assetTag, term),
        ilike(equipmentItems.name, term),
        ilike(equipmentItems.serialNumber, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(equipmentItems.status, statusFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'name'
        ? [params.dir === 'asc' ? asc(equipmentItems.name) : desc(equipmentItems.name)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(equipmentItems.status) : desc(equipmentItems.status)]
          : params.sort === 'site'
            ? [params.dir === 'asc' ? asc(orgUnits.name) : desc(orgUnits.name)]
            : params.sort === 'holder'
              ? [params.dir === 'asc' ? asc(people.lastName) : desc(people.lastName)]
              : params.sort === 'purchase_date'
                ? [params.dir === 'asc' ? asc(equipmentItems.purchaseDate) : desc(equipmentItems.purchaseDate)]
                : [params.dir === 'asc' ? asc(equipmentItems.assetTag) : desc(equipmentItems.assetTag)]

    return tx
      .select({ item: equipmentItems, type: equipmentTypes, site: orgUnits, holder: people })
      .from(equipmentItems)
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)
  })

  await recordAudit(ctx, {
    entityType: 'equipment_item',
    action: 'export',
    summary: `Exported ${rows.length} equipment items to CSV`,
    metadata: { format: 'csv', filters: { q: params.q ?? null, status: statusFilter ?? null } },
  })

  return csvResponse({
    filename: csvFilename('equipment'),
    headers: [
      'Asset tag',
      'Name',
      'Type',
      'Serial #',
      'Status',
      'Missing',
      'Site',
      'Holder',
      'Purchase date',
    ],
    rows: rows.map(({ item, type, site, holder }) => [
      item.assetTag,
      item.name,
      type?.name ?? '',
      item.serialNumber ?? '',
      item.status,
      item.isMissing ? 'yes' : 'no',
      site?.name ?? '',
      holder ? `${holder.firstName} ${holder.lastName}` : '',
      item.purchaseDate ?? '',
    ]),
  })
}
