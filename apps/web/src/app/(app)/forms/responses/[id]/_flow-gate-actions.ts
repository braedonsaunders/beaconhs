'use server'

// Flow gates — human approve/reject nodes from the unified automation canvas.
// On submit, the engine persists a pending form_response_steps row with
// stepKey `gate:{flowId}:{nodeId}` (see forms/_lib/run-automations.ts). These
// actions let the assigned approver resolve a gate; resolving it RESUMES the
// flow down the chosen branch (running the downstream actions/gates) via the
// shared executor.

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import { planFromGate } from '@beaconhs/forms-core'
import {
  formAutomations,
  formResponseSteps,
  formResponses,
  tenantUsers,
  users,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { executeFlowPlan } from '@/app/(app)/forms/_lib/run-automations'

export type PendingFlowGate = {
  id: string
  title: string
  assigneeName: string | null
  assignedToMe: boolean
  canAct: boolean
}

function parseGateKey(stepKey: string): { flowId: string; nodeId: string } | null {
  if (!stepKey.startsWith('gate:')) return null
  const [, flowId, nodeId] = stepKey.split(':')
  if (!flowId || !nodeId) return null
  return { flowId, nodeId }
}

// Pending gate approvals for a response, with display + can-act flags for the
// current viewer. Read-only; safe to call from the response page.
export async function getPendingFlowGates(responseId: string): Promise<PendingFlowGate[]> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return []
  const isManager = can(ctx, 'forms.response.read.all')
  const me = ctx.membership?.id ?? null

  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: formResponseSteps.id,
        stepKey: formResponseSteps.stepKey,
        title: formResponseSteps.comment,
        assigneeId: formResponseSteps.assigneeTenantUserId,
        assigneeName: users.name,
        assigneeEmail: users.email,
      })
      .from(formResponseSteps)
      .leftJoin(tenantUsers, eq(tenantUsers.id, formResponseSteps.assigneeTenantUserId))
      .leftJoin(users, eq(users.id, tenantUsers.userId))
      .where(
        and(eq(formResponseSteps.responseId, responseId), eq(formResponseSteps.status, 'pending')),
      ),
  )

  return rows
    .filter((r) => r.stepKey.startsWith('gate:'))
    .map((r) => {
      const assignedToMe = !!me && r.assigneeId === me
      return {
        id: r.id,
        title: r.title || 'Approval',
        assigneeName: r.assigneeName ?? r.assigneeEmail ?? null,
        assignedToMe,
        // The assignee can act; managers can act on any (incl. unassigned) gate.
        canAct: assignedToMe || isManager,
      }
    })
}

export async function resolveFlowGate(args: {
  stepId: string
  decision: 'approve' | 'reject'
  comment?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  const { stepId, decision } = args
  if (!stepId) return { ok: false, error: 'Missing step' }

  // Load the gate step.
  const [step] = await ctx.db((tx) =>
    tx
      .select({
        id: formResponseSteps.id,
        responseId: formResponseSteps.responseId,
        stepKey: formResponseSteps.stepKey,
        status: formResponseSteps.status,
        assigneeId: formResponseSteps.assigneeTenantUserId,
      })
      .from(formResponseSteps)
      .where(eq(formResponseSteps.id, stepId))
      .limit(1),
  )
  if (!step) return { ok: false, error: 'Approval not found' }
  if (step.status !== 'pending') return { ok: false, error: 'This approval was already resolved' }
  const parsed = parseGateKey(step.stepKey)
  if (!parsed) return { ok: false, error: 'Not a flow gate' }

  // Authorization: the assignee, or a forms manager, may resolve it.
  const me = ctx.membership?.id ?? null
  const isManager = can(ctx, 'forms.response.read.all')
  if (!((me && step.assigneeId === me) || isManager)) {
    return { ok: false, error: 'You are not the approver for this gate' }
  }

  // Mark the step resolved.
  await ctx.db((tx) =>
    tx
      .update(formResponseSteps)
      .set(
        decision === 'approve'
          ? {
              status: 'signed',
              signedAt: new Date(),
              signedByTenantUserId: me,
              comment: args.comment ?? step.stepKey,
            }
          : {
              status: 'rejected',
              rejectedAt: new Date(),
              rejectedByTenantUserId: me,
              rejectionReason: args.comment ?? null,
            },
      )
      .where(eq(formResponseSteps.id, stepId)),
  )

  // Resume the flow from the gate's chosen branch.
  const [flow] = await ctx.db((tx) =>
    tx
      .select({ graph: formAutomations.graph })
      .from(formAutomations)
      .where(eq(formAutomations.id, parsed.flowId))
      .limit(1),
  )
  const [resp] = await ctx.db((tx) =>
    tx
      .select({
        data: formResponses.data,
        score: formResponses.complianceScore,
        status: formResponses.complianceStatus,
      })
      .from(formResponses)
      .where(eq(formResponses.id, step.responseId))
      .limit(1),
  )

  let summary = `Flow gate ${decision === 'approve' ? 'approved' : 'rejected'}`
  if (flow?.graph && resp) {
    const values: Record<string, unknown> = {
      ...(resp.data ?? {}),
      compliance_score: resp.score != null ? Number(resp.score) : null,
      compliance_status: resp.status ?? null,
    }
    try {
      const plan = planFromGate(flow.graph, parsed.nodeId, decision, {
        values,
        rows: {},
        entities: {},
      })
      if (plan.actions.length > 0 || plan.gates.length > 0) {
        const res = await executeFlowPlan(ctx, {
          responseId: step.responseId,
          flowId: parsed.flowId,
          plan,
          values,
        })
        if (res.ran.length) summary += ` · ran ${res.ran.join(', ')}`
        if (res.failed.length) summary += ` · issues ${res.failed.join(', ')}`
      }
    } catch {
      summary += ' · resume error'
    }
  }

  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: step.responseId,
    action: decision === 'approve' ? 'sign' : 'update',
    summary,
  })
  revalidatePath(`/forms/responses/${step.responseId}`)
  return { ok: true }
}
