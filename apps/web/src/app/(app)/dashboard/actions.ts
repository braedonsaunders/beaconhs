'use server'

// Persist the user's dashboard layout to user_dashboard_layouts.
//
// We upsert on (tenant_id, user_id). Layout shape is { widgets: [{id,x,y,w,h}] }.
// The widget ids are validated against the widget registry — unknown ids are
// dropped so a removed widget can't crash the renderer.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { formTemplates, userDashboardLayouts, type DashboardLayoutData } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { NAV_MODULES } from '@/lib/nav/registry'
import { getUserRoleTier } from './_role-tier'
import { type QuickActionOption, type QuickActionOptions } from './_quick-actions-shared'
import { QuickActionsSchema } from './_quick-actions-input'
import { DashboardLayoutInputSchema, filterPersistableDashboardWidgets } from './_layout-input'
import { resolveDashboardDefault } from './_load-layout'

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

  // Keep registered widget keys AND saved insight-card ids (uuids), so a real
  // Insights card can live on the homepage grid alongside the bespoke widgets.
  // An inaccessible card id simply renders an empty cell under RLS — never a leak.
  const widgets = filterPersistableDashboardWidgets(parsed.data.widgets, {
    allowAnyInsightCardUuid: true,
  })
  const role = await getUserRoleTier(ctx)
  const dashboardDefault = await resolveDashboardDefault(ctx, role)
  const sourceRole = dashboardDefault.sourceKey

  await ctx.db(async (tx) => {
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

function labelForKind(kind: string): string {
  switch (kind) {
    case 'wizard':
      return 'Wizard'
    case 'checklist':
      return 'Checklist'
    case 'register':
      return 'Register'
    case 'mini_app':
      return 'App'
    default:
      return 'Form'
  }
}

/**
 * The catalogue shown in the "Add action" picker:
 *   • common — curated create-CTAs + every nav destination the user may see
 *   • forms  — published forms & Builder apps for the tenant
 * Permission-filtered so the picker only offers things the user can reach.
 */
export async function listQuickActionOptions(): Promise<QuickActionOptions> {
  const ctx = await requireRequestContext()

  // Curated "start something" shortcuts. Routes that always exist for any tenant.
  const ctas: QuickActionOption[] = [
    {
      label: 'Report incident',
      href: '/incidents/new',
      iconKey: 'alert',
      tone: 'rose',
      hint: 'Create',
    },
    {
      label: 'Hazard assessment',
      href: '/hazard-assessments/new',
      iconKey: 'radiation',
      tone: 'amber',
      hint: 'Create',
    },
    {
      label: 'New corrective action',
      href: '/corrective-actions/new',
      iconKey: 'list-checks',
      tone: 'teal',
      hint: 'Create',
    },
    {
      label: 'Check out equipment',
      href: '/equipment/station',
      iconKey: 'clipboard-check',
      tone: 'violet',
      hint: 'Action',
    },
    { label: 'Run report', href: '/reports', iconKey: 'file', tone: 'slate', hint: 'Open' },
  ]

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

  const formRows = await ctx.db(async (tx) =>
    tx
      .select({
        key: formTemplates.key,
        name: formTemplates.name,
        iconKey: formTemplates.iconKey,
        kind: formTemplates.kind,
        surfaceAsTool: formTemplates.surfaceAsTool,
      })
      .from(formTemplates)
      .where(
        and(
          eq(formTemplates.tenantId, ctx.tenantId),
          eq(formTemplates.status, 'published'),
          isNull(formTemplates.deletedAt),
        ),
      )
      .orderBy(desc(formTemplates.surfaceAsTool), asc(formTemplates.name))
      .limit(200),
  )

  const forms: QuickActionOption[] = formRows.map((f) => ({
    label: f.name,
    href: `/apps/by-key/${f.key}/fill`,
    iconKey: f.iconKey ?? (f.surfaceAsTool ? 'cog' : 'clipboard'),
    tone: f.surfaceAsTool ? 'violet' : 'sky',
    hint: f.surfaceAsTool ? 'App' : labelForKind(f.kind),
  }))

  return { common, forms }
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
