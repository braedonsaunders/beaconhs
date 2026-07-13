import type { Job } from 'bullmq'
import { createHash } from 'node:crypto'
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
import { enqueueEmail, enqueuePush, type NotifyJobData } from '@beaconhs/jobs'
import { sendSmsVia } from '@beaconhs/sms'
import { resolveSmsDelivery } from '../lib/resolve-sms-transport'
import { appBaseUrl } from '../lib/app-base-url'
import { escapeHtml } from '../lib/escape-html'

/** True when `hourUtc` falls inside the quiet window (handles overnight wrap). */
function inQuietHours(qh: { start: number; end: number } | null, hourUtc: number): boolean {
  if (!qh || qh.start === qh.end) return false
  return qh.start < qh.end
    ? hourUtc >= qh.start && hourUtc < qh.end
    : hourUtc >= qh.start || hourUtc < qh.end
}

/** Milliseconds from `now` until the quiet window's end hour (UTC) next occurs. */
function msUntilQuietHoursEnd(qh: { start: number; end: number }, now: Date): number {
  const end = new Date(now)
  end.setUTCMinutes(0, 0, 0)
  end.setUTCHours(qh.end)
  if (end.getTime() <= now.getTime()) end.setUTCDate(end.getUTCDate() + 1)
  return end.getTime() - now.getTime()
}

