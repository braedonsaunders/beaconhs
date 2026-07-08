// Scheduled flow execution (Phase 4). Closes the long-standing gap where the
// `scheduled` flow trigger was authorable in the canvas but never ran. Every
// minute we walk enabled automations and fire the ones whose `scheduled` cron
// has an occurrence since the flow last ran (anchored on `lastScheduledRunAt`,
// not on wall-clock minute matching — so a late tick, a queue-retry, or worker
// downtime never silently skips a flow; missed occurrences fast-forward to a
// single catch-up run). Actions are the worker-safe subset (notify_role /
// send_email) — the same execution surface the session-overdue scan uses.

import { and, eq } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { formAutomations, tenants } from '@beaconhs/db/schema'
import { planAutomation } from '@beaconhs/forms-core'
import { enqueueEmail, enqueueNotification } from '@beaconhs/jobs'
import { interpolate, resolveEmails, roleUserIds } from './session-overdue-flows'
import { lastCronOccurrenceBetween, parseCron, type CronFields } from './form-assignment-scanner'
import { renderEmail } from '@beaconhs/email-render'

export type ScheduledFlowScanResult = { flows: number; ran: number }

export async function scanScheduledFlows(): Promise<ScheduledFlowScanResult> {
  const result: ScheduledFlowScanResult = { flows: 0, ran: 0 }
  const now = new Date()
  const tenantRows = await withSuperAdmin(db, (tx) => tx.select({ id: tenants.id }).from(tenants))

  for (const t of tenantRows) {
    await withTenant(db, t.id, async (tx) => {
      const flows = await tx
        .select({
          id: formAutomations.id,
          graph: formAutomations.graph,
          lastRunAt: formAutomations.lastScheduledRunAt,
          createdAt: formAutomations.createdAt,
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
        } catch (err) {
          console.warn(
            `[scheduled_flow] tenant ${t.id} flow ${flow.id}: bad cron — ${err instanceof Error ? err.message : err}`,
          )
          continue
        }
        // Due when the cron has an occurrence since the last run (fast-forwarded
        // to at most one catch-up fire); a never-run flow anchors on creation.
        const anchor = flow.lastRunAt ?? flow.createdAt
        if (!lastCronOccurrenceBetween(cron, anchor, now)) continue
        result.flows += 1

        try {
          const plan = planAutomation(flow.graph, 'scheduled', {
            values: {},
            rows: {},
            entities: {},
          })
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
                  const rendered = renderEmail(
                    {
                      mode: 'inline',
                      subject: action.subject || 'Scheduled automation',
                      bodyTemplate: action.bodyTemplate ?? '',
                    },
                    {},
                  )
                  await enqueueEmail({
                    to,
                    subject: rendered.subject,
                    text: rendered.text,
                    html: rendered.html,
                    meta: { tenantId: t.id, category: 'automation' },
                  })
                  result.ran += 1
                }
              }
              // CAPA / incident / webhook actions need web-side primitives and
              // are intentionally skipped in the worker path.
            } catch (err) {
              // Guarded — one bad action never blocks the rest, but a flow that
              // consistently fails must be visible in the worker logs.
              console.warn(
                `[scheduled_flow] tenant ${t.id} flow ${flow.id}: ${action.action} action failed — ${err instanceof Error ? err.message : err}`,
              )
            }
          }
        } catch (err) {
          console.warn(
            `[scheduled_flow] tenant ${t.id} flow ${flow.id}: bad graph / plan — ${err instanceof Error ? err.message : err}`,
          )
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
