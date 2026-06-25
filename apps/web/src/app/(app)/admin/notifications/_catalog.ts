// The notification categories surfaced in /admin/notifications — the audience +
// routing buckets every alert is filed under.
//
// This module is imported by a client component, so it must stay free of
// server-only deps. The default roles below MIRROR DEFAULT_ROLES_BY_CATEGORY in
// packages/events/src/index.ts (the dispatcher's runtime fallback) — keep them
// in sync. They only pre-fill the UI; the dispatcher is the source of truth.

export type NotificationCategory = {
  key: string
  label: string
  description: string
  defaultRoles: string[]
}

const DEFAULT_AUDIENCE = ['safety_manager', 'tenant_admin']
const defaults = (): string[] => [...DEFAULT_AUDIENCE]

// Only the NATIVE engines that emit alerts in code — incidents, corrective
// actions, and the compliance engine. Builder apps (lone worker, any custom or
// monitored app) and module-specific alerts route through Flows, where the
// audience is per-app and dynamic, so they don't belong in this fixed list.
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    key: 'incident',
    label: 'Incidents',
    description: 'New incident reports and status changes.',
    defaultRoles: defaults(),
  },
  {
    key: 'ca',
    label: 'Corrective actions',
    description: 'Corrective action assignments and completions.',
    defaultRoles: defaults(),
  },
  {
    key: 'compliance',
    label: 'Compliance',
    description:
      'Obligations becoming due, overdue, or expiring — the single source of due/overdue alerts.',
    defaultRoles: defaults(),
  },
]
