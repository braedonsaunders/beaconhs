import { getGeneratedTranslations } from '@/i18n/generated.server'
import { and, eq } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { notificationPreferences } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { PreferencesForm } from './_form'
import { PushToggle } from './_push-toggle'
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from './_constants'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_187c665fb0445c') }
}
export const dynamic = 'force-dynamic'

const CATEGORY_SET = new Set<string>(NOTIFICATION_CATEGORIES)
const CHANNEL_SET = new Set<string>(NOTIFICATION_CHANNELS)

export default async function NotificationPreferencesPage() {
  const tGenerated = await getGeneratedTranslations()
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
          title={tGenerated('m_187c665fb0445c')}
          description={tGenerated('m_0ca583c9496c13')}
          back={{ href: '/notifications', label: 'Back to inbox' }}
        />
        <PushToggle vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? null} />
        <PreferencesForm initial={initial} />
      </div>
    </PageContainer>
  )
}
