// Escalation ladder scan (Phase 2 routing). For each tenant whose `compliance`
// category defines an escalation ladder, walk the still-overdue compliance
// subjects and, once a subject has been overdue for `afterDays`, alert the
// step's roles — each step fires once per subject (deduped on the notification
// row). This is what turns "remind the owner" into "…then escalate to the
// manager after 3 days, then the safety lead after 7".

import { and, asc, eq, gt, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import {
  complianceObligations,
  complianceStatus,
  notifications,
  roleAssignments,
  roles,
  tenantNotificationSettings,
  tenantUsers,
  tenants,
} from '@beaconhs/db/schema'
import { enqueueNotification } from '@beaconhs/jobs'

type EscalationScanResult = { tenants: number; escalated: number }
const OVERDUE_PAGE_SIZE = 500

export async function scanEscalations(): Promise<EscalationScanResult> {
  const result: EscalationScanResult = { tenants: 0, escalated: 0 }
  const tenantRows = await withSuperAdmin(db, (tx) => tx.select({ id: tenants.id }).from(tenants))
  const today = new Date().toISOString().slice(0, 10)
  const todayMs = Date.parse(today)

  for (const t of tenantRows) {
    await withTenant(db, t.id, async (tx) => {
      const [cfg] = await tx
        .select({ escalation: tenantNotificationSettings.escalation })
        .from(tenantNotificationSettings)
        .where(
          and(
            eq(tenantNotificationSettings.tenantId, t.id),
            eq(tenantNotificationSettings.category, 'compliance'),
          ),
        )
        .limit(1)
      const ladder = cfg?.escalation ?? []
      if (ladder.length === 0) return
      result.tenants += 1

      const roleAudienceCache = new Map<string, string[]>()
      let cursor: { obligationId: string; subjectKey: string } | undefined
      while (true) {
        const overdue = await tx
          .select({
            obligationId: complianceStatus.obligationId,
            subjectKey: complianceStatus.subjectKey,
            dueOn: complianceStatus.dueOn,
            title: complianceObligations.title,
          })
          .from(complianceStatus)
          .innerJoin(
            complianceObligations,
            and(
              eq(complianceObligations.id, complianceStatus.obligationId),
              eq(complianceObligations.tenantId, complianceStatus.tenantId),
            ),
          )
          .where(
            and(
              eq(complianceStatus.tenantId, t.id),
              eq(complianceStatus.status, 'overdue'),
              isNotNull(complianceStatus.dueOn),
              cursor
                ? or(
                    gt(complianceStatus.obligationId, cursor.obligationId),
                    and(
                      eq(complianceStatus.obligationId, cursor.obligationId),
                      gt(complianceStatus.subjectKey, cursor.subjectKey),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(complianceStatus.obligationId), asc(complianceStatus.subjectKey))
          .limit(OVERDUE_PAGE_SIZE)
        if (overdue.length === 0) break

        for (const r of overdue) {
          if (!r.dueOn) continue
          const daysOverdue = Math.floor((todayMs - Date.parse(r.dueOn)) / 86_400_000)
          if (!Number.isFinite(daysOverdue) || daysOverdue < 0) continue
          for (let step = 0; step < ladder.length; step++) {
            const s = ladder[step]!
            if (daysOverdue < s.afterDays || s.roleKeys.length === 0) continue

            const [seen] = await tx
              .select({ id: notifications.id })
              .from(notifications)
              .where(
                and(
                  eq(notifications.tenantId, t.id),
                  eq(notifications.type, 'compliance.escalation'),
                  sql`${notifications.data}->>'obligationId' = ${r.obligationId}`,
                  sql`${notifications.data}->>'subjectKey' = ${r.subjectKey}`,
                  sql`${notifications.data}->>'step' = ${String(step)}`,
                ),
              )
              .limit(1)
            if (seen) continue

            const roleKeys = [...new Set(s.roleKeys)].sort()
            const audienceKey = roleKeys.join('\0')
            let userIds = roleAudienceCache.get(audienceKey)
            if (!userIds) {
              const members = await tx
                .select({ userId: tenantUsers.userId })
                .from(tenantUsers)
                .innerJoin(
                  roleAssignments,
                  and(
                    eq(roleAssignments.tenantId, tenantUsers.tenantId),
                    eq(roleAssignments.tenantUserId, tenantUsers.id),
                  ),
                )
                .innerJoin(
                  roles,
                  and(
                    eq(roles.tenantId, roleAssignments.tenantId),
                    eq(roles.id, roleAssignments.roleId),
                  ),
                )
                .where(
                  and(
                    eq(tenantUsers.tenantId, t.id),
                    eq(tenantUsers.status, 'active'),
                    inArray(roles.key, roleKeys),
                  ),
                )
              userIds = [
                ...new Set(members.map((member) => member.userId).filter(Boolean)),
              ] as string[]
              roleAudienceCache.set(audienceKey, userIds)
            }
            if (userIds.length === 0) continue

            const jobId = `compliance-escalation|${createHash('sha256')
              .update(`${t.id}\0${r.obligationId}\0${r.subjectKey}\0${step}`)
              .digest('hex')}`
            await enqueueNotification(
              {
                tenantId: t.id,
                userIds,
                category: 'compliance',
                type: 'compliance.escalation',
                title: `Escalation: ${r.title} overdue ${daysOverdue}d`.slice(0, 500),
                body: `Overdue ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} — escalated to ${roleKeys.join(', ')}.`.slice(
                  0,
                  20_000,
                ),
                linkPath: `/compliance/obligations/${r.obligationId}`,
                data: { obligationId: r.obligationId, subjectKey: r.subjectKey, step, daysOverdue },
                isCritical: daysOverdue >= 14,
              },
              { jobId },
            )
            result.escalated += 1
          }
        }
        const last = overdue.at(-1)!
        cursor = { obligationId: last.obligationId, subjectKey: last.subjectKey }
        if (overdue.length < OVERDUE_PAGE_SIZE) break
      }
    })
  }
  return result
}
