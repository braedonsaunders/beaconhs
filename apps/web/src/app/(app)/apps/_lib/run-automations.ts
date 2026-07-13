import 'server-only'

// Runtime for a TEMPLATE's Flows. Thin form-side wrapper over the shared,
// subject-agnostic executor (apps/web/src/lib/flows). Loads ALL enabled
// form_automations graphs for a template, plans each trigger (conditions against
// the submitted data + the compliance verdict), and dispatches through the
// generic executor with a FORM adapter (form-flow-adapter.ts). Fully guarded: a
// Flow must NEVER break a submit.

import { and, eq } from 'drizzle-orm'
import { planAutomation, type AutomationPlan } from '@beaconhs/forms-core'
import { formAutomations } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { executeFlowPlan as executeGenericFlowPlan } from '@/lib/flows/execute-flow-plan'
import { createFormFlowAdapter } from '@/app/(app)/apps/_lib/form-flow-adapter'

/**
 * Execute a planned Flow against a form response by building the canonical form
 * adapter and delegating to the shared executor.
 */
export async function executeFlowPlan(
  ctx: RequestContext,
  params: {
    responseId: string
    flowId: string
    plan: AutomationPlan
    values: Record<string, unknown>
    executionId?: string
  },
): Promise<{ ran: string[]; failed: string[] }> {
  const adapter = createFormFlowAdapter(ctx, params.responseId)
  return executeGenericFlowPlan(ctx, adapter, {
    flowId: params.flowId,
    plan: params.plan,
    values: params.values,
    executionId: params.executionId,
  })
}

export async function runOnSubmitAutomations(
  ctx: RequestContext,
  args: {
    templateId: string
    responseId: string
    data: Record<string, unknown>
    score: number
    status: string
  },
  executionId?: string,
): Promise<void> {
  const flows = await ctx.db((tx) =>
    tx
      .select({ id: formAutomations.id, graph: formAutomations.graph })
      .from(formAutomations)
      .where(
        and(eq(formAutomations.templateId, args.templateId), eq(formAutomations.enabled, true)),
      ),
  )
  if (flows.length === 0) return

  // Reserved keys let conditions reference the compliance verdict, e.g.
  // `compliance_score < 80`.
  const baseValues: Record<string, unknown> = {
    ...args.data,
    compliance_score: args.score,
    compliance_status: args.status,
  }

  const ran: string[] = []
  const failed: string[] = []
  let hadWork = false
  for (const flow of flows) {
    const plan: AutomationPlan = planAutomation(flow.graph, 'on_submit', {
      values: baseValues,
      rows: {},
      entities: {},
    })
    if (plan.actions.length === 0 && plan.gates.length === 0) continue
    hadWork = true
    // Each flow gets its own values copy so set_field stays flow-local.
    const res = await executeFlowPlan(ctx, {
      responseId: args.responseId,
      flowId: flow.id,
      plan,
      values: { ...baseValues },
      executionId,
    })
    ran.push(...res.ran)
    failed.push(...res.failed)
  }

  if (failed.length > 0 && executionId) {
    throw new Error(`Form flow actions failed: ${failed.join(', ')}`)
  }
  if (hadWork || failed.length > 0) {
    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: args.responseId,
      action: 'update',
      dedupKey: executionId ? `domain:${executionId}:form-submit-flow` : undefined,
      summary: executionId
        ? 'Flows: durable on-submit execution completed'
        : `Flows: ${ran.length ? `ran ${ran.join(', ')}` : 'no actions ran'}${
            failed.length ? ` · issues ${failed.join(', ')}` : ''
          }`,
    })
  }
}

/**
 * Fire flows whose trigger is `status_change` and whose target status matches
 * `toStatus`. Called from the workflow sign/advance/reject actions. Guarded.
 */
export async function runStatusChangeAutomations(
  ctx: RequestContext,
  args: {
    templateId: string
    responseId: string
    data: Record<string, unknown>
    score: number | null
    status: string | null
    toStatus: string
  },
  executionId?: string,
): Promise<void> {
  const flows = await ctx.db((tx) =>
    tx
      .select({ id: formAutomations.id, graph: formAutomations.graph })
      .from(formAutomations)
      .where(
        and(eq(formAutomations.templateId, args.templateId), eq(formAutomations.enabled, true)),
      ),
  )
  if (flows.length === 0) return

  const baseValues: Record<string, unknown> = {
    ...args.data,
    compliance_score: args.score,
    compliance_status: args.status,
  }

  const ran: string[] = []
  const failed: string[] = []
  let hadWork = false
  for (const flow of flows) {
    const trig = flow.graph.nodes.find(
      (n) => n.data.kind === 'trigger' && n.data.trigger.trigger === 'status_change',
    )
    if (!trig || trig.data.kind !== 'trigger') continue
    const td = trig.data.trigger
    if (td.trigger !== 'status_change' || td.to !== args.toStatus) continue

    const plan: AutomationPlan = planAutomation(flow.graph, 'status_change', {
      values: baseValues,
      rows: {},
      entities: {},
    })
    if (plan.actions.length === 0 && plan.gates.length === 0) continue
    hadWork = true
    const res = await executeFlowPlan(ctx, {
      responseId: args.responseId,
      flowId: flow.id,
      plan,
      values: { ...baseValues },
      executionId,
    })
    ran.push(...res.ran)
    failed.push(...res.failed)
  }

  if (failed.length > 0 && executionId) {
    throw new Error(`Form status flow actions failed: ${failed.join(', ')}`)
  }
  if (hadWork || failed.length > 0) {
    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: args.responseId,
      action: 'update',
      dedupKey: executionId ? `domain:${executionId}:form-status-flow` : undefined,
      summary: executionId
        ? `Flows (status→${args.toStatus}): durable execution completed`
        : `Flows (status→${args.toStatus}): ${
            ran.length ? `ran ${ran.join(', ')}` : 'no actions ran'
          }${failed.length ? ` · issues ${failed.join(', ')}` : ''}`,
    })
  }
}
