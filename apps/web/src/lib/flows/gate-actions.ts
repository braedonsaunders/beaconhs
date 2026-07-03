'use server'

// Resolve a flow gate (approve/reject) for ANY subject. Marks the flow_gates row
// decided, then rebuilds the subject's adapter and RESUMES the chosen branch via
// planFromGate → the shared executor. Authorization: the assignee, or a manager
// for that subject.

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { planFromGate } from '@beaconhs/forms-core'
import { flowGates, formAutomations } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { executeFlowPlan } from './execute-flow-plan'
import { buildFlowAdapter, canManageSubjectGates } from './registry'

export async function resolveFlowGate(args: {
  gateId: string
  decision: 'approve' | 'reject'
  comment?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  const { gateId, decision } = args
  if (!gateId) return { ok: false, error: 'Missing approval' }

  const [gate] = await ctx.db((tx) =>
    tx.select().from(flowGates).where(eq(flowGates.id, gateId)).limit(1),
  )
  if (!gate) return { ok: false, error: 'Approval not found' }
  if (gate.status !== 'pending') return { ok: false, error: 'This approval was already resolved' }

  const me = ctx.membership?.id ?? null
  const canManage = canManageSubjectGates(ctx, gate.subjectType, gate.subjectKey)
  if (!((me && gate.assigneeTenantUserId === me) || canManage)) {
    return { ok: false, error: 'You are not the approver for this gate' }
  }

  // Atomic transition: only a still-pending gate flips, so two concurrent
  // approvals can never both resume the branch and double-fire its actions.
  const [decided] = await ctx.db((tx) =>
    tx
      .update(flowGates)
      .set({
        status: decision === 'approve' ? 'approved' : 'rejected',
        decidedByTenantUserId: me,
        decidedAt: new Date(),
        comment: args.comment ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(flowGates.id, gateId), eq(flowGates.status, 'pending')))
      .returning({ id: flowGates.id }),
  )
  if (!decided) return { ok: false, error: 'This approval was already resolved' }

  // Resume the chosen branch through the subject's adapter.
  const adapter = buildFlowAdapter(ctx, gate.subjectType, gate.subjectKey, gate.subjectId)
  const [flow] = await ctx.db((tx) =>
    tx
      .select({ graph: formAutomations.graph })
      .from(formAutomations)
      .where(eq(formAutomations.id, gate.flowId))
      .limit(1),
  )

  let summary = `Flow gate ${decision === 'approve' ? 'approved' : 'rejected'}`
  if (adapter && flow?.graph) {
    try {
      const values = await adapter.loadValues()
      const plan = planFromGate(flow.graph, gate.nodeId, decision, {
        values,
        rows: {},
        entities: {},
      })
      if (plan.actions.length > 0 || plan.gates.length > 0) {
        const res = await executeFlowPlan(ctx, adapter, { flowId: gate.flowId, plan, values })
        if (res.ran.length) summary += ` · ran ${res.ran.join(', ')}`
        if (res.failed.length) summary += ` · issues ${res.failed.join(', ')}`
      }
    } catch {
      summary += ' · resume error'
    }
  }

  // Every decision is audited — even when the flow row or adapter is gone the
  // gate mutation itself must leave a trail.
  await recordAudit(ctx, {
    entityType: adapter?.auditEntityType ?? 'flow_gate',
    entityId: adapter ? gate.subjectId : gateId,
    action: decision === 'approve' ? 'sign' : 'update',
    summary,
  })
  if (adapter) revalidatePath(adapter.deepLink())

  return { ok: true }
}
