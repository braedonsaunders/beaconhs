'use server'

// Persist the user's dashboard layout to user_dashboard_layouts.
//
// We upsert on (tenant_id, user_id). Layout shape is { widgets: [{id,x,y,w,h}] }.
// The widget ids are validated against the widget registry — unknown ids are
// dropped so a removed widget can't crash the renderer.

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { userDashboardLayouts, type DashboardLayoutData } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { NAV_MODULES } from '@/lib/nav/registry'
import { canViewInsights } from '../insights/_access'
import { getUserRoleTier } from './_role-tier'
import {
  CURATED_QUICK_ACTIONS,
  type QuickActionOption,
  type QuickActionOptions,
} from './_quick-actions-shared'
import { QuickActionsSchema } from './_quick-actions-input'
import { DashboardLayoutInputSchema, filterPersistableDashboardWidgets } from './_layout-input'
import { resolveDashboardDefault } from './_load-layout'
import { canSeeWidget } from './_widget-access'
import { WIDGETS } from './_widget-registry'

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

  const parsed = DashboardLayoutInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.message }
  }

  // Keep only registered widget keys the CALLER may see (canSeeWidget — the same
  // gate view + customize render through, so a crafted save can never park an
  // org widget on a self-tier dashboard), plus saved insight-card ids (uuids)
  // when the caller has analytics access.
  const widgets = filterPersistableDashboardWidgets(parsed.data.widgets, {
    allowedWidgetIds: new Set(Object.keys(WIDGETS).filter((id) => canSeeWidget(ctx, id))),
    allowAnyInsightCardUuid: canViewInsights(ctx),
  })
  const role = await getUserRoleTier(ctx)
  const dashboardDefault = await resolveDashboardDefault(ctx, role)
  const sourceRole = dashboardDefault.sourceKey

  await ctx.db(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`dashboard:${ctx.tenantId}:${ctx.userId}`}, 0))`,
    )
    // The grid only ever sends geometry — preserve the user's saved Quick-actions
    // tiles (stored in the same jsonb) so saving a layout never wipes them.
    const [existing] = await tx
      .select({
        layout: userDashboardLayouts.layout,
        sourceRole: userDashboardLayouts.sourceRole,
      })
      .from(userDashboardLayouts)
      .where(
        and(
          eq(userDashboardLayouts.tenantId, ctx.tenantId),
          eq(userDashboardLayouts.userId, ctx.userId),
        ),
      )
      .limit(1)
    const layout: DashboardLayoutData = { widgets }
    if (existing?.layout.quickActions) layout.quickActions = existing.layout.quickActions

    await tx
      .insert(userDashboardLayouts)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        layout,
        sourceRole,
        isCustomised: true,
      })
      .onConflictDoUpdate({
        target: [userDashboardLayouts.tenantId, userDashboardLayouts.userId],
        set: {
          layout,
          sourceRole,
          isCustomised: true,
          updatedAt: new Date(),
        },
      })
  })

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/customize')
  return { ok: true as const }
}

/**
 * Persist the user's Quick-actions tiles. Stored in the same per-user layout
 * jsonb (no extra table) — we read-modify-write so existing widget geometry is
 * preserved. Seeds the role-default geometry when no personal row exists yet.
 */
export async function saveQuickActions(input: unknown) {
  const ctx = await requireRequestContext()
  if (!ctx.membership) {
    return {
      ok: false as const,
      error: 'You are not a member of this tenant. A tenant user account is required to save.',
    }
  }

  const parsed = QuickActionsSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid quick actions' }
  }

  const role = await getUserRoleTier(ctx)
  const dashboardDefault = await resolveDashboardDefault(ctx, role)
  const sourceRole = dashboardDefault.sourceKey

  await ctx.db(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`dashboard:${ctx.tenantId}:${ctx.userId}`}, 0))`,
    )
    const [existing] = await tx
      .select({
        layout: userDashboardLayouts.layout,
        sourceRole: userDashboardLayouts.sourceRole,
      })
      .from(userDashboardLayouts)
      .where(
        and(
          eq(userDashboardLayouts.tenantId, ctx.tenantId),
          eq(userDashboardLayouts.userId, ctx.userId),
        ),
      )
      .limit(1)

    const baseWidgets =
      existing?.sourceRole === sourceRole
        ? existing.layout.widgets
        : dashboardDefault.layout.widgets
    const layout: DashboardLayoutData = { widgets: baseWidgets, quickActions: parsed.data }

    await tx
      .insert(userDashboardLayouts)
      .values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        layout,
        sourceRole,
        isCustomised: true,
      })
      .onConflictDoUpdate({
        target: [userDashboardLayouts.tenantId, userDashboardLayouts.userId],
        set: { layout, sourceRole, isCustomised: true, updatedAt: new Date() },
      })
  })

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/customize')
  return { ok: true as const }
}

/**
 * The catalogue shown in the "Add action" picker:
 *   • common — curated create-CTAs + every nav destination the user may see
 *   • forms  — searched remotely through the purpose-scoped picker API
 * Permission-filtered so the picker only offers things the user can reach.
 */
export async function listQuickActionOptions(): Promise<QuickActionOptions> {
  const ctx = await requireRequestContext()

  // Curated "start something" shortcuts (shared with the default tiles),
  // filtered to what the caller can actually reach — no dead-end offers.
  const ctas: QuickActionOption[] = CURATED_QUICK_ACTIONS.filter(
    (c) => !c.requiredPermission || can(ctx, c.requiredPermission),
  ).map(({ label, href, iconKey, tone, hint }) => ({ label, href, iconKey, tone, hint }))

  const nav: QuickActionOption[] = NAV_MODULES.filter(
    (m) => !m.requiredPermission || can(ctx, m.requiredPermission),
  ).map((m) => ({
    label: m.label,
    href: m.href,
    iconKey: m.iconKey,
    tone: 'slate',
    hint: 'Navigate',
  }))

  const seen = new Set<string>()
  const common: QuickActionOption[] = []
  for (const o of [...ctas, ...nav]) {
    if (seen.has(o.href)) continue
    seen.add(o.href)
    common.push(o)
  }

  return { common, canChooseApps: can(ctx, 'forms.response.create') }
}

export async function resetDashboardLayout() {
  const ctx = await requireRequestContext()
  if (!ctx.membership) {
    return { ok: false as const, error: 'Not a member of this tenant — nothing to reset.' }
  }
  await ctx.db(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`dashboard:${ctx.tenantId}:${ctx.userId}`}, 0))`,
    )
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
