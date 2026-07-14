'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  insightCards,
  insightDashboardPins,
  insightDashboards,
  type DashboardParam,
  type DashboardParamMap,
  type InsightDashboardLayout,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { canPublishInsights, canViewInsights } from './_access'
import { canSeePublishedInsight, getInsightRoleKeys } from './_visibility'
import { INSIGHT_WIDGET_MAP } from './_widgets'
import { isUuid } from '@/lib/list-params'
import {
  INSIGHT_DASHBOARD_NAME_MAX_LENGTH,
  validateRequiredPersistedText,
} from '@/lib/persisted-text-policy'

type Ok<T = {}> = { ok: true } & T
type Err = { ok: false; error: string }

const LayoutSchema = z.object({
  widgets: z
    .array(
      z.object({
        id: z.string().min(1),
        x: z.number().int().min(0).max(12),
        y: z.number().int().min(0).max(500),
        w: z.number().int().min(1).max(12),
        h: z.number().int().min(1).max(40),
      }),
    )
    .max(64),
})

/** The live (non-deleted) dashboard, when the caller owns it. */
async function ownedDashboard(
  ctx: RequestContext,
  id: string,
): Promise<{ name: string; layout: InsightDashboardLayout } | null> {
  const [d] = await ctx.db((tx) =>
    tx
      .select({ name: insightDashboards.name, layout: insightDashboards.layout })
      .from(insightDashboards)
      .where(
        and(
          eq(insightDashboards.id, id),
          eq(insightDashboards.userId, ctx.userId),
          isNull(insightDashboards.deletedAt),
        ),
      )
      .limit(1),
  )
  return d ?? null
}

export async function createDashboard(name: string): Promise<Ok<{ id: string }> | Err> {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) return { ok: false, error: 'You don’t have access to Insights.' }
  const parsedName = validateRequiredPersistedText(name, {
    label: 'Dashboard name',
    maxLength: INSIGHT_DASHBOARD_NAME_MAX_LENGTH,
  })
  if (!parsedName.ok) return parsedName
  const clean = parsedName.value
  const [{ maxOrder } = { maxOrder: -1 }] = await ctx.db((tx) =>
    tx
      .select({ maxOrder: sql<number>`coalesce(max(${insightDashboards.sortOrder}), -1)::int` })
      .from(insightDashboards)
      .where(eq(insightDashboards.userId, ctx.userId)),
  )
  const [row] = await ctx.db((tx) =>
    tx
      .insert(insightDashboards)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        name: clean,
        sortOrder: Number(maxOrder) + 1,
        layout: { widgets: [] },
      })
      .returning({ id: insightDashboards.id }),
  )
  if (!row) return { ok: false, error: 'Could not create dashboard.' }
  await recordAudit(ctx, {
    entityType: 'insight_dashboard',
    entityId: row.id,
    action: 'create',
    summary: `Created Insights dashboard "${clean}"`,
  })
  revalidatePath('/insights')
  return { ok: true, id: row.id }
}

export async function renameDashboard(
  id: string,
  name: string,
): Promise<Ok<{ name: string }> | Err> {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) return { ok: false, error: 'You don’t have access to Insights.' }
  if (!isUuid(id)) return { ok: false, error: 'Dashboard not found.' }
  const parsedName = validateRequiredPersistedText(name, {
    label: 'Dashboard name',
    maxLength: INSIGHT_DASHBOARD_NAME_MAX_LENGTH,
  })
  if (!parsedName.ok) return parsedName
  const dashboard = await ownedDashboard(ctx, id)
  if (!dashboard) return { ok: false, error: 'Dashboard not found.' }
  if (dashboard.name === parsedName.value) return { ok: true, name: parsedName.value }
  const [renamed] = await ctx.db((tx) =>
    tx
      .update(insightDashboards)
      .set({ name: parsedName.value })
      .where(
        and(
          eq(insightDashboards.id, id),
          eq(insightDashboards.userId, ctx.userId),
          isNull(insightDashboards.deletedAt),
        ),
      )
      .returning({ id: insightDashboards.id }),
  )
  if (!renamed) return { ok: false, error: 'Dashboard not found.' }
  await recordAudit(ctx, {
    entityType: 'insight_dashboard',
    entityId: id,
    action: 'update',
    summary: `Renamed Insights dashboard to "${parsedName.value}"`,
    before: { name: dashboard.name },
    after: { name: parsedName.value },
  })
  revalidatePath('/insights')
  return { ok: true, name: parsedName.value }
}

