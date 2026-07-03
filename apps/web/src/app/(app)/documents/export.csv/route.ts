import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import { documents } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { csvColumns, selectCsvColumns } from '@/lib/export-columns'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['title', 'category', 'status', 'next_review_on'] as const

const STATUS_VALUES = ['draft', 'published', 'archived', 'under_review'] as const
type DocumentStatus = (typeof STATUS_VALUES)[number]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'title',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Validate query-string filters before they hit enum/uuid casts — a crafted
  // value is ignored rather than 500ing the export.
  const statusRaw = pickString(sp.status)
  const statusFilter = STATUS_VALUES.includes(statusRaw as DocumentStatus)
    ? (statusRaw as DocumentStatus)
    : undefined
  const categoryRaw = pickString(sp.category)
  const categoryFilter = categoryRaw && UUID_RE.test(categoryRaw) ? categoryRaw : undefined
  const typeRaw = pickString(sp.type)
  const typeFilter = typeRaw && UUID_RE.test(typeRaw) ? typeRaw : undefined
  const ctx = await requireExportContext()
  assertCan(ctx, 'documents.manage')

  const rows = await ctx.db(async (tx) => {
    // Mirror the /documents list page exactly: live rows only, plus the same
    // q/status/category/type filters the Export button forwards.
    const filters: SQL<unknown>[] = [isNull(documents.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(documents.title, term), ilike(documents.description, term))
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(documents.status, statusFilter))
    if (categoryFilter) filters.push(eq(documents.categoryId, categoryFilter))
    if (typeFilter) filters.push(eq(documents.typeId, typeFilter))
    const whereClause = and(...filters)

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
    metadata: {
      format: 'csv',
      filters: {
        q: params.q ?? null,
        status: statusFilter ?? null,
        category: categoryFilter ?? null,
        type: typeFilter ?? null,
      },
    },
  })

  const columns = csvColumns([
    'Title',
    'Key',
    'Category',
    'Status',
    'Next review',
    'Review frequency (months)',
    'Description',
  ])
  const selection = selectCsvColumns(url.searchParams, columns)

  return csvResponse({
    filename: csvFilename('documents'),
    headers: selection.headers,
    rows: rows.map((d) =>
      selection.project([
        d.title,
        d.key,
        d.category ?? '',
        d.status,
        d.nextReviewOn ?? '',
        d.reviewFrequencyMonths ?? '',
        d.description ?? '',
      ]),
    ),
  })
}
