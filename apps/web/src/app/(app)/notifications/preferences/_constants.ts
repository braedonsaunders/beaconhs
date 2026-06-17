// Canonical list of notification categories + channels surfaced in the
// preferences UI. Kept in sync with:
//   • DEFAULT_ROLES_BY_CATEGORY in @beaconhs/events
//   • notificationChannel pgEnum in @beaconhs/db/schema
//
// A user without a row for (category, channel) is treated as "enabled" by the
// dispatcher, so we render the defaults checked when no row exists.

export const NOTIFICATION_CATEGORIES = [
  'incident',
  'ca',
  'training',
  'document',
  'lone_worker',
] as const

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<NotificationCategory, { title: string; description: string }> =
  {
    incident: {
      title: 'Incidents',
      description: 'New incidents reported, status changes, investigations.',
    },
    ca: {
      title: 'Corrective actions',
      description: 'Assignments, due-date reminders, overdue escalations.',
    },
    training: {
      title: 'Training',
      description: 'Course assignments, expiry reminders, completions.',
    },
    document: {
      title: 'Documents',
      description: 'Periodic-review due, new versions to acknowledge.',
    },
    // Engine category key stays `lone_worker` (every monitored Builder app
    // escalates under it); the label is generic.
    lone_worker: {
      title: 'Monitored sessions',
      description: 'Missed check-ins, escalations, and overdue session alerts.',
    },
  }

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push', 'sms'] as const

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

export const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: 'In-app',
  email: 'Email',
  push: 'Web push',
  sms: 'SMS',
}