export async function deleteDashboard(id: string): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) return { ok: false, error: 'You don’t have access to Insights.' }
  const dashboard = await ownedDashboard(ctx, id)
  if (!dashboard) return { ok: false, error: 'Dashboard not found.' }
  // Soft delete — insight_dashboards carries deletedAt and every reader filters
  // on it, matching the cards' delete model.
  await ctx.db((tx) =>
    tx.update(insightDashboards).set({ deletedAt: new Date() }).where(eq(insightDashboards.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'insight_dashboard',
    entityId: id,
    action: 'delete',
    summary: `Deleted Insights dashboard "${dashboard.name}"`,
  })
  revalidatePath('/insights')
  return { ok: true }
}

export async function saveDashboardLayout(input: {
  id: string
  layout: unknown
}): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) return { ok: false, error: 'You don’t have access to Insights.' }
  if (!(await ownedDashboard(ctx, input.id))) return { ok: false, error: 'Dashboard not found.' }
  const parsed = LayoutSchema.safeParse(input.layout)
  if (!parsed.success) return { ok: false, error: 'Invalid layout.' }
  const widgets = parsed.data.widgets.filter((w) => INSIGHT_WIDGET_MAP.has(w.id) || isUuid(w.id))
  await ctx.db((tx) =>
    tx
      .update(insightDashboards)
      .set({ layout: { widgets } })
      .where(eq(insightDashboards.id, input.id)),
  )
  revalidatePath('/insights')
  return { ok: true }
}

// --- Parameters (dashboard-level filters) -----------------------------------

const PARAM_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/

const ParamSchema = z.object({
  key: z.string().regex(PARAM_KEY_RE, 'Use lower_snake_case keys.'),
  label: z.string().trim().min(1).max(60),
  type: z.enum(['date', 'text', 'number', 'enum']),
  defaultValue: z.union([z.string(), z.number(), z.null()]).optional(),
})

const ParamMapEntrySchema = z.object({
  cardId: z.string().min(1).max(64),
  field: z.string().min(1).max(80),
})

const ParamsSchema = z.object({
  params: z.array(ParamSchema).max(20),
  paramMap: z.record(z.string(), z.array(ParamMapEntrySchema).max(64)),
})

/** Persist a dashboard's parameter definitions + their (card, field) mappings.
 *  Owner-only. Orphan map entries (pointing at a removed param) are dropped so
 *  the stored map can never reference a key that no longer exists. */
export async function saveDashboardParams(input: {
  id: string
  params: unknown
  paramMap: unknown
}): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) return { ok: false, error: 'You don’t have access to Insights.' }
  if (!(await ownedDashboard(ctx, input.id))) return { ok: false, error: 'Dashboard not found.' }

  const parsed = ParamsSchema.safeParse({ params: input.params, paramMap: input.paramMap })
  if (!parsed.success) return { ok: false, error: 'Invalid parameters.' }

  const keys = parsed.data.params.map((p) => p.key)
  if (new Set(keys).size !== keys.length)
    return { ok: false, error: 'Parameter keys must be unique.' }

  const known = new Set(keys)
  const paramMap: DashboardParamMap = {}
  for (const [key, targets] of Object.entries(parsed.data.paramMap)) {
    if (!known.has(key) || targets.length === 0) continue
    paramMap[key] = targets
  }

  await ctx.db((tx) =>
    tx
      .update(insightDashboards)
      .set({ params: parsed.data.params as DashboardParam[], paramMap })
      .where(eq(insightDashboards.id, input.id)),
  )
  revalidatePath('/insights')
  return { ok: true }
}

