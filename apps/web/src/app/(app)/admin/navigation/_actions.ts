'use server'

// Server actions for the in-UI sidebar editor (/admin/navigation).
// All gated by `admin.nav.manage`. The whole nav layout is saved atomically as
// one tenant_nav_config row; revalidating the root layout re-renders the
// sidebar everywhere.

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import { tenantNavConfigs, type TenantNavConfig } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { loadNavConfig } from '@/lib/nav/resolve'

// Lightweight runtime validation — the client is trusted-ish (admin only) but
// we still reject malformed payloads so a bad save can't brick the sidebar.
function isValidConfig(config: unknown): config is TenantNavConfig {
  if (!config || typeof config !== 'object') return false
  const c = config as TenantNavConfig
  if (c.version !== 1 || !Array.isArray(c.groups)) return false
  for (const g of c.groups) {
    if (!g || typeof g.id !== 'string' || typeof g.label !== 'string' || !Array.isArray(g.items)) {
      return false
    }
    for (const item of g.items) {
      if (!item || typeof item !== 'object') return false
      if (item.kind === 'module' && typeof item.moduleKey === 'string') continue
      if (item.kind === 'form' && typeof item.templateId === 'string') continue
      if (item.kind === 'link' && typeof item.href === 'string' && typeof item.label === 'string') continue
      return false
    }
  }
  return true
}

export async function saveNavConfig(
  config: TenantNavConfig,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.nav.manage')

  if (!isValidConfig(config)) return { ok: false, error: 'Invalid navigation layout.' }

  await ctx.db((tx) =>
    tx
      .insert(tenantNavConfigs)
      .values({ tenantId: ctx.tenantId, config })
      .onConflictDoUpdate({
        target: tenantNavConfigs.tenantId,
        set: { config, updatedAt: new Date() },
      }),
  )
  await recordAudit(ctx, {
    entityType: 'tenant_nav_config',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Sidebar navigation updated',
    after: config as unknown as Record<string, unknown>,
  })
  // Re-render the root (app) layout everywhere so the new sidebar takes effect.
  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function resetNavConfig(): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.nav.manage')

  await ctx.db((tx) =>
    tx.delete(tenantNavConfigs).where(eq(tenantNavConfigs.tenantId, ctx.tenantId)),
  )
  await recordAudit(ctx, {
    entityType: 'tenant_nav_config',
    entityId: ctx.tenantId,
    action: 'delete',
    summary: 'Sidebar navigation reset to defaults',
  })
  revalidatePath('/', 'layout')
  return { ok: true }
}

// One-click "Pin to sidebar" used by the forms gallery. Appends a form item to
// the current nav config (the saved row, or the materialised defaults) and
// persists it. Idempotent — pinning the same template twice is a no-op.
export async function pinFormToSidebar(
  templateId: string,
): Promise<{ ok: boolean; alreadyPinned?: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.nav.manage')
  if (!templateId) return { ok: false, error: 'Missing template.' }

  let alreadyPinned = false
  await ctx.db(async (tx) => {
    const config = await loadNavConfig(tx)
    alreadyPinned = config.groups.some((g) =>
      g.items.some((i) => i.kind === 'form' && i.templateId === templateId),
    )
    if (!alreadyPinned) {
      // Prefer the dedicated "Forms" group; fall back to the first group.
      const target =
        config.groups.find((g) => g.id === 'forms') ??
        config.groups.find((g) => g.label.toLowerCase() === 'forms') ??
        config.groups[0]
      target?.items.push({ kind: 'form', templateId })
      await tx
        .insert(tenantNavConfigs)
        .values({ tenantId: ctx.tenantId, config })
        .onConflictDoUpdate({
          target: tenantNavConfigs.tenantId,
          set: { config, updatedAt: new Date() },
        })
    }
  })

  if (!alreadyPinned) {
    await recordAudit(ctx, {
      entityType: 'tenant_nav_config',
      entityId: ctx.tenantId,
      action: 'update',
      summary: 'Pinned a form to the sidebar',
    })
    revalidatePath('/', 'layout')
  }
  return { ok: true, alreadyPinned }
}

// Remove every pinned-form item for this template from the nav config. Works
// even when the form was only auto-pinned (no saved row yet) — it materialises
// the current config minus the pin and persists it.
export async function unpinFormFromSidebar(
  templateId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.nav.manage')
  if (!templateId) return { ok: false, error: 'Missing template.' }

  await ctx.db(async (tx) => {
    const config = await loadNavConfig(tx)
    let changed = false
    for (const g of config.groups) {
      const next = g.items.filter((i) => !(i.kind === 'form' && i.templateId === templateId))
      if (next.length !== g.items.length) {
        g.items = next
        changed = true
      }
    }
    if (changed) {
      await tx
        .insert(tenantNavConfigs)
        .values({ tenantId: ctx.tenantId, config })
        .onConflictDoUpdate({
          target: tenantNavConfigs.tenantId,
          set: { config, updatedAt: new Date() },
        })
    }
  })

  await recordAudit(ctx, {
    entityType: 'tenant_nav_config',
    entityId: ctx.tenantId,
    action: 'update',
    summary: 'Unpinned a form from the sidebar',
  })
  revalidatePath('/', 'layout')
  return { ok: true }
}
