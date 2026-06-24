import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { documents } from '@beaconhs/db/schema'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['title', 'category', 'status', 'next_review_on'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'title',
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
      const cond = or(ilike(documents.title, term), ilike(documents.description, term))
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(documents.status, statusFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'category'
        ? [params.dir === 'asc' ? asc(documents.category) : desc(documents.category)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(documents.status) : desc(documents.status)]
          : params.sort === 'next_review_on'
            ? [params.dir === 'asc' ? asc(documents.nextReviewOn) : desc(documents.nextReviewOn)]
            : [params.dir === 'asc' ? asc(documents.title) : desc(documents.title)]

    return tx
      .select()
      .from(documents)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)
  })

  await recordAudit(ctx, {
    entityType: 'document',
    action: 'export',
    summary: `Exported ${rows.length} documents to CSV`,
    metadata: { format: 'csv', filters: { q: params.q ?? null, status: statusFilter ?? null } },
  })

  return csvResponse({
    filename: csvFilename('documents'),
    headers: [
      'Title',
      'Key',
      'Category',
      'Status',
      'Next review',
      'Review frequency (months)',
      'Description',
    ],
    rows: rows.map((d) => [
      d.title,
      d.key,
      d.category ?? '',
      d.status,
      d.nextReviewOn ?? '',
      d.reviewFrequencyMonths ?? '',
      d.description ?? '',
    ]),
  })
}