export async function processNotification(job: Job<NotifyJobData>): Promise<void> {
  const d = job.data
  const sourceJobId = String(job.id ?? '')
  if (!sourceJobId) throw new Error('Notification worker requires a durable BullMQ job id')
  const critical = d.isCritical ?? false
  const requestedUserIds = [...new Set(d.userIds.map((id) => id.trim()).filter(Boolean))]
  const plan = await withTenant(db, d.tenantId, async (tx) => {
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

    const now = new Date()
    const allowed = catCfg?.channels.length ? catCfg.channels : (d.channels ?? ['in_app', 'email'])
    const quietHours = policy?.quietHours ?? null
    const quietNow = inQuietHours(quietHours, now.getUTCHours())
    const digestOn = (policy?.digestMode ?? 'off') !== 'off'
    const emailAllowed = allowed.includes('email') && (critical || !digestOn)
    const emailDelayMs =
      !critical && quietNow && quietHours ? msUntilQuietHoursEnd(quietHours, now) : 0
    const pushAllowed = allowed.includes('push') && (critical || !quietNow)
    const smsAllowed = allowed.includes('sms')

    const targets =
      requestedUserIds.length > 0
        ? await tx
            .select({ user: users })
            .from(tenantUsers)
            .innerJoin(users, eq(users.id, tenantUsers.userId))
            .where(
              and(
                eq(tenantUsers.tenantId, d.tenantId),
                eq(tenantUsers.status, 'active'),
                inArray(tenantUsers.userId, requestedUserIds),
              ),
            )
        : []
    const targetUserIds = targets.map((target) => target.user.id)

    const prefRows =
      targetUserIds.length > 0
        ? await tx
            .select({
              userId: notificationPreferences.userId,
              channel: notificationPreferences.channel,
              enabled: notificationPreferences.enabled,
            })
            .from(notificationPreferences)
            .where(
              and(
                eq(notificationPreferences.tenantId, d.tenantId),
                eq(notificationPreferences.category, d.category),
                inArray(notificationPreferences.userId, targetUserIds),
              ),
            )
        : []
    for (const u of targetUserIds) {
      await tx
        .insert(notifications)
        .values({
          tenantId: d.tenantId,
          userId: u,
          category: d.category,
          type: d.type,
          title: d.title,
          body: d.body,
          linkPath: d.linkPath,
          data: d.data ?? {},
          isCritical: d.isCritical ?? false,
          sourceJobId,
        })
        .onConflictDoNothing({
          target: [notifications.tenantId, notifications.sourceJobId, notifications.userId],
        })
    }
    return { targets, prefRows, emailAllowed, emailDelayMs, pushAllowed, smsAllowed }
  })

  const prefsByUser = new Map<string, Map<string, boolean>>()
  for (const row of plan.prefRows) {
    const byChannel = prefsByUser.get(row.userId) ?? new Map<string, boolean>()
    byChannel.set(row.channel, row.enabled)
    prefsByUser.set(row.userId, byChannel)
  }
  const channelEnabled = (userId: string, channel: 'email' | 'push' | 'sms'): boolean =>
    prefsByUser.get(userId)?.get(channel) !== false
  const baseUrl = appBaseUrl()

  // Publish all email jobs before contacting non-idempotent providers. Queue
  // ids are deterministic, so a later retry cannot fan out duplicate emails.
  for (const target of plan.targets) {
    if (!plan.emailAllowed || !channelEnabled(target.user.id, 'email')) continue
    await enqueueEmail(
      {
        to: target.user.email,
        subject: d.title,
        html: `<p>${escapeHtml(d.body ?? d.title)}</p>${d.linkPath ? `<p><a href="${escapeHtml(`${baseUrl}${d.linkPath}`)}">Open in app</a></p>` : ''}`,
        text: `${d.body ?? d.title}${d.linkPath ? `\n${baseUrl}${d.linkPath}` : ''}`,
        meta: { tenantId: d.tenantId, userId: target.user.id, category: d.category },
      },
      {
        ...(plan.emailDelayMs > 0 ? { delay: plan.emailDelayMs } : {}),
        jobId: `notification-email|${createHash('sha256')
          .update(`${sourceJobId}\0${target.user.id}`)
          .digest('hex')}`,
      },
    )
  }

  // Push has its own retry queue. One dead endpoint cannot replay in-app,
  // email, or SMS delivery.
  if (plan.pushAllowed) {
    for (const target of plan.targets) {
      if (!channelEnabled(target.user.id, 'push')) continue
      const subscriptions = await withTenant(db, d.tenantId, (tx) =>
        tx
          .select()
          .from(webpushSubscriptions)
          .where(eq(webpushSubscriptions.userId, target.user.id)),
      )
      for (const subscription of subscriptions) {
        const pushJobId = `notification-push|${createHash('sha256')
          .update(`${sourceJobId}\0${subscription.id}`)
          .digest('hex')}`
        await enqueuePush(
          {
            tenantId: d.tenantId,
            userId: target.user.id,
            subscriptionId: subscription.id,
            title: d.title,
            body: d.body,
            linkPath: d.linkPath,
          },
          pushJobId,
        )
      }
    }
  }

  const smsDelivery = critical && plan.smsAllowed ? await resolveSmsDelivery(d.tenantId) : null
  if (smsDelivery?.kind === 'suppressed') {
    const [existing] = await withTenant(db, d.tenantId, (tx) =>
      tx
        .select({ id: smsLog.id })
        .from(smsLog)
        .where(and(eq(smsLog.jobId, sourceJobId), eq(smsLog.status, 'suppressed')))
        .limit(1),
    )
    if (!existing) {
      const body = d.body ? `${d.title}\n${d.body}` : d.title
      await withTenant(db, d.tenantId, (tx) =>
        tx.insert(smsLog).values({
          tenantId: d.tenantId,
          jobId: sourceJobId,
          status: 'suppressed',
          categoryKey: d.category,
          body,
          bodyLength: body.length,
          errorMessage: 'SMS delivery is disabled by the platform administrator.',
          meta: { recipients: plan.targets.length },
        }),
      )
    }
    return
  }

  const smsFailures: string[] = []
  if (smsDelivery) {
    const via = smsDelivery.kind === 'transport' ? smsDelivery.transport.provider : 'unconfigured'
    const text = (d.body ? `${d.title}\n${d.body}` : d.title).slice(0, 1500)
    for (const target of plan.targets) {
      if (!channelEnabled(target.user.id, 'sms')) continue
      const [person] = await withTenant(db, d.tenantId, (tx) =>
        tx
          .select({ phone: people.phone })
          .from(people)
          .where(and(eq(people.tenantId, d.tenantId), eq(people.userId, target.user.id)))
          .limit(1),
      )
      const phone = person?.phone?.trim()
      if (!phone) {
        await withTenant(db, d.tenantId, (tx) =>
          tx.insert(smsLog).values({
            tenantId: d.tenantId,
            jobId: sourceJobId,
            provider: via,
            status: 'skipped',
            categoryKey: d.category,
            body: text,
            bodyLength: text.length,
            errorMessage: 'No phone number on file for this user.',
            meta: { userEmail: target.user.email },
          }),
        )
        continue
      }
      const [alreadySent] = await withTenant(db, d.tenantId, (tx) =>
        tx
          .select({ id: smsLog.id })
          .from(smsLog)
          .where(
            and(
              eq(smsLog.jobId, sourceJobId),
              eq(smsLog.recipient, phone),
              eq(smsLog.status, 'sent'),
            ),
          )
          .limit(1),
      )
      if (alreadySent) continue
      try {
        if (smsDelivery.kind !== 'transport') {
          throw new Error(
            'SMS delivery is not configured. Configure a platform or tenant SMS provider.',
          )
        }
        const sent = await sendSmsVia(smsDelivery.transport, { to: phone, body: text })
        await withTenant(db, d.tenantId, (tx) =>
          tx.insert(smsLog).values({
            tenantId: d.tenantId,
            jobId: sourceJobId,
            provider: via,
            providerMessageId: sent.id || null,
            recipient: phone,
            status: 'sent',
            categoryKey: d.category,
            body: text,
            bodyLength: text.length,
            sentAt: new Date(),
            meta: { userEmail: target.user.email },
          }),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        smsFailures.push(`${target.user.email}: ${message}`)
        await withTenant(db, d.tenantId, (tx) =>
          tx.insert(smsLog).values({
            tenantId: d.tenantId,
            jobId: sourceJobId,
            provider: via,
            recipient: phone,
            status: 'failed',
            categoryKey: d.category,
            body: text,
            bodyLength: text.length,
            errorMessage: message,
            meta: { userEmail: target.user.email },
          }),
        )
      }
    }
  }
  if (smsFailures.length > 0) {
    throw new Error(
      `SMS delivery failed for ${smsFailures.length} recipient(s): ${smsFailures.join('; ')}`,
    )
  }
}
