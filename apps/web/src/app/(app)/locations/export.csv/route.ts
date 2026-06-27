import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, isNotNull, isNull, or, type SQL } from 'drizzle-orm'
import { orgUnits } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { csvColumns, selectCsvColumns } from '@/lib/export-columns'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['name', 'code'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status) ?? 'active'
  const ctx = await requireExportContext()
  assertCan(ctx, 'admin.org.manage')

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [eq(orgUnits.level, 'customer')]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(orgUnits.name, term), ilike(orgUnits.code, term))
      if (cond) filters.push(cond)
    }
    if (statusFilter === 'active') filters.push(isNull(orgUnits.deletedAt))
    else if (statusFilter === 'archived') filters.push(isNotNull(orgUnits.deletedAt))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'code'
        ? [params.dir === 'asc' ? asc(orgUnits.code) : desc(orgUnits.code)]
        : [params.dir === 'asc' ? asc(orgUnits.name) : desc(orgUnits.name)]

    return tx
      .select()
      .from(orgUnits)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)
  })

  await recordAudit(ctx, {
    entityType: 'org_unit',
    action: 'export',
    summary: `Exported ${rows.length} locations to CSV`,
    metadata: {
      format: 'csv',
      filters: { q: params.q ?? null, level: 'customer', status: statusFilter },
    },
  })

  const columns = csvColumns([
    'Name',
    'Code',
    'Level',
    'Address line 1',
    'City',
    'Region',
    'Postal code',
    'Country',
  ])
  const selection = selectCsvColumns(url.searchParams, columns)

  return csvResponse({
    filename: csvFilename('locations'),
    headers: selection.headers,
    rows: rows.map((u) => {
      const addr = u.address ?? {}
      return selection.project([
        u.name,
        u.code ?? '',
        u.level,
        (addr as any).line1 ?? '',
        (addr as any).city ?? '',
        (addr as any).region ?? '',
        (addr as any).postalCode ?? '',
        (addr as any).country ?? '',
      ])
    }),
  })
}
