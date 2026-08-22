'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { and, eq, ne } from 'drizzle-orm'
import { reportDefinitions, reportSchedules } from '@beaconhs/db/schema'
import {
  assertCustomReportDefinition,
  compileCustomReport,
  reportEntity,
  type CustomReportDefinition,
  type ReportEntityCatalog,
  type ReportRunResult,
} from '@beaconhs/reports'
import { runBeaconReport } from '@beaconhs/reports/server'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { loadAuthorizedReportCatalogInTransaction } from '@/lib/report-catalog'

export async function previewReportDefinition(
  definition: CustomReportDefinition,
): Promise<ReportRunResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.builder')
  assertCustomReportDefinition(definition)
  return ctx.db(async (tx) => {
    const catalog = await loadAuthorizedReportCatalogInTransaction(ctx, tx)
    validateDefinition(definition, ctx.tenantId!, catalog)
    return runBeaconReport(tx, ctx.tenantId!, definition.query, catalog, {
      maxRows: 500,
    })
  })
}

export async function saveReportDefinition(
  definition: CustomReportDefinition,
): Promise<{ ok: true; definition: CustomReportDefinition } | { ok: false; error: string }> {
  try {
    const ctx = await requireRequestContext()
    assertCan(ctx, 'reports.builder')
    assertCustomReportDefinition(definition)
    const creating = definition.id === 'new'
    const definitionId = creating ? randomUUID() : definition.id
    const name = definition.name.trim() || 'Untitled report'

    await ctx.db(async (tx) => {
      const catalog = await loadAuthorizedReportCatalogInTransaction(ctx, tx)
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
          name,
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
            name,
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
        summary: `${creating ? 'Created' : 'Updated'} report "${name}"`,
        after: {
          name,
          slug: definition.slug,
          entity: definition.query.entity,
          state: definition.state,
        },
      })
    })

    revalidatePath('/reports')
    revalidatePath(`/reports/definitions/${definitionId}`)
    return {
      ok: true,
      definition: {
        ...definition,
        id: definitionId,
        name,
      },
    }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

export async function deleteReportDefinition(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!isUuid(id)) throw new Error('Report not found.')
    const ctx = await requireRequestContext()
    assertCan(ctx, 'reports.builder')

    await ctx.db(async (tx) => {
      const [definition] = await tx
        .select({
          id: reportDefinitions.id,
          name: reportDefinitions.name,
          slug: reportDefinitions.slug,
          state: reportDefinitions.state,
          query: reportDefinitions.query,
        })
        .from(reportDefinitions)
        .where(and(eq(reportDefinitions.tenantId, ctx.tenantId!), eq(reportDefinitions.id, id)))
        .limit(1)
      if (!definition) throw new Error('Report not found.')

      const removedSchedules = await tx
        .delete(reportSchedules)
        .where(
          and(eq(reportSchedules.tenantId, ctx.tenantId!), eq(reportSchedules.definitionId, id)),
        )
        .returning({ id: reportSchedules.id })
      const [removedDefinition] = await tx
        .delete(reportDefinitions)
        .where(and(eq(reportDefinitions.tenantId, ctx.tenantId!), eq(reportDefinitions.id, id)))
        .returning({ id: reportDefinitions.id })
      if (!removedDefinition) throw new Error('Report not found.')

      await recordAuditInTransaction(tx, ctx, {
        entityType: 'report_definition',
        entityId: id,
        action: 'delete',
        summary: `Deleted report "${definition.name}"`,
        before: {
          name: definition.name,
          slug: definition.slug,
          state: definition.state,
          entity: definition.query.entity,
          scheduleCount: removedSchedules.length,
        },
      })
    })

    revalidatePath('/reports')
    revalidatePath('/reports/schedules')
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
