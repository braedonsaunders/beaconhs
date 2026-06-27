import { notFound } from 'next/navigation'
import type { NextRequest } from 'next/server'
import { and, asc, desc, eq, ilike, isNull, type SQL } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import {
  formResponses,
  formTemplateVersions,
  formTemplates,
  orgUnits,
  people,
  tenantUsers,
  user,
  type FormResponseDraftData,
  type FormSchemaV1,
} from '@beaconhs/db/schema'
import { requireExportContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import { csvFilename, csvResponse } from '@/lib/csv'
import { parseListParams, pickString } from '@/lib/list-params'
import { selectCsvColumns } from '@/lib/export-columns'
import {
  buildResponseExportColumns,
  valueForResponseExportColumn,
  type ResponseExportColumn,
} from '../_export-columns'

export const dynamic = 'force-dynamic'

const SORTS = ['submitted_at', 'created_at', 'status'] as const

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
  const templateFilter = pickString(sp.template)
  const ctx = await requireExportContext()
  // Read-tier floor: a caller with no forms.response read permission can never
  // export the response set (mirrors the list page's per-user visibility).
  if (
    !(
      can(ctx, 'forms.response.read.all') ||
      can(ctx, 'forms.response.read.site') ||
      can(ctx, 'forms.response.read.self')
    )
  ) {
    notFound()
  }

  const rows = await ctx.db(async (tx) => {
    // Per-user record visibility, identical to apps/responses/page.tsx: read.all →
    // everything, read.site → my sites, else → responses I submitted or am the
    // subject of. Without this the CSV leaks every response's subject/site.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'forms.response',
      ownerCols: [formResponses.submittedBy],
      personCol: formResponses.subjectPersonId,
      siteCol: formResponses.siteOrgUnitId,
    })
    const filters: SQL<unknown>[] = []
    if (vis) filters.push(vis)
    if (statusFilter) filters.push(eq(formResponses.status, statusFilter as any))
    if (templateFilter) filters.push(eq(formResponses.templateId, templateFilter))
    filters.push(isNull(formTemplates.deletedAt))
    if (params.q) {
      const term = `%${params.q}%`
      const cond = ilike(formTemplates.name, term)
      if (cond) filters.push(cond)
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'status'
        ? [params.dir === 'asc' ? asc(formResponses.status) : desc(formResponses.status)]
        : params.sort === 'created_at'
          ? [params.dir === 'asc' ? asc(formResponses.createdAt) : desc(formResponses.createdAt)]
          : [
              params.dir === 'asc'
                ? asc(formResponses.submittedAt)
                : desc(formResponses.submittedAt),
            ]

    const rows = await tx
      .select({
        response: formResponses,
        template: formTemplates,
        version: formTemplateVersions,
        site: orgUnits,
        subjectFirst: people.firstName,
        subjectLast: people.lastName,
        submittedByName: user.name,
      })
      .from(formResponses)
      .innerJoin(formTemplates, eq(formTemplates.id, formResponses.templateId))
      .innerJoin(formTemplateVersions, eq(formTemplateVersions.id, formResponses.templateVersionId))
      .leftJoin(orgUnits, eq(orgUnits.id, formResponses.siteOrgUnitId))
      .leftJoin(people, eq(people.id, formResponses.subjectPersonId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, formResponses.submittedBy))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(10_000)

    const schemas = templateFilter
      ? await tx
          .select({ schema: formTemplateVersions.schema })
          .from(formTemplateVersions)
          .where(eq(formTemplateVersions.templateId, templateFilter))
          .orderBy(asc(formTemplateVersions.version))
      : []

    return {
      rows,
      columns: buildResponseExportColumns(schemas.map((row) => row.schema as FormSchemaV1)),
    }
  })

  await recordAudit(ctx, {
    entityType: 'form_response',
    action: 'export',
    summary: `Exported ${rows.rows.length} form responses to CSV`,
    metadata: {
      format: 'csv',
      filters: {
        q: params.q ?? null,
        status: statusFilter ?? null,
        template: templateFilter ?? null,
      },
    },
  })

  const selection = selectCsvColumns(
    url.searchParams,
    rows.columns.map((column) => ({ key: column.key, header: column.label })),
  )

  return csvResponse({
    filename: csvFilename(templateFilter ? 'app-responses' : 'form-responses'),
    headers: selection.headers,
    rows: rows.rows.map((row) => selection.project(responseRow(row, rows.columns))),
  })
}

function responsePayload(
  data: Record<string, unknown> | null,
  draftData: FormResponseDraftData | null,
): Record<string, unknown> {
  if (!draftData) return data ?? {}
  return {
    ...(draftData.values ?? {}),
    ...(draftData.rows ?? {}),
    ...(data ?? {}),
  }
}

function personName(first: string | null, last: string | null): string | null {
  const name = `${first ?? ''}${first && last ? ' ' : ''}${last ?? ''}`.trim()
  return name || null
}

function responseRow(
  row: {
    response: typeof formResponses.$inferSelect
    template: typeof formTemplates.$inferSelect
    version: typeof formTemplateVersions.$inferSelect
    site: typeof orgUnits.$inferSelect | null
    subjectFirst: string | null
    subjectLast: string | null
    submittedByName: string | null
  },
  columns: readonly ResponseExportColumn[],
): (string | number | null | undefined)[] {
  const values = responsePayload(row.response.data ?? {}, row.response.draftData ?? null)
  return columns.map((column) =>
    valueForResponseExportColumn(column, {
      response: row.response,
      template: row.template,
      version: row.version,
      siteName: row.site?.name ?? null,
      subjectName: personName(row.subjectFirst, row.subjectLast),
      submittedByName: row.submittedByName,
      values,
    }),
  )
}
