'use server'

// Per-device Web Push subscription registry. The browser creates the
// PushSubscription (endpoint + p256dh/auth keys) client-side after the user
// grants notification permission; these actions persist and remove it so the
// notify worker (apps/worker/src/workers/notify.ts) can fan pushes out to it.

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import webpush from 'web-push'
import { webpushSubscriptions } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

const SaveSchema = z.object({
  endpoint: z.string().url().max(2048),
  p256dh: z.string().min(1).max(256),
  auth: z.string().min(1).max(256),
  userAgent: z.string().max(512).optional(),
})

export async function savePushSubscription(input: unknown) {
  const ctx = await requireRequestContext()
  const parsed = SaveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: 'Invalid subscription payload.' }
  }
  const { endpoint, p256dh, auth, userAgent } = parsed.data

  // The push endpoint is unique per browser (per VAPID key) and carries a
  // global unique index. Re-subscribing on the same device updates the keys
  // and re-points the row at the current user — last writer wins, since a
  // browser only ever has one live subscription.
  try {
    await ctx.db((tx) =>
      tx
        .insert(webpushSubscriptions)
        .values({ tenantId: ctx.tenantId, userId: ctx.userId, endpoint, p256dh, auth, userAgent })
        .onConflictDoUpdate({
          target: webpushSubscriptions.endpoint,
          set: {
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            p256dh,
            auth,
            userAgent,
            updatedAt: new Date(),
          },
        }),
    )
  } catch (err) {
    console.warn('[push] failed to save subscription:', err)
    return { ok: false as const, error: 'Could not save the subscription.' }
  }

  return { ok: true as const }
}

const RemoveSchema = z.object({ endpoint: z.string().url().max(2048) })

export async function removePushSubscription(input: unknown) {
  const ctx = await requireRequestContext()
  const parsed = RemoveSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, error: 'Invalid endpoint.' }
  }
  await ctx.db((tx) =>
    tx
      .delete(webpushSubscriptions)
      .where(
        and(
          eq(webpushSubscriptions.endpoint, parsed.data.endpoint),
          eq(webpushSubscriptions.userId, ctx.userId),
        ),
      ),
  )
  return { ok: true as const }
}

// web-push keeps VAPID details in module-global state; configure once per process.
let vapidReady = false
function configureVapid(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return false
  if (!vapidReady) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? 'mailto:ops@beaconhs.app',
      publicKey,
      privateKey,
    )
    vapidReady = true
  }
  return true
}

/**
 * Fire a one-off push to all of the caller's subscribed devices so they can
 * confirm enrolment works — sent directly (not via the notify queue) so the
 * result is synchronous and leaves no inbox/email trace. Dead endpoints are
 * pruned on 404/410, mirroring the worker.
 */
export async function sendTestPush() {
  const ctx = await requireRequestContext()
  if (!configureVapid()) {
    return { ok: false as const, error: 'Push is not configured on this server.' }
  }

  const subs = await ctx.db((tx) =>
    tx.select().from(webpushSubscriptions).where(eq(webpushSubscriptions.userId, ctx.userId)),
  )
  if (subs.length === 0) {
    return { ok: false as const, error: 'No subscribed devices found. Enable push first.' }
  }

  const payload = JSON.stringify({
    title: 'BeaconHS test',
    body: 'Push notifications are working on this device.',
    linkPath: '/notifications/preferences',
  })

  let sent = 0
  let removed = 0
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
      sent++
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        await ctx.db((tx) =>
          tx.delete(webpushSubscriptions).where(eq(webpushSubscriptions.id, sub.id)),
        )
        removed++
      } else {
        console.warn('[push] test send failed:', err)
      }
    }
  }

  if (sent === 0) {
    return {
      ok: false as const,
      error:
        removed > 0
          ? 'Your subscription expired. Turn push off and on again.'
          : 'Could not deliver the test push.',
    }
  }
  return { ok: true as const, sent }
}
