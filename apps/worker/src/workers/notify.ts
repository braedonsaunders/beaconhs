import type { Job } from 'bullmq'
import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
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
import {
  enqueueEmail,
  enqueuePush,
  normalizeNotifyJobData,
  type NotifyJobData,
} from '@beaconhs/jobs'
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
  const d = normalizeNotifyJobData(job.data)
  const sourceJobId = String(job.id ?? '')
  if (!sourceJobId || sourceJobId.length > 512 || /[\u0000-\u001f\u007f]/.test(sourceJobId)) {
    throw new Error('Notification worker requires a valid durable BullMQ job id')
  }
  const critical = d.isCritical ?? false
  const requestedUserIds = d.userIds
  const plan = await withTenant(db, d.tenantId, async (tx) => {
    const [catCfg] = await tx
      .select({
        enabled: tenantNotificationSettings.enabled,
        channels: tenantNotificationSettings.channels,
      })
      .from(tenantNotificationSettings)
      .where(
        and(
          eq(tenantNotificationSettings.tenantId, d.tenantId),
          eq(tenantNotificationSettings.category, d.category),
        ),
      )
      .limit(1)
    if (catCfg?.enabled === false) return { disabled: true as const }
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
            .select({ id: users.id, email: users.email })
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
    const targetUserIds = targets.map((target) => target.id)

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
    if (targetUserIds.length > 0) {
      await tx
        .insert(notifications)
        .values(
          targetUserIds.map((userId) => ({
            tenantId: d.tenantId,
            userId,
            category: d.category,
            type: d.type,
            title: d.title,
            body: d.body,
            linkPath: d.linkPath,
            data: d.data ?? {},
            isCritical: d.isCritical ?? false,
            sourceJobId,
          })),
        )
        .onConflictDoNothing({
          target: [notifications.tenantId, notifications.sourceJobId, notifications.userId],
        })
    }
    const subscriptions =
      pushAllowed && targetUserIds.length > 0
        ? await tx
            .select({ id: webpushSubscriptions.id, userId: webpushSubscriptions.userId })
            .from(webpushSubscriptions)
            .where(
              and(
                eq(webpushSubscriptions.tenantId, d.tenantId),
                inArray(webpushSubscriptions.userId, targetUserIds),
              ),
            )
        : []
    return {
      disabled: false as const,
      targets,
      prefRows,
      emailAllowed,
      emailDelayMs,
      pushAllowed,
      smsAllowed,
      subscriptions,
    }
  })
  if (plan.disabled) return

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
    if (!plan.emailAllowed || !channelEnabled(target.id, 'email')) continue
    await enqueueEmail(
      {
        to: target.email,
        subject: d.title,
        html: `<p>${escapeHtml(d.body ?? d.title)}</p>${d.linkPath ? `<p><a href="${escapeHtml(`${baseUrl}${d.linkPath}`)}">Open in app</a></p>` : ''}`,
        text: `${d.body ?? d.title}${d.linkPath ? `\n${baseUrl}${d.linkPath}` : ''}`,
        meta: {
          tenantId: d.tenantId,
          userId: target.id,
          category: d.category,
          automaticNotification: true,
        },
      },
      {
        ...(plan.emailDelayMs > 0 ? { delay: plan.emailDelayMs } : {}),
        jobId: `notification-email|${createHash('sha256')
          .update(`${d.tenantId}\0${sourceJobId}\0${target.id}`)
          .digest('hex')}`,
      },
    )
  }

  // Push has its own retry queue. One dead endpoint cannot replay in-app,
  // email, or SMS delivery.
  if (plan.pushAllowed) {
    const subscriptionsByUser = new Map<string, typeof plan.subscriptions>()
    for (const subscription of plan.subscriptions) {
      const subscriptions = subscriptionsByUser.get(subscription.userId) ?? []
      subscriptions.push(subscription)
      subscriptionsByUser.set(subscription.userId, subscriptions)
    }
    for (const target of plan.targets) {
      if (!channelEnabled(target.id, 'push')) continue
      const subscriptions = subscriptionsByUser.get(target.id) ?? []
      for (const subscription of subscriptions) {
        const pushJobId = `notification-push|${createHash('sha256')
          .update(`${d.tenantId}\0${sourceJobId}\0${subscription.id}`)
          .digest('hex')}`
        await enqueuePush(
          {
            tenantId: d.tenantId,
            userId: target.id,
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

  let smsFailureCount = 0
  if (smsDelivery && plan.targets.length > 0) {
    const via = smsDelivery.kind === 'transport' ? smsDelivery.transport.provider : 'unconfigured'
    const text = (d.body ? `${d.title}\n${d.body}` : d.title).slice(0, 1500)
    const [phoneRows, priorRows] = await Promise.all([
      withTenant(db, d.tenantId, (tx) =>
        tx
          .select({ userId: people.userId, phone: people.phone })
          .from(people)
          .where(
            and(
              eq(people.tenantId, d.tenantId),
              inArray(
                people.userId,
                plan.targets.map((target) => target.id),
              ),
              isNull(people.deletedAt),
            ),
          ),
      ),
      withTenant(db, d.tenantId, (tx) =>
        tx
          .select({ recipient: smsLog.recipient, status: smsLog.status, meta: smsLog.meta })
          .from(smsLog)
          .where(eq(smsLog.jobId, sourceJobId)),
      ),
    ])
    const phoneByUser = new Map(phoneRows.map((row) => [row.userId, row.phone]))
    const sentRecipients = new Set(
      priorRows
        .filter((row) => row.status === 'sent' && row.recipient)
        .map((row) => row.recipient!),
    )
    const skippedUsers = new Set(
      priorRows
        .filter((row) => row.status === 'skipped')
        .map((row) => (row.meta as { userEmail?: unknown } | null)?.userEmail)
        .filter((email): email is string => typeof email === 'string'),
    )
    for (const target of plan.targets) {
      if (!channelEnabled(target.id, 'sms')) continue
      const phone = phoneByUser.get(target.id)?.trim()
      if (!phone) {
        if (skippedUsers.has(target.email)) continue
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
            meta: { userEmail: target.email },
          }),
        )
        continue
      }
      if (sentRecipients.has(phone)) continue
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
            meta: { userEmail: target.email },
          }),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        smsFailureCount += 1
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
            meta: { userEmail: target.email },
          }),
        )
      }
    }
  }
  if (smsFailureCount > 0) {
    throw new Error(`SMS delivery failed for ${smsFailureCount} recipient(s); see the SMS log`)
  }
}
