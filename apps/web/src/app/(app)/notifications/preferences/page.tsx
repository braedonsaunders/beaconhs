import { and, eq } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { notificationPreferences } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { PreferencesForm } from './_form'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from './_constants'

export const metadata = { title: 'Notification preferences' }
export const dynamic = 'force-dynamic'

const CATEGORY_SET = new Set<string>(NOTIFICATION_CATEGORIES)
const CHANNEL_SET = new Set<string>(NOTIFICATION_CHANNELS)

export default async function NotificationPreferencesPage() {
  const ctx = await requireRequestContext()

  const rows = await ctx.db((tx) =>
    tx
      .select({
        category: notificationPreferences.category,
        channel: notificationPreferences.channel,
        enabled: notificationPreferences.enabled,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, ctx.tenantId),
          eq(notificationPreferences.userId, ctx.userId),
        ),
      ),
  )

  // Only keep rows for categories/channels we surface; anything else is
  // legacy/seed data and should not influence the matrix the user sees.
  const initial = rows
    .filter((r) => CATEGORY_SET.has(r.category) && CHANNEL_SET.has(r.channel))
    .map((r) => ({
      category: r.category as NotificationCategory,
      channel: r.channel as NotificationChannel,
      enabled: r.enabled,
    }))

  return (
    <PageContainer>
      <div className="space-y-4">
        <PageHeader
          title="Notification preferences"
          description="Choose which notification categories reach you, and on which channels. In-app delivery always lands in your inbox."
          back={{ href: '/notifications', label: 'Back to inbox' }}
        />
        <PreferencesForm initial={initial} />
      </div>
    </PageContainer>
  )
}
