import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, type SQL } from 'drizzle-orm'
import { formResponses, formTemplates, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

const SORTS = ['submitted_at', 'template', 'status'] as const

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const sp = Object.fromEntries(url.searchParams.entries())
  const params = parseListParams(sp, {
    sort: 'submitted_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status)
  const ctx = await requireRequestContext()

  const rows = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [eq(formTemplates.category, 'inspection')]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = ilike(formTemplates.name, term)
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(formResponses.status, statusFilter as any))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'template'
        ? [params.dir === 'asc' ? asc(formTemplates.name) : desc(formTemplates.name)]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(formResponses.status) : desc(formResponses.status)]
          : [params.dir === 'asc' ? asc(formResponses.submittedAt) : desc(formResponses.submittedAt)]

    return tx
      .select({ response: formResponses, template: formTemplates, site: orgUnits })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)
  })

  await recordAudit(ctx, {
    entityType: 'inspection_response',
    action: 'export',
    summary: `Exported ${rows.length} inspection responses to CSV`,
    metadata: { format: 'csv', filters: { q: params.q ?? null, status: statusFilter ?? null } },
  })

  return csvResponse({
    filename: csvFilename('inspections'),
    headers: ['Response ID', 'Template', 'Status', 'Submitted', 'Site'],
    rows: rows.map(({ response, template, site }) => [
      response.id,
      template.name,
      response.status,
      response.submittedAt ? new Date(response.submittedAt).toISOString() : '',
      site?.name ?? '',
    ]),
  })
}
