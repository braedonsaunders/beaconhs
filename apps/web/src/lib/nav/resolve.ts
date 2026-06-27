// Server-side nav resolver.
//
// Turns the code-defined module registry + a tenant's saved overrides
// (tenant_nav_config) into the concrete SidebarNavGroup[] the client nav
// components render. Responsibilities:
//   - load the saved config, or compute defaults (registry + lift-plan pin)
//   - resolve pinned-form items to their template name / icon / home href
//   - filter every item by its module permission gates — the sidebar now reflects
//     what each user may actually open
//   - drop `hidden` items and empty groups
//
// Read-only: never writes. A tenant gets a persisted row only when an admin
// saves in /admin/navigation; until then everyone sees the computed defaults.

import { eq, inArray } from 'drizzle-orm'
import { can, type RequestContext } from '@beaconhs/tenant'
import type { Database } from '@beaconhs/db'
import {
  formTemplates,
  tenantNavConfigs,
  type NavItemConfig,
  type TenantNavConfig,
} from '@beaconhs/db/schema'
import type { SidebarNavGroup, SidebarNavItem } from '@/components/sidebar-nav'
import { buildDefaultNavConfig, moduleByKey, PINNED_FORM_DEFAULT_ICON } from './registry'

// Stable per-tenant slug of the built-in lift-plan form template (see
// packages/db/src/seed/lift-plan-template.ts). Kept local to avoid a deep
// package subpath import.
const LIFT_PLAN_TEMPLATE_KEY = 'lift-plan'
const TOOLBOX_TEMPLATE_KEY = 'toolbox-talk'

// A pinned form is visible to anyone who can interact with form responses at
// all. Workers have forms.response.create / read.self; reviewers/admins have
// template.read. Super-admin short-circuits inside can().
function canSeePinnedForm(ctx: RequestContext): boolean {
  return (
    can(ctx, 'forms.response.create') ||
    can(ctx, 'forms.response.read.self') ||
    can(ctx, 'forms.response.read.site') ||
    can(ctx, 'forms.response.read.all') ||
    can(ctx, 'forms.template.read')
  )
}

/**
 * The raw, editable nav config for the current tenant: the saved row if one
 * exists, else the computed defaults (registry modules + an auto-pinned
 * lift-plan form). Shared by the renderer (resolveNavGroups) and the
 * /admin/navigation editor so both agree on what "defaults" means.
 */
export async function loadNavConfig(tx: Database): Promise<TenantNavConfig> {
  const [row] = await tx.select().from(tenantNavConfigs).limit(1)
  if (row?.config) return row.config

  // No saved row → computed defaults. Auto-pin the built-in forms (lift-plan,
  // toolbox-talk) so the old native "Lift plans" / "Toolbox talks" entries
  // don't regress — now as real pinned forms.
  const config = buildDefaultNavConfig()
  const builtIns = await tx
    .select({ id: formTemplates.id, key: formTemplates.key })
    .from(formTemplates)
    .where(inArray(formTemplates.key, [LIFT_PLAN_TEMPLATE_KEY, TOOLBOX_TEMPLATE_KEY]))
  const frontline = config.groups.find((g) => g.id === 'frontline')
  const lift = builtIns.find((t) => t.key === LIFT_PLAN_TEMPLATE_KEY)
  if (lift) {
    frontline?.items.push({
      kind: 'form',
      templateId: lift.id,
      label: 'Lift plans',
      iconKey: 'construction',
    })
  }
  const toolbox = builtIns.find((t) => t.key === TOOLBOX_TEMPLATE_KEY)
  if (toolbox) {
    frontline?.items.push({
      kind: 'form',
      templateId: toolbox.id,
      label: 'Toolbox talks',
      iconKey: 'message',
    })
  }
  return config
}

export async function resolveNavGroups(
  ctx: RequestContext,
  tx: Database,
): Promise<SidebarNavGroup[]> {
  const config = await loadNavConfig(tx)

  // Batch-resolve pinned form templates → name / icon.
  const formIds = [
    ...new Set(
      config.groups
        .flatMap((g) => g.items)
        .filter((i): i is Extract<NavItemConfig, { kind: 'form' }> => i.kind === 'form')
        .map((i) => i.templateId),
    ),
  ]
  const formMeta = new Map<string, { name: string; iconKey: string | null }>()
  if (formIds.length > 0) {
    const rows = await tx
      .select({ id: formTemplates.id, name: formTemplates.name, iconKey: formTemplates.iconKey })
      .from(formTemplates)
      .where(inArray(formTemplates.id, formIds))
    for (const r of rows) formMeta.set(r.id, { name: r.name, iconKey: r.iconKey })
  }

  // 3. Map → SidebarNavGroup[], filtering hidden + permission + dangling refs.
  const groups: SidebarNavGroup[] = []
  for (const g of config.groups) {
    const items: SidebarNavItem[] = []
    for (const item of g.items) {
      if (item.hidden) continue
      const resolved = resolveItem(item, ctx, formMeta)
      if (resolved) items.push(resolved)
    }
    if (items.length > 0) groups.push({ label: g.label, items })
  }
  return groups
}

function resolveItem(
  item: NavItemConfig,
  ctx: RequestContext,
  formMeta: Map<string, { name: string; iconKey: string | null }>,
): SidebarNavItem | null {
  if (item.kind === 'module') {
    const mod = moduleByKey(item.moduleKey)
    if (!mod) return null // stale/removed module key
    if (mod.requiredPermission && !can(ctx, mod.requiredPermission)) return null
    if (mod.requiredAnyPermission?.length && !mod.requiredAnyPermission.some((p) => can(ctx, p))) {
      return null
    }
    return {
      href: mod.href,
      label: item.label ?? mod.label,
      iconKey: item.iconKey ?? mod.iconKey,
    }
  }
  if (item.kind === 'form') {
    const meta = formMeta.get(item.templateId)
    if (!meta) return null // template deleted
    if (!canSeePinnedForm(ctx)) return null
    return {
      // A pinned app behaves like a native module: land on its list of entries
      // (records), not the designer. Rows open the entry; editors get a
      // "Configure" link from there into the builder.
      href: `/apps/templates/${item.templateId}/records`,
      label: item.label ?? meta.name,
      iconKey: item.iconKey ?? meta.iconKey ?? PINNED_FORM_DEFAULT_ICON,
    }
  }
  // link
  return {
    href: item.href,
    label: item.label,
    iconKey: item.iconKey ?? 'link',
  }
}
