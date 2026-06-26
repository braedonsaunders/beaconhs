import type { Job } from 'bullmq'
import { and, eq, inArray } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import {
  notificationPreferences,
  notifications,
  people,
  smsLog,
  tenantNotificationPolicy,
  tenantNotificationSettings,
  tenantUsers,
  users,
  webpushSubscriptions,
} from '@beaconhs/db/schema'
import { enqueueEmail, type NotifyJobData } from '@beaconhs/jobs'
import webpush from 'web-push'
import { sendSms, sendSmsVia } from '@beaconhs/sms'
import { resolveSmsDelivery } from '../lib/resolve-sms-transport'

/** True when `hourUtc` falls inside the quiet window (handles overnight wrap). */
function inQuietHours(qh: { start: number; end: number } | null, hourUtc: number): boolean {
  if (!qh || qh.start === qh.end) return false
  return qh.start < qh.end
    ? hourUtc >= qh.start && hourUtc < qh.end
    : hourUtc >= qh.start || hourUtc < qh.end
}

const vapidPub = process.env.VAPID_PUBLIC_KEY
const vapidPriv = process.env.VAPID_PRIVATE_KEY
if (vapidPub && vapidPriv) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? 'mailto:ops@beaconhs.app',
    vapidPub,
    vapidPriv,
  )
}

