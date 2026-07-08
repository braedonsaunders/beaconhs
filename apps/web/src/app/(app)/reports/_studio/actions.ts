'use server'

// Server actions for the report studio: create / update custom definitions
// and the live preview. All three share the validate.ts sanitiser; preview
// executes under the caller's RLS context with a tight row cap.

import { randomBytes } from 'node:crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import { db, withSuperAdmin } from '@beaconhs/db'
import { reportDefinitions } from '@beaconhs/db/schema'
import {
  augmentEntityMapWithCustomFields,
  buildReportDocumentCss,
  buildReportPageCss,
  computeRangeFor,
  renderReportDocumentBodyHtml,
  resolveReportLayout,
  runReport,
  type ReportEntity,
} from '@beaconhs/reports'
import { discoverEntityMapWithApps } from '@beaconhs/analytics/server'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { loadDefinitionById } from '../_definitions'
import { loadTenantBranding } from '../_run'
import { validateCustomQuery, validateReportLayout } from './validate'

/** Definition category for an entity key. Scoped per-app keys
 *  (`form_responses:<templateId>`) fall back to their base table. */
function entityCategory(entityKey: string): string {
  return entityKey.split(':')[0] ?? entityKey
}

/** Build a stable, URL-safe slug for a custom definition. */
function buildSlug(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'custom_report'
  const suffix = randomBytes(3).toString('hex')
  return `custom__${base}__${suffix}`
}

function parseStudioForm(formData: FormData, entityMap: Record<string, ReportEntity>) {
  const name = String(formData.get('name') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const customQueryRaw = String(formData.get('customQuery') ?? '').trim()
  if (!name) throw new Error('Name is required')
  if (!customQueryRaw) throw new Error('Custom query payload is missing')
  let parsed: unknown
  try {
    parsed = JSON.parse(customQueryRaw)
  } catch (err) {
    throw new Error(`Invalid customQuery JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  const layoutRaw = String(formData.get('layout') ?? '').trim()
  let layoutParsed: unknown = null
  if (layoutRaw) {
    try {
      layoutParsed = JSON.parse(layoutRaw)
    } catch (err) {
      throw new Error(`Invalid layout JSON: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return {
    name,
    description,
    customQuery: validateCustomQuery(parsed, entityMap),
    layout: validateReportLayout(layoutParsed),
  }
}

/** Discovered catalog augmented with the tenant's custom-field columns, so the
 *  studio can save/validate `cf_*` columns. */
async function resolveStudioEntityMap(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
): Promise<Record<string, ReportEntity>> {
  return ctx.db(async (tx) =>
    augmentEntityMapWithCustomFields(tx, await discoverEntityMapWithApps(tx)),
  )
}

export async function createCustomDefinition(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.builder')
  const { name, description, customQuery, layout } = parseStudioForm(
    formData,
    await resolveStudioEntityMap(ctx),
  )
  const cloneFromIdRaw = String(formData.get('cloneFromId') ?? '').trim()

  // If cloning, copy source category onto the new row. The lookup enforces
  // the built-in-or-own-tenant visibility rule; an invisible id is ignored.
  // Scoped per-app keys (form_responses:<templateId>) categorise under their
  // base table, not the raw scoped key.
  let category: string | null = entityCategory(customQuery.entity)
  if (cloneFromIdRaw) {
    const src = await loadDefinitionById(ctx.tenantId!, cloneFromIdRaw)
    if (src?.category) category = src.category
  }

  const slug = buildSlug(name)

  // We write through super-admin because the definitions table has no RLS —
  // tenant scoping is enforced by setting tenantId on insert.
  const newId = await withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .insert(reportDefinitions)
      .values({
        tenantId: ctx.tenantId,
        kind: 'custom',
        slug,
        name,
        description,
        category,
        queryKind: 'custom_query',
        customQuery,
        layout,
      })
      .returning({ id: reportDefinitions.id })
    return row!.id
  })

  await recordAudit(ctx, {
    entityType: 'report_definition',
    entityId: newId,
    action: 'create',
    summary: `Created custom report definition "${name}"`,
    after: { name, slug, category, queryKind: 'custom_query', clonedFrom: cloneFromIdRaw || null },
  })

  revalidatePath('/reports')
  revalidatePath('/reports/definitions')
  redirect(`/reports/definitions/${newId}` as never)
}

export async function updateCustomDefinition(
  definitionId: string,
  formData: FormData,
): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.builder')
  const { name, description, customQuery, layout } = parseStudioForm(
    formData,
    await resolveStudioEntityMap(ctx),
  )

  await withSuperAdmin(db, async (tx) => {
    const [d] = await tx
      .select()
      .from(reportDefinitions)
      .where(eq(reportDefinitions.id, definitionId))
      .limit(1)
    if (!d) throw new Error('Definition not found')
    if (d.kind !== 'custom') throw new Error('Built-in definitions cannot be edited')
    if (d.tenantId !== ctx.tenantId) {
      throw new Error('Cannot edit a definition owned by another tenant')
    }
    await tx
      .update(reportDefinitions)
      .set({
        name,
        description,
        category: entityCategory(customQuery.entity),
        customQuery,
        layout,
        updatedAt: new Date(),
      })
      .where(eq(reportDefinitions.id, definitionId))
  })

  await recordAudit(ctx, {
    entityType: 'report_definition',
    entityId: definitionId,
    action: 'update',
    summary: `Updated custom report definition "${name}"`,
    after: { name },
  })

  revalidatePath('/reports')
  revalidatePath('/reports/definitions')
  revalidatePath(`/reports/definitions/${definitionId}`)
  redirect(`/reports/definitions/${definitionId}` as never)
}

