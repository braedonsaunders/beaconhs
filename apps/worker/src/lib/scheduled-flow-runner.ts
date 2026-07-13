// Scheduled flow execution (Phase 4). Closes the long-standing gap where the
// `scheduled` flow trigger was authorable in the canvas but never ran. Every
// minute we walk enabled automations and fire the ones whose `scheduled` cron
// has an occurrence since the flow last ran (anchored on `lastScheduledRunAt`,
// not on wall-clock minute matching — so a late tick, a queue-retry, or worker
// downtime never silently skips a flow; missed occurrences fast-forward to a
// single catch-up run). Actions are the worker-safe subset (notify_role /
// send_email) — the same execution surface the session-overdue scan uses.

import { and, eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { formAutomations, tenants } from '@beaconhs/db/schema'
import { planAutomation } from '@beaconhs/forms-core'
import { enqueueEmail, enqueueNotification } from '@beaconhs/jobs'
import { interpolate, resolveEmails, roleUserIds } from './session-overdue-flows'
import { lastCronOccurrenceBetween, parseCron, type CronFields } from './cron'
import { renderEmail } from '@beaconhs/email-render'

type ScheduledFlowScanResult = { flows: number; ran: number; errors: number }

export async function scanScheduledFlows(): Promise<ScheduledFlowScanResult> {
  const result: ScheduledFlowScanResult = { flows: 0, ran: 0, errors: 0 }
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
        const nodes = flow.graph?.nodes?.filter(
          (n) => n.data.kind === 'trigger' && n.data.trigger.trigger === 'scheduled',
        )
        if (!nodes?.length) continue
        const anchor = flow.lastRunAt ?? flow.createdAt
        const dueNodes: { id: string; occurrence: Date }[] = []
        let invalidCron = false
        for (const node of nodes) {
          if (node.data.kind !== 'trigger' || node.data.trigger.trigger !== 'scheduled') continue
          let cron: CronFields
          try {
            cron = parseCron(node.data.trigger.cron)
          } catch (error) {
            invalidCron = true
            result.errors += 1
            console.warn(
              `[scheduled_flow] tenant ${t.id} flow ${flow.id}: bad cron on ${node.id} — ${error instanceof Error ? error.message : error}`,
            )
            continue
          }
          const occurrence = lastCronOccurrenceBetween(
            cron,
            anchor,
            now,
            node.data.trigger.tz ?? 'UTC',
          )
          if (occurrence) dueNodes.push({ id: node.id, occurrence })
        }
        // A malformed schedule is not acknowledged; fixing it must preserve the
        // missed occurrence rather than silently moving the shared cursor.
        if (invalidCron || dueNodes.length === 0) continue
        result.flows += 1

        try {
          const plan = planAutomation(
            flow.graph,
            'scheduled',
            {
              values: {},
              rows: {},
              entities: {},
            },
            {
              triggerNodeIds: dueNodes.map((item) => item.id),
            },
          )
          if (plan.gates.length > 0) {
            throw new Error('Scheduled flows cannot enter a human approval gate')
          }
          const batchKey = dueNodes
            .map((item) => `${item.id}@${item.occurrence.toISOString()}`)
            .sort()
            .join('|')
          for (const [index, action] of plan.actions.entries()) {
            const jobSuffix = createHash('sha256')
              .update(`${flow.id}\0${batchKey}\0${index}`)
              .digest('hex')
            if (action.action === 'notify_role') {
              const recipients = await roleUserIds(tx, t.id, action.role)
              const userIds = recipients.map((r: { userId: string }) => r.userId)
              if (userIds.length > 0) {
                await enqueueNotification(
                  {
                    tenantId: t.id,
                    userIds,
                    category: 'automation',
                    type: 'flow.scheduled',
                    title: interpolate(action.message, {}) || 'Scheduled automation',
                    channels: action.channel === 'email' ? ['in_app', 'email'] : ['in_app'],
                  },
                  { jobId: `scheduled-flow-notify|${jobSuffix}` },
                )
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
                await enqueueEmail(
                  {
                    to,
                    subject: rendered.subject,
                    text: rendered.text,
                    html: rendered.html,
                    meta: { tenantId: t.id, category: 'automation' },
                  },
                  { jobId: `scheduled-flow-email|${jobSuffix}` },
                )
                result.ran += 1
              }
            } else {
              throw new Error(
                `${action.action} is not supported for a scheduled worker flow; use notify_role or send_email`,
              )
            }
          }
          const latestOccurrence = new Date(
            Math.max(...dueNodes.map((item) => item.occurrence.getTime())),
          )
          await tx
            .update(formAutomations)
            .set({ lastScheduledRunAt: latestOccurrence })
            .where(eq(formAutomations.id, flow.id))
        } catch (err) {
          result.errors += 1
          console.warn(
            `[scheduled_flow] tenant ${t.id} flow ${flow.id}: execution failed — ${err instanceof Error ? err.message : err}`,
          )
        }
      }
    })
  }
  return result
}
