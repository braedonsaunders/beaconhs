import 'server-only'

// Fire a native module's Flows at a lifecycle event (on_create / on_submit /
// status_change / on_sign / on_lock / …). Loads the module's enabled flows,
// builds its adapter, plans each graph, and dispatches through the shared
// executor. This runs only for a durable worker-to-web domain command; failures
// throw so the outbox retries instead of silently losing configured actions.

import { and, eq } from 'drizzle-orm'
import { planAutomation, type AutomationPlan, type TriggerData } from '@beaconhs/forms-core'
import { formAutomations } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { executeFlowPlan } from './execute-flow-plan'
import { buildFlowAdapter } from './registry'

export async function executeModuleFlowsNow(
  ctx: RequestContext,
  args: {
    moduleKey: string
    event: TriggerData['trigger']
    subjectId: string
    toStatus?: string
  },
  executionId?: string,
): Promise<{ ran: string[]; failed: string[] }> {
  if (!ctx.tenantId) return { ran: [], failed: [] }
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
  if (flows.length === 0) return { ran: [], failed: [] }

  const adapter = buildFlowAdapter(ctx, 'module', args.moduleKey, args.subjectId)
  if (!adapter) return { ran: [], failed: [] }
  const values = await adapter.loadValues()

  const ran: string[] = []
  const failed: string[] = []
  let hadWork = false
  for (const flow of flows) {
    const plan: AutomationPlan = planAutomation(
      flow.graph,
      args.event,
      { values, rows: {}, entities: {} },
      args.event === 'status_change' ? { toStatus: args.toStatus } : undefined,
    )
    if (plan.actions.length === 0 && plan.gates.length === 0) continue
    hadWork = true
    const res = await executeFlowPlan(ctx, adapter, {
      flowId: flow.id,
      plan,
      values: { ...values },
      executionId,
    })
    ran.push(...res.ran)
    failed.push(...res.failed)
  }

  if (failed.length > 0) {
    throw new Error(`Flow actions failed: ${failed.join(', ')}`)
  }
  if (hadWork) {
    await recordAudit(ctx, {
      entityType: adapter.auditEntityType,
      entityId: args.subjectId,
      action: 'update',
      dedupKey: executionId ? `domain:${executionId}:module-flow` : undefined,
      summary: `Flows (${args.event}${args.toStatus ? `→${args.toStatus}` : ''}): durable execution completed`,
    })
  }
  return { ran, failed }
}
