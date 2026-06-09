// Per-tenant sidebar navigation customisation.
//
// The app's left-hand nav is built from a code-defined *module registry*
// (apps/web/src/lib/nav/registry.ts) merged with the optional row stored here.
// If a tenant has no row, the resolver computes sensible defaults from the
// registry. Admins with `admin.nav.manage` edit the config in the UI at
// /admin/navigation, which upserts the single row below.
//
// One row per tenant (mirrors the userDashboardLayouts precedent in
// dashboard-layouts.ts). The whole layout lives in a single jsonb `config`
// blob so the editor can save it atomically.

import { index, jsonb, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'

// A single nav entry. Three shapes:
//   - module: a built-in module from the registry, keyed by its stable
//     `moduleKey`. label/iconKey override the registry defaults; `hidden`
//     keeps it in the config (so the editor still lists it) but drops it from
//     the rendered sidebar.
//   - form:   a pinned form template, surfaced as if it were a native module.
//     Resolves to the template's "home" page; label/iconKey fall back to the
//     template's name / icon.
//   - link:   an arbitrary URL (internal route or external).
export type NavItemConfig =
  | { kind: 'module'; moduleKey: string; label?: string; iconKey?: string; hidden?: boolean }
  | { kind: 'form'; templateId: string; label?: string; iconKey?: string; hidden?: boolean }
  | { kind: 'link'; href: string; label: string; iconKey?: string; hidden?: boolean }

export type NavGroupConfig = {
  // Stable id for the group (used as the React key + reorder identity).
  id: string
  label: string
  items: NavItemConfig[]
}

export type TenantNavConfig = {
  version: 1
  groups: NavGroupConfig[]
}

export const tenantNavConfigs = pgTable(
  'tenant_nav_config',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    config: jsonb('config').$type<TenantNavConfig>().notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantUx: uniqueIndex('tenant_nav_config_tenant_ux').on(t.tenantId),
    tenantIdx: index('tenant_nav_config_tenant_idx').on(t.tenantId),
  }),
)
