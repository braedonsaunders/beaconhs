import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, type SQL } from 'drizzle-orm'
import { csPermits, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'status', 'issued_at', 'expires_at'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'issued_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = ilike(csPermits.title, term)
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(csPermits.status, statusFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [params.dir === 'asc' ? asc(csPermits.reference) : desc(csPermits.reference)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(csPermits.status) : desc(csPermits.status)]
          : params.sort === 'expires_at'
            ? [params.dir === 'asc' ? asc(csPermits.expiresAt) : desc(csPermits.expiresAt)]
            : [params.dir === 'asc' ? asc(csPermits.issuedAt) : desc(csPermits.issuedAt)]

    return tx
      .select({ permit: csPermits, site: orgUnits })
      .from(csPermits)
      .leftJoin(orgUnits, eq(orgUnits.id, csPermits.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)
  })

  await recordAudit(ctx, {
    entityType: 'cs_permit',
    action: 'export',
    summary: `Exported ${rows.length} confined-space permits to CSV`,
    metadata: { format: 'csv', filters: { q: params.q ?? null, status: statusFilter ?? null } },
  })

  return csvResponse({
    filename: csvFilename('cs-permits'),
    headers: ['Reference', 'Title', 'Status', 'Site', 'Issued', 'Expires', 'Space description'],
    rows: rows.map(({ permit, site }) => [
      permit.reference,
      permit.title,
      permit.status,
      site?.name ?? '',
      new Date(permit.issuedAt).toISOString(),
      new Date(permit.expiresAt).toISOString(),
      permit.spaceDescription ?? '',
    ]),
  })
}
