// The notification categories surfaced in /admin/notifications — the audience +
// routing buckets every alert is filed under.
//
// This module is imported by a client component, so it must stay free of
// server-only deps. The default roles below MIRROR DEFAULT_ROLES_BY_CATEGORY in
// packages/events/src/recipients.ts (the dispatcher's runtime fallback) — keep them
// in sync. They only pre-fill the UI; the dispatcher is the source of truth.

export type NotificationCategory = {
  key: string
  label: string
  description: string
  defaultRoles: string[]
  defaultChannels?: string[]
  /** Recipients come from the record itself (no role/people audience here);
   *  `recipientsNote` explains where. */
  directRecipients?: boolean
  recipientsNote?: string
  /** Delivered by email only — channels and escalation don't apply. */
  emailOnly?: boolean
}

const DEFAULT_AUDIENCE = ['safety_manager', 'tenant_admin']
const defaults = (): string[] => [...DEFAULT_AUDIENCE]

// Only the NATIVE engines that emit alerts in code — incidents, corrective
// actions, the compliance engine, emailed journal entries and AI briefs. Builder apps (timed check-ins, any custom or
// monitored app) and module-specific alerts route through Flows, where the
// audience is per-app and dynamic, so they don't belong in this fixed list.
export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  {
    key: 'hazid_signing',
    label: 'Hazard assessment signing',
    description:
      'Manual signature requests sent only to the selected crew members. Each person reviews and signs their own space.',
    defaultRoles: [],
    defaultChannels: ['in_app', 'push', 'email'],
    directRecipients: true,
    recipientsNote: 'Recipients are the unsigned crew members selected on the assessment.',
  },
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
    key: 'equipment',
    label: 'Equipment maintenance',
    description:
      'Inspection schedules and maintenance reminders becoming due or overdue. Assigned reminders also alert the assignee directly.',
    defaultRoles: defaults(),
  },
  {
    key: 'journal',
    label: 'Journal emails',
    description:
      'Who gets a copy when someone emails a journal entry. The entry author and supervisor always get one.',
    defaultRoles: ['tenant_admin'],
    defaultChannels: ['email'],
    emailOnly: true,
  },
  {
    key: 'brief',
    label: 'AI briefs',
    description: 'A new AI brief is ready, or a scheduled brief could not be written.',
    defaultRoles: [],
    defaultChannels: ['in_app', 'push', 'email'],
    directRecipients: true,
    recipientsNote:
      'Recipients are the people on each brief schedule. Failures go to the person who owns the schedule.',
  },
]
