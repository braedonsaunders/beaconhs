'use server'

// Run a manual-trigger vehicle-log Flow from the workspace toolbar. Buttons are
// authored on the 'vehicle-log' subject (/equipment/vehicle-log/flows); the
// anchor record is a truck_log_entries row in the month being viewed, and the
// flow's value map carries that whole month (see the vehicle-log adapter) — so
// "Email month PDF" style actions act on the sheet the user is looking at.
// Mirrors the Builder record-action runner: same executor, no second system.

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { evaluateLogicRule, planAutomation, type AutomationPlan } from '@beaconhs/forms-core'
import { formAutomations, truckLogEntries } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { executeFlowPlan } from '@/lib/flows/execute-flow-plan'
import { createVehicleLogFlowAdapter } from '@/lib/flows/adapters/vehicle-log'
import { isUuid } from '@/lib/list-params'

export async function runVehicleLogAction(input: {
  entryId: string
  flowId: string
  buttonId: string
}): Promise<{ ok: boolean; ran?: string[]; failed?: string[]; error?: string }> {
  const ctx = await requireRequestContext()
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      !isUuid(input.entryId) ||
      !isUuid(input.flowId) ||
      typeof input.buttonId !== 'string' ||
      input.buttonId.length === 0 ||
      input.buttonId.length > 128
    ) {
      return { ok: false, error: 'Action not found' }
    }
    if (
      !can(ctx, 'equipment.read.all') &&
      !can(ctx, 'equipment.read.site') &&
      !can(ctx, 'equipment.manage')
    ) {
      return { ok: false, error: 'Action not found' }
    }

    const [flow] = await ctx.db((tx) =>
      tx
        .select({
          id: formAutomations.id,
          subjectType: formAutomations.subjectType,
          subjectKey: formAutomations.subjectKey,
          graph: formAutomations.graph,
          enabled: formAutomations.enabled,
        })
        .from(formAutomations)
        .where(
          and(eq(formAutomations.id, input.flowId), eq(formAutomations.tenantId, ctx.tenantId)),
        )
        .limit(1),
    )
    if (!flow || flow.subjectType !== 'module' || flow.subjectKey !== 'vehicle-log') {
      return { ok: false, error: 'Action not found' }
    }
    if (!flow.enabled) return { ok: false, error: 'This action is disabled' }

    // The anchor entry must exist under the caller's tenant (RLS-scoped read —
    // this action is network-callable with arbitrary ids).
    const [entry] = await ctx.db((tx) =>
      tx
        .select({ id: truckLogEntries.id })
        .from(truckLogEntries)
        .where(eq(truckLogEntries.id, input.entryId))
        .limit(1),
    )
    if (!entry) return { ok: false, error: 'Action not found' }

    const adapter = createVehicleLogFlowAdapter(ctx, input.entryId)
    const values = await adapter.loadValues()

    // Re-check the button's authored gates server-side (never trust the client).
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
      if (td.showIf && !evaluateLogicRule(td.showIf, { values, rows: {}, entities: {} })) {
        return { ok: false, error: 'This action is not available for this record' }
      }
    }

    let plan: AutomationPlan
    try {
      plan = planAutomation(
        flow.graph,
        'manual',
        { values, rows: {}, entities: {} },
        { buttonId: input.buttonId },
      )
    } catch {
      return { ok: false, error: 'Could not plan this action' }
    }
    if (plan.actions.length === 0 && plan.gates.length === 0) {
      return { ok: false, error: 'This action has no steps configured' }
    }

    const res = await executeFlowPlan(ctx, adapter, {
      flowId: flow.id,
      plan,
      values: { ...values },
    })

    await recordAudit(ctx, {
      entityType: 'truck_log_entry',
      entityId: input.entryId,
      action: 'update',
      summary: `Ran vehicle log action: ${res.ran.length ? res.ran.join(', ') : 'no steps ran'}${
        res.failed.length ? ` · issues ${res.failed.join(', ')}` : ''
      }`,
    })
    revalidatePath('/equipment/vehicle-log')
    return { ok: true, ran: res.ran, failed: res.failed }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Action failed' }
  }
}
