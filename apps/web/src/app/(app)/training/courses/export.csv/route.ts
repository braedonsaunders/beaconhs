import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import { trainingCourses } from '@beaconhs/db/schema'
import { htmlToSnippet } from '@beaconhs/forms-core'
import { requireExportContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['name', 'code', 'delivery_type', 'valid_for_months'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const deliveryFilter = pickString(sp.delivery)
  const ctx = await requireExportContext()

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(trainingCourses.name, term), ilike(trainingCourses.code, term))
      if (cond) filters.push(cond)
    }
    if (deliveryFilter) filters.push(eq(trainingCourses.deliveryType, deliveryFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'code'
        ? [params.dir === 'asc' ? asc(trainingCourses.code) : desc(trainingCourses.code)]
        : params.sort === 'delivery_type'
          ? [
              params.dir === 'asc'
                ? asc(trainingCourses.deliveryType)
                : desc(trainingCourses.deliveryType),
            ]
          : params.sort === 'valid_for_months'
            ? [
                params.dir === 'asc'
                  ? asc(trainingCourses.validForMonths)
                  : desc(trainingCourses.validForMonths),
              ]
            : [params.dir === 'asc' ? asc(trainingCourses.name) : desc(trainingCourses.name)]

    return tx
      .select()
      .from(trainingCourses)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)
  })

  await recordAudit(ctx, {
    entityType: 'training_course',
    action: 'export',
    summary: `Exported ${rows.length} training courses to CSV`,
    metadata: { format: 'csv', filters: { q: params.q ?? null, delivery: deliveryFilter ?? null } },
  })

  return csvResponse({
    filename: csvFilename('training-courses'),
    headers: [
      'Name',
      'Code',
      'Delivery type',
      'Duration (min)',
      'Validity (months)',
      'Requires evaluator',
      'Description',
    ],
    rows: rows.map((c) => [
      c.name,
      c.code,
      c.deliveryType,
      c.durationMinutes ?? '',
      c.validForMonths ?? '',
      c.requiresEvaluator ? 'yes' : 'no',
      htmlToSnippet(c.description, 2000),
    ]),
  })
}
