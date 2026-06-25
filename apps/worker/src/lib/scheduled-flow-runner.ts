// Scheduled flow execution (Phase 4). Closes the long-standing gap where the
// `scheduled` flow trigger was authorable in the canvas but never ran. Every
// minute we walk enabled automations, find the ones whose `scheduled` cron
// matches this minute, and run their worker-safe actions (notify_role /
// send_email) — the same execution surface the session-overdue scan uses.
// Per-flow `lastScheduledRunAt` dedups so a cron fires once per matching minute.

import { and, eq } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { formAutomations, tenants } from '@beaconhs/db/schema'
import { planAutomation } from '@beaconhs/forms-core'
import { enqueueEmail, enqueueNotification } from '@beaconhs/jobs'
import { interpolate, resolveEmails, roleUserIds } from './session-overdue-flows'
import { parseCron, type CronFields } from './form-assignment-scanner'

export type ScheduledFlowScanResult = { flows: number; ran: number }

function cronMatchesMinute(c: CronFields, d: Date): boolean {
  return (
    c.minute.includes(d.getUTCMinutes()) &&
    c.hour.includes(d.getUTCHours()) &&
    c.dayOfMonth.includes(d.getUTCDate()) &&
    c.dayOfWeek.includes(d.getUTCDay()) &&
    c.month.includes(d.getUTCMonth() + 1)
  )
}

export async function scanScheduledFlows(): Promise<ScheduledFlowScanResult> {
  const result: ScheduledFlowScanResult = { flows: 0, ran: 0 }
  const now = new Date()
  const minuteStart = new Date(now)
  minuteStart.setUTCSeconds(0, 0)
  const tenantRows = await withSuperAdmin(db, (tx) => tx.select({ id: tenants.id }).from(tenants))

  for (const t of tenantRows) {
    await withTenant(db, t.id, async (tx) => {
      const flows = await tx
        .select({
          id: formAutomations.id,
          graph: formAutomations.graph,
          lastRunAt: formAutomations.lastScheduledRunAt,
        })
        .from(formAutomations)
        .where(and(eq(formAutomations.tenantId, t.id), eq(formAutomations.enabled, true)))

      for (const flow of flows) {
        const node = flow.graph?.nodes?.find(
          (n) => n.data.kind === 'trigger' && n.data.trigger.trigger === 'scheduled',
        )
        if (!node || node.data.kind !== 'trigger' || node.data.trigger.trigger !== 'scheduled') {
          continue
        }
        let cron: CronFields
        try {
          cron = parseCron(node.data.trigger.cron)
        } catch {
          continue
        }
        if (!cronMatchesMinute(cron, now)) continue
        if (flow.lastRunAt && flow.lastRunAt >= minuteStart) continue // already fired this minute
        result.flows += 1

        try {
          const plan = planAutomation(flow.graph, 'scheduled', { values: {}, rows: {}, entities: {} })
          for (const action of plan.actions) {
            try {
              if (action.action === 'notify_role') {
                const recipients = await roleUserIds(tx, t.id, action.role)
                const userIds = recipients.map((r: { userId: string }) => r.userId)
                if (userIds.length > 0) {
                  await enqueueNotification({
                    tenantId: t.id,
                    userIds,
                    category: 'automation',
                    type: 'flow.scheduled',
                    title: interpolate(action.message, {}) || 'Scheduled automation',
                    channels: action.channel === 'email' ? ['in_app', 'email'] : ['in_app'],
                  })
                  result.ran += 1
                }
              } else if (action.action === 'send_email') {
                const to = await resolveEmails(tx, t.id, action.to, null, {})
                if (to.length > 0) {
                  const body = interpolate(action.bodyTemplate ?? '', {})
                  await enqueueEmail({
                    to,
                    subject: interpolate(action.subject ?? '', {}) || 'Scheduled automation',
                    text: body,
                    html: `<div style="font-family:system-ui,Arial,sans-serif;white-space:pre-wrap">${body}</div>`,
                    meta: { tenantId: t.id, category: 'automation' },
                  })
                  result.ran += 1
                }
              }
              // CAPA / incident / webhook actions need web-side primitives and
              // are intentionally skipped in the worker path.
            } catch {
              /* guarded — one bad action never blocks the rest */
            }
          }
        } catch {
          /* bad graph / plan — skip */
        }

        await tx
          .update(formAutomations)
          .set({ lastScheduledRunAt: now })
          .where(eq(formAutomations.id, flow.id))
      }
    })
  }
  return result
}