export type StudioPreviewResult =
  | { ok: true; bodyHtml: string; css: string; rowCount: number; rangeLabel: string }
  | { ok: false; error: string }

// Not exported: 'use server' modules may only export async functions.
const STUDIO_PREVIEW_MAX_ROWS = 50

/** Live studio preview — runs the draft plan (row-capped) and returns the
 *  rendered DOCUMENT (body HTML + @page CSS with live page counters) so the
 *  builder shows the same paginated pages the saved report will print. */
export async function previewCustomReport(payload: {
  query: unknown
  layout?: unknown
  name?: string
}): Promise<StudioPreviewResult> {
  try {
    const ctx = await requireRequestContext()
    assertCan(ctx, 'reports.builder')
    const range = computeRangeFor('custom_query', {})
    const result = await ctx.db(async (tx) => {
      const entityMap = await augmentEntityMapWithCustomFields(
        tx,
        await discoverEntityMapWithApps(tx),
      )
      const customQuery = validateCustomQuery(payload.query, entityMap)
      return runReport(tx, {
        queryKind: 'custom_query',
        filters: {},
        range,
        customQuery,
        maxRows: STUDIO_PREVIEW_MAX_ROWS,
        entityMap,
      })
    })
    const branding = await loadTenantBranding(ctx)
    const layout = resolveReportLayout(validateReportLayout(payload.layout))
    const reportName =
      typeof payload.name === 'string' && payload.name.trim()
        ? payload.name.trim()
        : 'Untitled report'
    const bodyHtml = renderReportDocumentBodyHtml({
      tenantName: branding.name,
      tenantLogoUrl: branding.logoUrl,
      primaryColor: branding.primaryColor,
      reportName,
      dateRangeLabel: range.label,
      generatedAt: new Date(),
      summary: layout.showSummary ? result.summary : undefined,
      groups: result.groups,
    })
    const css =
      buildReportPageCss(layout, {
        marginBoxes: { footerLeft: `${branding.name} — ${reportName}` },
      }) + buildReportDocumentCss(branding.primaryColor, layout.density)
    return { ok: true, bodyHtml, css, rowCount: result.rowCount, rangeLabel: range.label }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