// --- Publishing + pinning (library) ----------------------------------------

export async function publishDashboard(input: {
  id: string
  allowedRoles?: string[] | null
}): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canPublishInsights(ctx)) return { ok: false, error: 'You can’t publish dashboards.' }
  const dashboard = await ownedDashboard(ctx, input.id)
  if (!dashboard) return { ok: false, error: 'Dashboard not found.' }

  // A published dashboard is rendered through each VIEWER's card palette, which
  // excludes other users' drafts — so draft cards on the layout would silently
  // vanish for every viewer. Require them to be published first.
  const cardIds = dashboard.layout.widgets.map((w) => w.id).filter(isUuid)
  if (cardIds.length > 0) {
    const drafts = await ctx.db((tx) =>
      tx
        .select({ name: insightCards.name })
        .from(insightCards)
        .where(
          and(
            inArray(insightCards.id, cardIds),
            eq(insightCards.status, 'draft'),
            isNull(insightCards.deletedAt),
          ),
        ),
    )
    if (drafts.length > 0) {
      return {
        ok: false,
        error: `Publish the cards on this dashboard first: ${drafts.map((d) => d.name).join(', ')}.`,
      }
    }
  }

  const allowedRoles = input.allowedRoles && input.allowedRoles.length ? input.allowedRoles : null
  await ctx.db((tx) =>
    tx
      .update(insightDashboards)
      .set({
        status: 'published',
        allowedRoles,
        publishedBy: ctx.userId,
        publishedAt: new Date(),
      })
      .where(eq(insightDashboards.id, input.id)),
  )
  await recordAudit(ctx, {
    entityType: 'insight_dashboard',
    entityId: input.id,
    action: 'publish',
    summary: `Published Insights dashboard "${dashboard.name}" to the library`,
    metadata: { allowedRoles },
  })
  revalidatePath('/insights')
  return { ok: true }
}

export async function unpublishDashboard(id: string): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canPublishInsights(ctx)) return { ok: false, error: 'You can’t unpublish dashboards.' }
  const dashboard = await ownedDashboard(ctx, id)
  if (!dashboard) return { ok: false, error: 'Dashboard not found.' }
  await ctx.db((tx) =>
    tx
      .update(insightDashboards)
      .set({ status: 'draft', publishedAt: null })
      .where(eq(insightDashboards.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'insight_dashboard',
    entityId: id,
    action: 'update',
    summary: `Unpublished Insights dashboard "${dashboard.name}"`,
  })
  revalidatePath('/insights')
  return { ok: true }
}

export async function pinDashboard(dashboardId: string): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) return { ok: false, error: 'No access.' }
  const [dashboard] = await ctx.db((tx) =>
    tx
      .select({
        id: insightDashboards.id,
        status: insightDashboards.status,
        allowedRoles: insightDashboards.allowedRoles,
      })
      .from(insightDashboards)
      .where(and(eq(insightDashboards.id, dashboardId), isNull(insightDashboards.deletedAt)))
      .limit(1),
  )
  const roleKeys = await getInsightRoleKeys(ctx)
  if (
    !dashboard ||
    dashboard.status !== 'published' ||
    !canSeePublishedInsight(ctx, dashboard.allowedRoles, roleKeys)
  ) {
    return { ok: false, error: 'Dashboard not found.' }
  }
  await ctx.db((tx) =>
    tx
      .insert(insightDashboardPins)
      .values({ tenantId: ctx.tenantId, userId: ctx.userId, dashboardId, sortOrder: 0 })
      .onConflictDoNothing(),
  )
  revalidatePath('/insights')
  return { ok: true }
}

export async function unpinDashboard(dashboardId: string): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!canViewInsights(ctx)) return { ok: false, error: 'No access.' }
  await ctx.db((tx) =>
    tx
      .delete(insightDashboardPins)
      .where(
        and(
          eq(insightDashboardPins.userId, ctx.userId),
          eq(insightDashboardPins.dashboardId, dashboardId),
        ),
      ),
  )
  revalidatePath('/insights')
  return { ok: true }
}