export async function processNotification(job: Job<NotifyJobData>): Promise<void> {
  const d = job.data
  const critical = d.isCritical ?? false
  const requestedUserIds = [...new Set(d.userIds.map((id) => id.trim()).filter(Boolean))]
  await withTenant(db, d.tenantId, async (tx) => {
    // Routing policy (Phase 2): per-category channel allow-list + tenant-wide
    // digest/quiet-hours. Channels configured for the category override the
    // emitter's defaults; digest + quiet hours defer non-critical email/push.
    const [catCfg] = await tx
      .select({ channels: tenantNotificationSettings.channels })
      .from(tenantNotificationSettings)
      .where(
        and(
          eq(tenantNotificationSettings.tenantId, d.tenantId),
          eq(tenantNotificationSettings.category, d.category),
        ),
      )
      .limit(1)
    const [policy] = await tx
      .select({
        digestMode: tenantNotificationPolicy.digestMode,
        quietHours: tenantNotificationPolicy.quietHours,
      })
      .from(tenantNotificationPolicy)
      .where(eq(tenantNotificationPolicy.tenantId, d.tenantId))
      .limit(1)

    const allowed = catCfg?.channels.length ? catCfg.channels : (d.channels ?? ['in_app', 'email'])
    const quietNow = inQuietHours(policy?.quietHours ?? null, new Date().getUTCHours())
    const digestOn = (policy?.digestMode ?? 'off') !== 'off'
    // Non-critical email holds for the digest or quiet hours; in-app always lands
    // (it's the digest's source) and critical always sends immediately.
    const emailAllowed = allowed.includes('email') && (critical || (!digestOn && !quietNow))
    const pushAllowed = allowed.includes('push') && (critical || !quietNow)
    const smsAllowed = allowed.includes('sms')

    // Determine effective channels per active tenant member. The queue is a
    // trust boundary: every producer supplies userIds, so the worker enforces
    // tenant membership before writing in-app rows or sending external channels.
    const targets =
      requestedUserIds.length > 0
        ? await tx
            .select({ user: users, pref: notificationPreferences })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .leftJoin(
              notificationPreferences,
              and(
                eq(notificationPreferences.userId, users.id),
                eq(notificationPreferences.tenantId, d.tenantId),
                eq(notificationPreferences.category, d.category),
              ),
            )
            .where(
              and(
                eq(tenantUsers.tenantId, d.tenantId),
                eq(tenantUsers.status, 'active'),
                inArray(tenantUsers.userId, requestedUserIds),
              ),
            )
        : []
    const targetUserIds = targets.map((target) => target.user.id)

    // 1. Always insert in_app
    for (const u of targetUserIds) {
      await tx.insert(notifications).values({
        tenantId: d.tenantId,
        userId: u,
        category: d.category,
        type: d.type,
        title: d.title,
        body: d.body,
        linkPath: d.linkPath,
        data: d.data ?? {},
        isCritical: d.isCritical ?? false,
      })
    }

    // SMS transport resolved once per job (tenant constant): platform → tenant →
    // env. Critical-only by design — SMS costs money, so it is reserved for the
    // notifications a tenant routes to SMS and that are flagged critical.
    const smsDelivery = critical && smsAllowed ? await resolveSmsDelivery(d.tenantId) : null
    if (smsDelivery?.kind === 'suppressed') {
      // Kill switch: record one suppressed row for the whole job (no per-recipient
      // phone lookups) so the SMS log shows the deliberate non-delivery.
      const body = d.body ? `${d.title}\n${d.body}` : d.title
      await tx.insert(smsLog).values({
        tenantId: d.tenantId,
        jobId: String(job.id ?? ''),
        status: 'suppressed',
        categoryKey: d.category,
        body,
        bodyLength: body.length,
        errorMessage: 'SMS delivery is disabled by the platform administrator.',
        meta: { recipients: targetUserIds.length },
      })
      console.log('[sms] suppressed: SMS is disabled by the platform administrator')
    }

    // 2. Email + push fan-out
    for (const t of targets) {
      const emailPref = t.pref?.channel === 'email' ? t.pref.enabled !== false : true
      if (emailAllowed && emailPref) {
        await enqueueEmail({
          to: t.user.email,
          subject: d.title,
          html: `<p>${escapeHtml(d.body ?? d.title)}</p>${d.linkPath ? `<p><a href="${process.env.APP_URL ?? ''}${d.linkPath}">Open in app</a></p>` : ''}`,
          text: `${d.body ?? d.title}${d.linkPath ? `\n${process.env.APP_URL ?? ''}${d.linkPath}` : ''}`,
        })
      }

      if (pushAllowed && vapidPub && vapidPriv) {
        const subs = await tx
          .select()
          .from(webpushSubscriptions)
          .where(eq(webpushSubscriptions.userId, t.user.id))
        for (const sub of subs) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({ title: d.title, body: d.body, linkPath: d.linkPath }),
            )
          } catch (err) {
            const statusCode = (err as { statusCode?: number }).statusCode
            if (statusCode === 404 || statusCode === 410) {
              // Endpoint gone (unsubscribed or expired) — prune it so we stop
              // retrying a dead subscription on every future notification.
              await tx.delete(webpushSubscriptions).where(eq(webpushSubscriptions.id, sub.id))
            } else {
              const msg = err instanceof Error ? err.message : String(err)
              console.warn(`[push] failed for ${t.user.email}: ${msg}`)
            }
          }
        }
      }

      // SMS via the resolved provider (tenant → platform → env Twilio fallback).
      // Every attempt is written to sms_log so the support team can answer "did
      // X get the text?" — mirrors the email_log audit trail.
      if (smsDelivery && smsDelivery.kind !== 'suppressed') {
        const via = smsDelivery.kind === 'transport' ? smsDelivery.transport.provider : 'env'
        const text = (d.body ? `${d.title}\n${d.body}` : d.title).slice(0, 1500)
        const [person] = await tx
          .select({ phone: people.phone })
          .from(people)
          .where(eq(people.userId, t.user.id))
          .limit(1)
        const phone = person?.phone?.trim()
        if (!phone) {
          await tx.insert(smsLog).values({
            tenantId: d.tenantId,
            jobId: String(job.id ?? ''),
            provider: via,
            status: 'skipped',
            categoryKey: d.category,
            body: text,
            bodyLength: text.length,
            errorMessage: 'No phone number on file for this user.',
            meta: { userEmail: t.user.email },
          })
          console.log(`[sms] skipped: no phone on file for ${t.user.email}`)
        } else {
          try {
            const result =
              smsDelivery.kind === 'transport'
                ? await sendSmsVia(smsDelivery.transport, { to: phone, body: text })
                : await sendSms({ to: phone, body: text })
            await tx.insert(smsLog).values({
              tenantId: d.tenantId,
              jobId: String(job.id ?? ''),
              provider: via,
              providerMessageId: result.id || null,
              recipient: phone,
              status: 'sent',
              categoryKey: d.category,
              body: text,
              bodyLength: text.length,
              sentAt: new Date(),
              meta: { userEmail: t.user.email },
            })
            console.log(`[sms] sent ${result.id || '(no id)'} to ${t.user.email} via ${via}`)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            await tx.insert(smsLog).values({
              tenantId: d.tenantId,
              jobId: String(job.id ?? ''),
              provider: via,
              recipient: phone,
              status: 'failed',
              categoryKey: d.category,
              body: text,
              bodyLength: text.length,
              errorMessage: msg,
              meta: { userEmail: t.user.email },
            })
            console.warn(`[sms] failed for ${t.user.email}: ${msg}`)
          }
        }
      }
    }
  })
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
