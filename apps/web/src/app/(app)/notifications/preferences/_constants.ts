// Canonical list of notification categories + channels surfaced in the
// preferences UI. Category keys must match what dispatchers actually stamp on
// notifications — the native engines emit `incident`, `ca`, and `compliance`
// (see packages/events), the training/document Flow adapters emit `training`
// and `document`, and the monitored-session overdue scanner emits
// `monitored_session`. Channels mirror the notificationChannel pgEnum in
// @beaconhs/db/schema.
//
// A user without a row for (category, channel) is treated as "enabled" by the
// dispatcher, so we render the defaults checked when no row exists.

export const NOTIFICATION_CATEGORIES = [
  'incident',
  'ca',
  'compliance',
  'training',
  'document',
  'monitored_session',
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
    compliance: {
      title: 'Compliance',
      description: 'Obligations becoming due, overdue, or expiring.',
    },
    training: {
      title: 'Training',
      description: 'Course assignments, expiry reminders, completions.',
    },
    document: {
      title: 'Documents',
      description: 'Periodic-review due, new versions to acknowledge.',
    },
    // Every monitored Builder app escalates under `monitored_session`.
    monitored_session: {
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
