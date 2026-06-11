'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { insightDashboards } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
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
  const widgets = parsed.data.widgets.filter((w) => INSIGHT_WIDGET_MAP.has(w.id))
  await ctx.db((tx) =>
    tx
      .update(insightDashboards)
      .set({ layout: { widgets } })
      .where(eq(insightDashboards.id, input.id)),
  )
  revalidatePath('/insights')
  return { ok: true }
}
