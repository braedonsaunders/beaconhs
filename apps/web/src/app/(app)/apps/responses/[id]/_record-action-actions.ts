'use server'

// Run a CONFIGURABLE record-action button. Each button is a `manual`-trigger
// Flow stored in form_automations (authored in the designer's Actions tab /
// flows canvas). Clicking it plans that flow from its manual trigger and runs it
// through the SAME subject-agnostic executor used by on-submit/status flows — so
// a button can be a single action (Create CAPA) or a whole graph with
// conditions + approval gates. No second automation system.

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { planAutomation, type AutomationPlan } from '@beaconhs/forms-core'
import { formAutomations } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { executeFlowPlan } from '@/app/(app)/apps/_lib/run-automations'
import { createFormFlowAdapter } from '@/app/(app)/apps/_lib/form-flow-adapter'

export async function runRecordAction(input: {
  responseId: string
  flowId: string
  buttonId: string
  // Optional values collected from the button's input drawer, merged over the
  // record's field-map before planning (so {{token}}s can reference them).
  inputs?: Record<string, unknown>
}): Promise<{ ok: boolean; ran?: string[]; failed?: string[]; error?: string }> {
  const ctx = await requireRequestContext()
  try {
    const [flow] = await ctx.db((tx) =>
      tx
        .select({
          id: formAutomations.id,
          graph: formAutomations.graph,
          enabled: formAutomations.enabled,
        })
        .from(formAutomations)
        .where(
          and(eq(formAutomations.id, input.flowId), eq(formAutomations.tenantId, ctx.tenantId)),
        )
        .limit(1),
    )
    if (!flow) return { ok: false, error: 'Action not found' }
    if (!flow.enabled) return { ok: false, error: 'This action is disabled' }

    // Re-check the button's authored permission server-side (the action bar
    // already hides it, but never trust the client).
    const node = flow.graph.nodes.find(
      (n) =>
        n.data.kind === 'trigger' &&
        n.data.trigger.trigger === 'manual' &&
        n.data.trigger.buttonId === input.buttonId,
    )
    if (node && node.data.kind === 'trigger' && node.data.trigger.trigger === 'manual') {
      const td = node.data.trigger
      if (td.requirePermission && !can(ctx, td.requirePermission)) {
        return { ok: false, error: 'You do not have permission to run this action' }
      }
    }

    const adapter = createFormFlowAdapter(ctx, input.responseId)
    const values: Record<string, unknown> = {
      ...(await adapter.loadValues()),
      ...(input.inputs ?? {}),
    }

    let plan: AutomationPlan
    try {
      plan = planAutomation(
        flow.graph,
        'manual',
        { values, rows: {}, entities: {} },
        {
          buttonId: input.buttonId,
        },
      )
    } catch {
      return { ok: false, error: 'Could not plan this action' }
    }
    if (plan.actions.length === 0 && plan.gates.length === 0) {
      return { ok: false, error: 'This action has no steps configured' }
    }

    const res = await executeFlowPlan(ctx, {
      responseId: input.responseId,
      flowId: flow.id,
      plan,
      values,
    })

    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: input.responseId,
      action: 'update',
      summary: `Ran action: ${res.ran.length ? res.ran.join(', ') : 'no steps ran'}${
        res.failed.length ? ` · issues ${res.failed.join(', ')}` : ''
      }`,
    })
    revalidatePath(`/apps/responses/${input.responseId}`)
    return { ok: true, ran: res.ran, failed: res.failed }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Action failed' }
  }
}
