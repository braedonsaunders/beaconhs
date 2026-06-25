// Digest scan (Phase 2 routing). For tenants on digest mode, once at their
// configured hour (daily, or Mondays for weekly), gather each user's UNREAD
// in-app notifications from the period and send a single summary email — instead
// of one email per alert. The notify worker holds non-critical emails back when
// digest mode is on, so this is where they actually go out.

import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { notifications, tenantNotificationPolicy, tenants, users } from '@beaconhs/db/schema'
import { enqueueEmail } from '@beaconhs/jobs'

export type DigestScanResult = { tenants: number; emails: number }

export async function scanDigests(): Promise<DigestScanResult> {
  const result: DigestScanResult = { tenants: 0, emails: 0 }
  const now = new Date()
  const hour = now.getUTCHours()
  const isMonday = now.getUTCDay() === 1
  const appUrl = process.env.APP_URL ?? ''
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
      const rows = await tx
        .select({
          userId: notifications.userId,
          email: users.email,
          title: notifications.title,
          category: notifications.category,
          linkPath: notifications.linkPath,
        })
        .from(notifications)
        .innerJoin(users, eq(users.id, notifications.userId))
        .where(
          and(
            eq(notifications.tenantId, t.id),
            isNull(notifications.readAt),
            sql`${notifications.occurredAt} >= now() - ((${sinceHours})::text || ' hours')::interval`,
          ),
        )

      const byUser = new Map<string, { email: string; items: typeof rows }>()
      for (const r of rows) {
        if (!r.email) continue
        const entry = byUser.get(r.userId) ?? { email: r.email, items: [] }
        entry.items.push(r)
        byUser.set(r.userId, entry)
      }

      for (const { email, items } of byUser.values()) {
        if (items.length === 0) continue
        const list = items
          .slice(0, 50)
          .map(
            (i) =>
              `<li>${i.title}${i.linkPath ? ` — <a href="${appUrl}${i.linkPath}">open</a>` : ''}</li>`,
          )
          .join('')
        const subject = `Your ${pol.digestMode} summary — ${items.length} update${items.length === 1 ? '' : 's'}`
        await enqueueEmail({
          to: email,
          subject,
          html: `<p>${items.length} unread notification${items.length === 1 ? '' : 's'}:</p><ul>${list}</ul>`,
          text: items.map((i) => `• ${i.title}`).join('\n'),
          meta: { tenantId: t.id, category: 'digest' },
        })
        result.emails += 1
      }
    })
  }
  return result
}
