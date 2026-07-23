'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, ne } from 'drizzle-orm'
import { reportDefinitions } from '@beaconhs/db/schema'
import {
  assertCustomReportDefinition,
  compileCustomReport,
  reportEntity,
  type CustomReportDefinition,
  type ReportEntityCatalog,
  type ReportRunResult,
} from '@beaconhs/reports'
import { loadBeaconReportCatalog, runBeaconReport } from '@beaconhs/reports/server'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'

export async function previewReportDefinition(
  definition: CustomReportDefinition,
): Promise<ReportRunResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.builder')
  assertCustomReportDefinition(definition)
  return ctx.db(async (tx) => {
    const catalog = await loadBeaconReportCatalog(tx)
    validateDefinition(definition, ctx.tenantId!, catalog)
    return runBeaconReport(tx, ctx.tenantId!, definition.query, catalog, {
      maxRows: 500,
    })
  })
}

export async function saveReportDefinition(
  definition: CustomReportDefinition,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ctx = await requireRequestContext()
    assertCan(ctx, 'reports.builder')
    assertCustomReportDefinition(definition)
    const creating = definition.id === 'new'
    const definitionId = creating ? randomUUID() : definition.id

    await ctx.db(async (tx) => {
      const catalog = await loadBeaconReportCatalog(tx)
      validateDefinition(definition, ctx.tenantId!, catalog)
      const entity = reportEntity(catalog, definition.query.entity)
      if (!entity) throw new Error('Choose an available report source.')
      const [conflict] = await tx
        .select({ id: reportDefinitions.id })
        .from(reportDefinitions)
        .where(
          and(
            eq(reportDefinitions.tenantId, ctx.tenantId!),
            eq(reportDefinitions.slug, definition.slug),
            ne(reportDefinitions.id, definitionId),
          ),
        )
        .limit(1)
      if (conflict) throw new Error('Another report already uses that name.')

      if (creating) {
        await tx.insert(reportDefinitions).values({
          id: definitionId,
          tenantId: ctx.tenantId!,
          seedKey: null,
          slug: definition.slug,
          name: definition.name.trim(),
          description: definition.description?.trim() || null,
          category: entity.category,
          query: definition.query,
          layout: definition.layout,
          state: definition.state,
          tags: definition.tags ?? [entity.category],
        })
      } else {
        const [updated] = await tx
          .update(reportDefinitions)
          .set({
            slug: definition.slug,
            name: definition.name.trim(),
            description: definition.description?.trim() || null,
            category: entity.category,
            query: definition.query,
            layout: definition.layout,
            state: definition.state,
            tags: definition.tags ?? [entity.category],
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(reportDefinitions.tenantId, ctx.tenantId!),
              eq(reportDefinitions.id, definitionId),
            ),
          )
          .returning({ id: reportDefinitions.id })
        if (!updated) throw new Error('Report not found.')
      }

      await recordAuditInTransaction(tx, ctx, {
        entityType: 'report_definition',
        entityId: definitionId,
        action: creating ? 'create' : 'update',
        summary: `${creating ? 'Created' : 'Updated'} report "${definition.name}"`,
        after: {
          name: definition.name,
          slug: definition.slug,
          entity: definition.query.entity,
          state: definition.state,
        },
      })
    })

    revalidatePath('/reports')
    revalidatePath(`/reports/definitions/${definitionId}`)
    if (creating) redirect(`/reports/definitions/${definitionId}/edit`)
    return { ok: true }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

function validateDefinition(
  definition: CustomReportDefinition,
  tenantId: string,
  catalog: ReportEntityCatalog,
): void {
  assertCustomReportDefinition(definition)
  compileCustomReport(definition.query, tenantId, catalog, { maxRows: 1 })
}
