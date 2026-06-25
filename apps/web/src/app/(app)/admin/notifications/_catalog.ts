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
  {
    key: 'training',
    label: 'Training',
    description: 'Training alerts raised by flows and modules.',
    defaultRoles: defaults(),
  },
  {
    key: 'document',
    label: 'Documents',
    description: 'Document alerts raised by flows and modules.',
    defaultRoles: defaults(),
  },
  {
    key: 'lone_worker',
    label: 'Lone worker',
    description: 'Missed safety check-ins and escalations.',
    defaultRoles: defaults(),
  },
]
