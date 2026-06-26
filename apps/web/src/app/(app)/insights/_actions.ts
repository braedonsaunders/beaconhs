'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  insightDashboardPins,
  insightDashboards,
  type DashboardParam,
  type DashboardParamMap,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canPublishInsights, canViewInsights } from './_access'
import { canSeePublishedInsight, getInsightRoleKeys } from './_visibility'
import { INSIGHT_WIDGET_MAP } from './_widgets'

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

async function ownsDashboard(ctx: RequestContext, id: string): Promise<boolean> {
  const [d] = await ctx.db((tx) =>
    tx
      .select({ id: insightDashboards.id })
      .from(insightDashboards)
      .where(and(eq(insightDashboards.id, id), eq(insightDashboards.userId, ctx.userId)))
      .limit(1),
  )
  return Boolean(d)
}

export async function createDashboard(name: string): Promise<Ok<{ id: string }> | Err> {
  const ctx = await requireRequestContext()
  const clean = name.trim().slice(0, 60) || 'New dashboard'
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
  revalidatePath('/insights')
  return row ? { ok: true, id: row.id } : { ok: false, error: 'Could not create dashboard.' }
}

export async function renameDashboard(id: string, name: string): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!(await ownsDashboard(ctx, id))) return { ok: false, error: 'Dashboard not found.' }
  await ctx.db((tx) =>
    tx
      .update(insightDashboards)
      .set({ name: name.trim().slice(0, 60) || 'Dashboard' })
      .where(eq(insightDashboards.id, id)),
  )
  revalidatePath('/insights')
  return { ok: true }
}

export async function deleteDashboard(id: string): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!(await ownsDashboard(ctx, id))) return { ok: false, error: 'Dashboard not found.' }
  await ctx.db((tx) => tx.delete(insightDashboards).where(eq(insightDashboards.id, id)))
  revalidatePath('/insights')
  return { ok: true }
}

export async function saveDashboardLayout(input: {
  id: string
  layout: unknown
}): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!(await ownsDashboard(ctx, input.id))) return { ok: false, error: 'Dashboard not found.' }
  const parsed = LayoutSchema.safeParse(input.layout)
  if (!parsed.success) return { ok: false, error: 'Invalid layout.' }
  // A widget id is EITHER a built-in widget key OR an insight_cards.id (uuid).
  const UUID_RE = /^[0-9a-f-]{36}$/i
  const widgets = parsed.data.widgets.filter(
    (w) => INSIGHT_WIDGET_MAP.has(w.id) || UUID_RE.test(w.id),
  )
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
  if (!(await ownsDashboard(ctx, input.id))) return { ok: false, error: 'Dashboard not found.' }

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
  if (!canPublishInsights(ctx) || !(await ownsDashboard(ctx, input.id))) {
    return { ok: false, error: 'Dashboard not found.' }
  }
  await ctx.db((tx) =>
    tx
      .update(insightDashboards)
      .set({
        status: 'published',
        allowedRoles: input.allowedRoles && input.allowedRoles.length ? input.allowedRoles : null,
        publishedBy: ctx.userId,
        publishedAt: new Date(),
      })
      .where(eq(insightDashboards.id, input.id)),
  )
  revalidatePath('/insights')
  return { ok: true }
}

export async function unpublishDashboard(id: string): Promise<Ok | Err> {
  const ctx = await requireRequestContext()
  if (!(await ownsDashboard(ctx, id))) return { ok: false, error: 'Dashboard not found.' }
  await ctx.db((tx) =>
    tx
      .update(insightDashboards)
      .set({ status: 'draft', publishedAt: null })
      .where(eq(insightDashboards.id, id)),
  )
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
      .where(eq(insightDashboards.id, dashboardId))
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
