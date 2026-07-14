// Digest scan (Phase 2 routing). For tenants on digest mode, once at their
// configured hour (daily, or Mondays for weekly), gather each user's UNREAD
// in-app notifications from the period and send a single summary email — instead
// of one email per alert. The notify worker holds non-critical emails back when
// digest mode is on, so this is where they actually go out.

import { and, asc, count, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import {
  notifications,
  tenantNotificationPolicy,
  tenants,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { enqueueEmail } from '@beaconhs/jobs'
import { appBaseUrl } from './app-base-url'
import { escapeHtml } from './escape-html'

type DigestScanResult = { tenants: number; emails: number }
const RECIPIENT_PAGE_SIZE = 200
const MAX_ITEMS_PER_DIGEST = 50

export async function scanDigests(scheduledFor: Date = new Date()): Promise<DigestScanResult> {
  const result: DigestScanResult = { tenants: 0, emails: 0 }
  const now = scheduledFor
  const hour = now.getUTCHours()
  const isMonday = now.getUTCDay() === 1
  const appUrl = appBaseUrl()
  const tenantRows = await withSuperAdmin(db, (tx) => tx.select({ id: tenants.id }).from(tenants))

  for (const t of tenantRows) {
    await withTenant(db, t.id, async (tx) => {
      const [pol] = await tx
        .select({
          digestMode: tenantNotificationPolicy.digestMode,
          digestHourUtc: tenantNotificationPolicy.digestHourUtc,
        })
        .from(tenantNotificationPolicy)
        .where(eq(tenantNotificationPolicy.tenantId, t.id))
        .limit(1)
      if (!pol || pol.digestMode === 'off' || pol.digestHourUtc !== hour) return
      if (pol.digestMode === 'weekly' && !isMonday) return
      result.tenants += 1

      const sinceHours = pol.digestMode === 'weekly' ? 168 : 24
      const windowEnd = now
      const windowStart = new Date(windowEnd.getTime() - sinceHours * 60 * 60 * 1_000)
      let afterUserId: string | undefined
      while (true) {
        const recipients = await tx
          .select({
            userId: notifications.userId,
            email: users.email,
            total: count(notifications.id),
          })
          .from(notifications)
          .innerJoin(
            tenantUsers,
            and(
              eq(tenantUsers.tenantId, notifications.tenantId),
              eq(tenantUsers.userId, notifications.userId),
              eq(tenantUsers.status, 'active'),
            ),
          )
          .innerJoin(users, eq(users.id, notifications.userId))
          .where(
            and(
              eq(notifications.tenantId, t.id),
              isNull(notifications.readAt),
              sql`${notifications.occurredAt} >= ${windowStart}`,
              lte(notifications.occurredAt, windowEnd),
              afterUserId ? gt(notifications.userId, afterUserId) : undefined,
            ),
          )
          .groupBy(notifications.userId, users.email)
          .orderBy(asc(notifications.userId))
          .limit(RECIPIENT_PAGE_SIZE)
        if (recipients.length === 0) break

        const recipientIds = recipients.map((recipient) => recipient.userId)
        const ranked = tx
          .select({
            userId: notifications.userId,
            title: notifications.title,
            linkPath: notifications.linkPath,
            rank: sql<number>`row_number() over (
              partition by ${notifications.userId}
              order by ${notifications.occurredAt} desc, ${notifications.id} desc
            )`.as('digest_rank'),
          })
          .from(notifications)
          .where(
            and(
              eq(notifications.tenantId, t.id),
              inArray(notifications.userId, recipientIds),
              isNull(notifications.readAt),
              sql`${notifications.occurredAt} >= ${windowStart}`,
              lte(notifications.occurredAt, windowEnd),
            ),
          )
          .as('ranked_digest_notifications')
        const itemRows = await tx
          .select({
            userId: ranked.userId,
            title: ranked.title,
            linkPath: ranked.linkPath,
          })
          .from(ranked)
          .where(lte(ranked.rank, MAX_ITEMS_PER_DIGEST))
          .orderBy(asc(ranked.userId), asc(ranked.rank))
        const byUser = new Map<string, typeof itemRows>()
        for (const item of itemRows) {
          const items = byUser.get(item.userId) ?? []
          items.push(item)
          byUser.set(item.userId, items)
        }

        for (const { userId, email, total } of recipients) {
          const items = byUser.get(userId) ?? []
          if (items.length === 0) continue
          const list = items
            .map(
              (i) =>
                `<li>${escapeHtml(i.title)}${i.linkPath ? ` — <a href="${escapeHtml(`${appUrl}${i.linkPath}`)}">open</a>` : ''}</li>`,
            )
            .join('')
          const subject = `Your ${pol.digestMode} summary — ${total} update${total === 1 ? '' : 's'}`
          const period = `${pol.digestMode}|${now.toISOString().slice(0, 13)}`
          const jobId = `digest-email|${createHash('sha256')
            .update(`${t.id}\0${email.toLowerCase()}\0${period}`)
            .digest('hex')}`
          const omitted = total - items.length
          const moreHtml = omitted > 0 ? `<p>Showing the newest ${items.length} updates.</p>` : ''
          const moreText = omitted > 0 ? `\nShowing the newest ${items.length} updates.` : ''
          await enqueueEmail(
            {
              to: email,
              subject,
              html: `<p>${total} unread notification${total === 1 ? '' : 's'}:</p>${moreHtml}<ul>${list}</ul>`,
              text: `${items.map((i) => `• ${i.title}`).join('\n')}${moreText}`,
              meta: { tenantId: t.id, category: 'digest' },
            },
            { jobId },
          )
          result.emails += 1
        }

        afterUserId = recipients.at(-1)!.userId
        if (recipients.length < RECIPIENT_PAGE_SIZE) break
      }
    })
  }
  return result
}
