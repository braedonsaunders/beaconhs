import 'server-only'

// Fire a native module's Flows at a lifecycle event (on_create / on_submit /
// status_change / on_sign / on_lock / …). Loads the module's enabled flows,
// builds its adapter, plans each graph, and dispatches through the shared
// executor. Fully guarded — a Flow must NEVER break a module save.

import { and, eq } from 'drizzle-orm'
import { planAutomation, type AutomationPlan, type TriggerData } from '@beaconhs/forms-core'
import { formAutomations } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { executeFlowPlan } from './execute-flow-plan'
import { buildFlowAdapter } from './registry'

export async function runModuleFlows(
  ctx: RequestContext,
  args: {
    moduleKey: string
    event: TriggerData['trigger']
    subjectId: string
    toStatus?: string
  },
): Promise<void> {
  try {
    if (!ctx.tenantId) return
    const flows = await ctx.db((tx) =>
      tx
        .select({ id: formAutomations.id, graph: formAutomations.graph })
        .from(formAutomations)
        .where(
          and(
            eq(formAutomations.subjectType, 'module'),
            eq(formAutomations.subjectKey, args.moduleKey),
            eq(formAutomations.enabled, true),
          ),
        ),
    )
    if (flows.length === 0) return

    const adapter = buildFlowAdapter(ctx, 'module', args.moduleKey, args.subjectId)
    if (!adapter) return
    const values = await adapter.loadValues()

    const ran: string[] = []
    const failed: string[] = []
    for (const flow of flows) {
      // For status_change, only fire flows whose trigger.to matches.
      if (args.event === 'status_change') {
        const trig = flow.graph.nodes.find(
          (n) => n.data.kind === 'trigger' && n.data.trigger.trigger === 'status_change',
        )
        if (!trig || trig.data.kind !== 'trigger') continue
        const td = trig.data.trigger
        if (td.trigger !== 'status_change' || td.to !== args.toStatus) continue
      }
      let plan: AutomationPlan
      try {
        plan = planAutomation(flow.graph, args.event, { values, rows: {}, entities: {} })
      } catch {
        continue
      }
      if (plan.actions.length === 0 && plan.gates.length === 0) continue
      const res = await executeFlowPlan(ctx, adapter, {
        flowId: flow.id,
        plan,
        values: { ...values },
      })
      ran.push(...res.ran)
      failed.push(...res.failed)
    }

    if (ran.length > 0 || failed.length > 0) {
      await recordAudit(ctx, {
        entityType: adapter.auditEntityType,
        entityId: args.subjectId,
        action: 'update',
        summary: `Flows (${args.event}${args.toStatus ? `→${args.toStatus}` : ''}): ${
          ran.length ? `ran ${ran.join(', ')}` : 'no actions ran'
        }${failed.length ? ` · issues ${failed.join(', ')}` : ''}`,
      })
    }
  } catch {
    // Never let a flow failure break the module action.
  }
}
