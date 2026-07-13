import type { Job } from 'bullmq'
import { and, eq } from 'drizzle-orm'
import webpush from 'web-push'
import { db, withTenant } from '@beaconhs/db'
import { webpushSubscriptions } from '@beaconhs/db/schema'
import type { PushJobData } from '@beaconhs/jobs'

const publicKey = process.env.VAPID_PUBLIC_KEY
const privateKey = process.env.VAPID_PRIVATE_KEY
if (publicKey && privateKey) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:ops@beaconhs.app',
    publicKey,
    privateKey,
  )
}

export async function processPush(job: Job<PushJobData>): Promise<void> {
  if (!publicKey || !privateKey) {
    throw new Error('Web Push is enabled but VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are not configured')
  }
  const data = job.data
  const subscription = await withTenant(db, data.tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(webpushSubscriptions)
      .where(
        and(
          eq(webpushSubscriptions.id, data.subscriptionId),
          eq(webpushSubscriptions.tenantId, data.tenantId),
          eq(webpushSubscriptions.userId, data.userId),
        ),
      )
      .limit(1)
    return row ?? null
  })
  if (!subscription) return

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify({ title: data.title, body: data.body, linkPath: data.linkPath }),
    )
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode === 404 || statusCode === 410) {
      await withTenant(db, data.tenantId, (tx) =>
        tx
          .delete(webpushSubscriptions)
          .where(
            and(
              eq(webpushSubscriptions.id, data.subscriptionId),
              eq(webpushSubscriptions.userId, data.userId),
            ),
          ),
      )
      return
    }
    throw error
  }
}
