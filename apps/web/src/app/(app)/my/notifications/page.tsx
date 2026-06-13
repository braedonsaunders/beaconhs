import { redirect } from 'next/navigation'

// Notification preferences moved next to the inbox; this path survives for
// old links and bookmarks.
export default function LegacyNotificationPreferencesPage() {
  redirect('/notifications/preferences')
}
