'use server'

// Persist the user's dashboard layout to user_dashboard_layouts.
//
// We upsert on (tenant_id, user_id). Layout shape is { widgets: [{id,x,y,w,h}] }.
// The widget ids are validated against the widget registry — unknown ids are
// dropped so a removed widget can't crash the renderer.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { userDashboardLayouts, type DashboardLayoutData } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { WIDGETS } from './_widget-registry'
import { getUserRoleTier } from './_role-tier'

const WidgetSchema = z.object({
  id: z.string().min(1),
  x: z.number().int().min(0).max(12),
  y: z.number().int().min(0).max(200),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
})

const LayoutSchema = z.object({
  widgets: z.array(WidgetSchema).max(64),
})

export async function saveDashboardLayout(input: unknown) {
  const ctx = await requireRequestContext()
  if (!ctx.membership) {
    // No tenant_users row in the active tenant — most often a super-admin
    // who's just viewing the tenant without being a member. The user_dashboard
    // layout table is keyed on (tenant_id, user_id), not membership_id, so
    // we could technically still save — but without a membership we can't
    // attribute the saved layout to a "role" and it would only ever resolve
    // back to the super_admin default. Ask the user to be added as a member
    // first if they want a personal layout in this tenant.
    return {
      ok: false as const,
      error:
        'You are not a member of this tenant. A tenant user account is required to save a personal dashboard.',
    }
  }

  const parsed = LayoutSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.message }
  }

  // Filter out unknown widget ids
  const filtered: DashboardLayoutData = {
    widgets: parsed.data.widgets.filter((w) => w.id in WIDGETS),
  }
  const role = await getUserRoleTier(ctx)

  await ctx.db(async (tx) => {
    await tx
      .insert(userDashboardLayouts)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        layout: filtered,
        sourceRole: role,
        isCustomised: true,
      })
      .onConflictDoUpdate({
        target: [userDashboardLayouts.tenantId, userDashboardLayouts.userId],
        set: {
          layout: filtered,
          sourceRole: role,
          isCustomised: true,
          updatedAt: new Date(),
        },
      })
  })

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/customize')
  return { ok: true as const }
}

export async function resetDashboardLayout() {
  const ctx = await requireRequestContext()
  if (!ctx.membership) {
    return { ok: false as const, error: 'Not a member of this tenant — nothing to reset.' }
  }
  await ctx.db(async (tx) => {
    await tx
      .delete(userDashboardLayouts)
      .where(
        and(
          eq(userDashboardLayouts.tenantId, ctx.tenantId),
          eq(userDashboardLayouts.userId, ctx.userId),
        ),
      )
  })
  revalidatePath('/dashboard')
  revalidatePath('/dashboard/customize')
  return { ok: true as const }
}

export async function saveAndExitCustomize(input: unknown) {
  const res = await saveDashboardLayout(input)
  if (res.ok) redirect('/dashboard')
  return res
}
