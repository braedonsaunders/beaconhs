// Escalation ladder scan (Phase 2 routing). For each tenant whose `compliance`
// category defines an escalation ladder, walk the still-overdue compliance
// subjects and, once a subject has been overdue for `afterDays`, alert the
// step's roles — each step fires once per subject (deduped on the notification
// row). This is what turns "remind the owner" into "…then escalate to the
// manager after 3 days, then the safety lead after 7".

import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
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

export type EscalationScanResult = { tenants: number; escalated: number }

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
          eq(complianceObligations.id, complianceStatus.obligationId),
        )
        .where(
          and(
            eq(complianceStatus.tenantId, t.id),
            eq(complianceStatus.status, 'overdue'),
            isNotNull(complianceStatus.dueOn),
          ),
        )

      for (const r of overdue) {
        if (!r.dueOn) continue
        const daysOverdue = Math.floor((todayMs - Date.parse(r.dueOn)) / 86_400_000)
        for (let step = 0; step < ladder.length; step++) {
          const s = ladder[step]!
          if (daysOverdue < s.afterDays || s.roleKeys.length === 0) continue

          const [seen] = await tx
            .select({ id: notifications.id })
            .from(notifications)
            .where(
              and(
                eq(notifications.type, 'compliance.escalation'),
                sql`${notifications.data}->>'obligationId' = ${r.obligationId}`,
                sql`${notifications.data}->>'subjectKey' = ${r.subjectKey}`,
                sql`(${notifications.data}->>'step')::int = ${step}`,
              ),
            )
            .limit(1)
          if (seen) continue

          const members = await tx
            .select({ userId: tenantUsers.userId })
            .from(tenantUsers)
            .innerJoin(roleAssignments, eq(roleAssignments.tenantUserId, tenantUsers.id))
            .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
            .where(
              and(
                eq(tenantUsers.tenantId, t.id),
                eq(tenantUsers.status, 'active'),
                inArray(roles.key, s.roleKeys),
              ),
            )
          const userIds = [...new Set(members.map((m) => m.userId).filter(Boolean))] as string[]
          if (userIds.length === 0) continue

          await enqueueNotification({
            tenantId: t.id,
            userIds,
            category: 'compliance',
            type: 'compliance.escalation',
            title: `Escalation: ${r.title} overdue ${daysOverdue}d`,
            body: `Overdue ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} — escalated to ${s.roleKeys.join(', ')}.`,
            linkPath: `/compliance/obligations/${r.obligationId}`,
            data: { obligationId: r.obligationId, subjectKey: r.subjectKey, step, daysOverdue },
            isCritical: daysOverdue >= 14,
          })
          result.escalated += 1
        }
      }
    })
  }
  return result
}
