import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm'
import { equipmentExpenses, equipmentItems, equipmentTypes, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

const SORTS = ['incurred_on', 'category', 'amount', 'vendor'] as const

export async function GET(req: NextRequest) {
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'incurred_on',
    dir: 'desc',
    perPage: 10000,
    allowedSorts: SORTS,
  })
  const categoryFilter = pickString(sp.category)
  const itemFilter = pickString(sp.item)
  const fromDate = pickString(sp.from)
  const toDate = pickString(sp.to)
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(equipmentExpenses.vendor, term),
        ilike(equipmentExpenses.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (categoryFilter) filters.push(eq(equipmentExpenses.category, categoryFilter))
    if (itemFilter) filters.push(eq(equipmentExpenses.equipmentItemId, itemFilter))
    if (fromDate) filters.push(gte(equipmentExpenses.incurredOn, fromDate))
    if (toDate) filters.push(lte(equipmentExpenses.incurredOn, toDate))
    const where = filters.length ? and(...filters) : undefined

    const orderBy =
      params.sort === 'category'
        ? [
            params.dir === 'asc'
              ? asc(equipmentExpenses.category)
              : desc(equipmentExpenses.category),
          ]
        : params.sort === 'amount'
          ? [params.dir === 'asc' ? asc(equipmentExpenses.amount) : desc(equipmentExpenses.amount)]
          : params.sort === 'vendor'
            ? [
                params.dir === 'asc'
                  ? asc(equipmentExpenses.vendor)
                  : desc(equipmentExpenses.vendor),
              ]
            : [
                params.dir === 'asc'
                  ? asc(equipmentExpenses.incurredOn)
                  : desc(equipmentExpenses.incurredOn),
              ]

    return tx
      .select({
        e: equipmentExpenses,
        item: equipmentItems,
        type: equipmentTypes,
        site: orgUnits,
      })
      .from(equipmentExpenses)
      .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentExpenses.equipmentItemId))
      .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentExpenses.chargedToOrgUnitId))
      .where(where)
      .orderBy(...orderBy)
      .limit(params.perPage)
  })

  return csvResponse({
    filename: csvFilename('equipment-expenses'),
    headers: [
      'Date',
      'Asset tag',
      'Equipment name',
      'Equipment type',
      'Category',
      'Vendor',
      'Description',
      'Amount',
      'Currency',
      'Charged to',
    ],
    rows: rows.map(({ e, item, type, site }) => [
      e.incurredOn,
      item?.assetTag ?? '',
      item?.name ?? '',
      type?.name ?? '',
      e.category,
      e.vendor ?? '',
      e.description ?? '',
      e.amount,
      e.currency,
      site?.name ?? '',
    ]),
  })
}
