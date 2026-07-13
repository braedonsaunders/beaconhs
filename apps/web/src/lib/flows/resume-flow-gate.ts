import 'server-only'

import { eq } from 'drizzle-orm'
import { planFromGate } from '@beaconhs/forms-core'
import { flowGates, formAutomations } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { executeFlowPlan } from './execute-flow-plan'
import { buildFlowAdapter } from './registry'

export async function resumeFlowGateNow(
  ctx: RequestContext,
  gateId: string,
  decision: 'approve' | 'reject',
  executionId: string,
): Promise<void> {
  const [gate] = await ctx.db((tx) =>
    tx.select().from(flowGates).where(eq(flowGates.id, gateId)).limit(1),
  )
  if (!gate) throw new Error('Flow gate was not found')
  const expectedStatus = decision === 'approve' ? 'approved' : 'rejected'
  if (gate.status !== expectedStatus) throw new Error('Flow gate decision does not match command')

  const adapter = buildFlowAdapter(ctx, gate.subjectType, gate.subjectKey, gate.subjectId)
  if (!adapter) throw new Error('Flow subject adapter is unavailable')
  const [flow] = await ctx.db((tx) =>
    tx
      .select({ graph: formAutomations.graph })
      .from(formAutomations)
      .where(eq(formAutomations.id, gate.flowId))
      .limit(1),
  )
  if (!flow) throw new Error('Flow definition was not found')

  const values = await adapter.loadValues()
  const plan = planFromGate(flow.graph, gate.nodeId, decision, {
    values,
    rows: {},
    entities: {},
  })
  if (plan.actions.length === 0 && plan.gates.length === 0) return
  const result = await executeFlowPlan(ctx, adapter, {
    flowId: gate.flowId,
    plan,
    values,
    executionId,
  })
  if (result.failed.length > 0) {
    throw new Error(`Gate branch actions failed: ${result.failed.join(', ')}`)
  }
  await recordAudit(ctx, {
    entityType: adapter.auditEntityType,
    entityId: gate.subjectId,
    action: 'update',
    dedupKey: `domain:${executionId}:gate-resume`,
    summary: `Flow gate ${decision} branch ran ${result.ran.join(', ') || 'no actions'}`,
  })
}
