// The automatic-notification categories surfaced in /admin/notifications.
// `recurring` categories are driven by a worker scan that re-checks "still
// overdue / still due" records, so they expose a reminder-frequency control;
// the rest fire once on a domain event.
//
// This module is imported by a client component, so it must stay free of
// server-only deps. The default roles below MIRROR DEFAULT_ROLES_BY_CATEGORY in
// packages/events/src/index.ts (the dispatcher's runtime fallback) — keep them
// in sync. They only pre-fill the UI; the dispatcher is the source of truth.

export type NotificationCategory = {
  key: string
  label: string
  description: string
  recurring: boolean
  defaultRoles: string[]
}

const DEFAULT_AUDIENCE = ['safety_manager', 'tenant_admin']
const defaults = (): string[] => [...DEFAULT_AUDIENCE]

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    key: 'incident',
    label: 'Incidents',
    description: 'New incident reports and status changes.',
    recurring: false,
    defaultRoles: defaults(),
  },
  {
    key: 'ca',
    label: 'Corrective actions',
    description: 'Assignments, completions, and overdue reminders.',
    recurring: true,
    defaultRoles: defaults(),
  },
  {
    key: 'training',
    label: 'Training',
    description: 'Certifications expiring (90/30/7/1 days out) and lapses.',
    recurring: false,
    defaultRoles: defaults(),
  },
  {
    key: 'document',
    label: 'Documents',
    description: 'Controlled documents due for review.',
    recurring: true,
    defaultRoles: defaults(),
  },
  {
    key: 'compliance',
    label: 'Compliance',
    description: 'Obligations that pass their due date.',
    recurring: false,
    defaultRoles: defaults(),
  },
  {
    key: 'lone_worker',
    label: 'Lone worker',
    description: 'Missed safety check-ins and escalations.',
    recurring: false,
    defaultRoles: defaults(),
  },
]

// Reminder-frequency presets (hours). An empty value means "use the built-in
// default window" (24h) — stored as null.
export const REMINDER_PRESETS: { value: string; label: string }[] = [
  { value: '', label: 'Default (once a day)' },
  { value: '6', label: 'Every 6 hours' },
  { value: '12', label: 'Every 12 hours' },
  { value: '24', label: 'Once a day' },
  { value: '72', label: 'Every 3 days' },
  { value: '168', label: 'Once a week' },
]
