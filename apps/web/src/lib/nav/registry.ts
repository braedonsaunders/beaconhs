// Canonical registry of built-in app modules.
//
// This is the single source of truth for the left-hand navigation. The
// resolver (./resolve.ts) merges this with a tenant's saved overrides
// (tenant_nav_config) to produce the rendered sidebar; the in-UI editor
// (/admin/navigation) lists these as the modules an admin can show / hide /
// reorder / re-label.
//
// Pure data + helpers only — no server imports — so the client editor can
// import it too. `TenantNavConfig` is a type-only import (erased at build).

import type { TenantNavConfig } from '@beaconhs/db/schema'

export type NavModule = {
  /** Stable id, referenced by NavItemConfig.moduleKey. Never change once shipped. */
  key: string
  href: string
  label: string
  /** Key into the ICONS map in components/sidebar-nav.tsx. */
  iconKey: string
  /**
   * Permission required to see this module. Checked with `can(ctx, perm)`
   * (wildcard-aware). Undefined = always visible. Sensitive/admin-adjacent
   * modules should use explicit permissions so roles can deliberately opt in.
   */
  requiredPermission?: string
  /**
   * At least one of these permissions is required to see this module. Useful for
   * hub routes where several independently gated tools live behind one entry.
   */
  requiredAnyPermission?: string[]
  /** Default group label — must be one of NAV_GROUP_ORDER. */
  group: (typeof NAV_GROUP_ORDER)[number]
}

// Group order top-to-bottom.
export const NAV_GROUP_ORDER = [
  'Overview',
  'Frontline',
  'Knowledge',
  'Assets & people',
  // Program oversight — obligations/compliance + analytics/dashboards + reports.
  'Assurance',
  'Administration',
] as const

export type NavGroupLabel = (typeof NAV_GROUP_ORDER)[number]

// Stable, url-ish ids for the default groups (used as React keys / reorder ids).
export function defaultGroupId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Every built-in module. Extracted from the previous static NAV_GROUPS in
// app-shell.tsx. Note: the old hardcoded "Lift plans" and "Toolbox talks"
// entries are intentionally gone — both are form templates now, surfaced as
// pinned forms by the resolver (auto-pinned by key in resolve.ts).
export const NAV_MODULES: NavModule[] = [
  // Overview
  { key: 'dashboard', href: '/dashboard', label: 'Dashboard', iconKey: 'gauge', group: 'Overview' },
  {
    key: 'assistant',
    href: '/assistant',
    label: 'Assistant',
    iconKey: 'sparkles',
    requiredPermission: 'assistant.use',
    group: 'Overview',
  },
  { key: 'feed', href: '/feed', label: 'Feed', iconKey: 'rss', group: 'Overview' },
  { key: 'my', href: '/my', label: 'Workspace', iconKey: 'circle-user', group: 'Overview' },
  {
    key: 'notifications',
    href: '/notifications',
    label: 'Inbox',
    iconKey: 'bell',
    group: 'Overview',
  },

  // Frontline
  {
    key: 'inspections',
    href: '/inspections',
    label: 'Inspections',
    iconKey: 'clipboard',
    group: 'Frontline',
  },
  {
    key: 'hazid',
    href: '/hazard-assessments',
    label: 'Hazard Assessments',
    iconKey: 'radiation',
    group: 'Frontline',
  },
  { key: 'journals', href: '/journals', label: 'Journals', iconKey: 'journal', group: 'Frontline' },
  {
    key: 'incidents',
    href: '/incidents',
    label: 'Incidents',
    iconKey: 'alert',
    group: 'Frontline',
  },
  {
    key: 'corrective-actions',
    href: '/corrective-actions',
    label: 'Corrective Actions',
    iconKey: 'list-checks',
    group: 'Frontline',
  },
  // Field tools (safe-distance calc, etc.) sit with the crew workflows by default.
  { key: 'tools', href: '/tools', label: 'Tools', iconKey: 'wrench', group: 'Frontline' },

  // Knowledge
  { key: 'training', href: '/training', label: 'Training', iconKey: 'grad', group: 'Knowledge' },
  { key: 'documents', href: '/documents', label: 'Documents', iconKey: 'book', group: 'Knowledge' },

  // Assets & people
  { key: 'people', href: '/people', label: 'People', iconKey: 'users', group: 'Assets & people' },
  {
    key: 'locations',
    href: '/locations',
    label: 'Locations',
    iconKey: 'pin',
    group: 'Assets & people',
  },
  {
    key: 'equipment',
    href: '/equipment',
    label: 'Equipment',
    iconKey: 'wrench',
    group: 'Assets & people',
  },
  { key: 'ppe', href: '/ppe', label: 'PPE', iconKey: 'hard-hat', group: 'Assets & people' },

  // Compliance — the unified obligations hub (viewing + management). Visible to
  // EVERYONE: a person without `compliance.read` still has their own obligations,
  // so `/compliance` lands them on "Mine" (the overview redirects there) while
  // holders of `compliance.read` get the org-wide hub. Org tabs + write actions
  // stay gated on the pages themselves.
  {
    key: 'compliance',
    href: '/compliance',
    label: 'Compliance',
    iconKey: 'check',
    group: 'Assurance',
  },

  // Insight
  {
    key: 'insights',
    href: '/insights',
    label: 'Insights',
    iconKey: 'gauge',
    requiredPermission: 'reports.read',
    group: 'Assurance',
  },
  {
    key: 'reports',
    href: '/reports',
    label: 'Reports',
    iconKey: 'file',
    requiredPermission: 'reports.read',
    group: 'Assurance',
  },

  // Administration
  // Library & catalogues and Navigation are intentionally NOT sidebar modules —
  // they're surfaced as tiles on the /admin landing page to keep the sidebar lean.
  {
    key: 'admin',
    href: '/admin',
    label: 'Admin',
    iconKey: 'settings',
    requiredAnyPermission: [
      'admin.users.manage',
      'admin.roles.manage',
      'admin.org.manage',
      'admin.api-keys.manage',
      'admin.settings.manage',
      'admin.audit.read',
      'admin.nav.manage',
      'admin.integrations.manage',
      'admin.data.export',
    ],
    group: 'Administration',
  },
  // Forms = the template library + designer; a build/admin task, so it lives in
  // Administration. Crews don't need the library — they fill forms via
  // assignments, the module pages (inspections/JSHA/…), and pinned forms.
  {
    key: 'forms',
    href: '/apps',
    label: 'Builder',
    iconKey: 'clipboard-check',
    requiredPermission: 'forms.template.read',
    group: 'Administration',
  },
]

const MODULE_BY_KEY = new Map(NAV_MODULES.map((m) => [m.key, m]))

export function moduleByKey(key: string): NavModule | undefined {
  return MODULE_BY_KEY.get(key)
}

// Default config when a tenant has no saved row: every module in registry order,
// grouped by its `group`. Pure (no DB) — the resolver layers the lift-plan form
// pin on top of this. Also used by the editor's "reset to defaults".
export function buildDefaultNavConfig(): TenantNavConfig {
  return {
    version: 1,
    groups: NAV_GROUP_ORDER.map((label) => ({
      id: defaultGroupId(label),
      label,
      items: NAV_MODULES.filter((m) => m.group === label).map((m) => ({
        kind: 'module' as const,
        moduleKey: m.key,
      })),
    })).filter((g) => g.items.length > 0),
  }
}

// Default icon for a pinned form when neither the pin nor the template sets one.
export const PINNED_FORM_DEFAULT_ICON = 'clipboard-check'
