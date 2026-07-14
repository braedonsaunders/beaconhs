'use server'

// Resolve a flow gate (approve/reject) for ANY subject. The decision and its
// branch-resume command commit together; the worker retries that command through
// the shared executor. Authorization: the assignee, or a subject manager.

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { flowGates } from '@beaconhs/db/schema'
import { recordDomainEvent } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { canAccessResponseTemplate } from '@/app/(app)/apps/_lib/access'
import { buildFlowAdapter, canManageSubjectGates } from './registry'

export async function resolveFlowGate(args: {
  gateId: string
  decision: 'approve' | 'reject'
  comment?: string | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  if (
    !args ||
    typeof args !== 'object' ||
    (args.decision !== 'approve' && args.decision !== 'reject') ||
    (args.comment !== undefined && args.comment !== null && typeof args.comment !== 'string') ||
    (typeof args.comment === 'string' && args.comment.trim().length > 2_000)
  ) {
    return { ok: false, error: 'Invalid approval request' }
  }
  const { gateId, decision } = args
  if (!isUuid(gateId)) return { ok: false, error: 'Approval not found' }
  const comment = typeof args.comment === 'string' ? args.comment.trim() || null : null

  const [gate] = await ctx.db((tx) =>
    tx.select().from(flowGates).where(eq(flowGates.id, gateId)).limit(1),
  )
  if (!gate) return { ok: false, error: 'Approval not found' }
  if (gate.status !== 'pending') return { ok: false, error: 'This approval was already resolved' }
  if (
    gate.subjectType === 'form_template' &&
    !(await canAccessResponseTemplate(ctx, gate.subjectId, 'operate'))
  ) {
    return { ok: false, error: 'Approval not found' }
  }

  const me = ctx.membership?.id ?? null
  const canManage = canManageSubjectGates(ctx, gate.subjectType, gate.subjectKey)
  if (!((me && gate.assigneeTenantUserId === me) || canManage)) {
    return { ok: false, error: 'You are not the approver for this gate' }
  }

  // Atomic transition: only a still-pending gate flips, so two concurrent
  // approvals can never both resume the branch and double-fire its actions.
  const decidedAt = new Date()
  const [decided] = await ctx.db(async (tx) => {
    const rows = await tx
      .update(flowGates)
      .set({
        status: decision === 'approve' ? 'approved' : 'rejected',
        decidedByTenantUserId: me,
        decidedAt,
        comment,
        updatedAt: new Date(),
      })
      .where(and(eq(flowGates.id, gateId), eq(flowGates.status, 'pending')))
      .returning({ id: flowGates.id })
    if (rows[0]) {
      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'flow.gate.decided',
        subjectId: gateId,
        dedupKey: `flow.gate.decided:${gateId}`,
        payload: {
          web: {
            kind: 'flow_gate_decided',
            subjectId: gateId,
            gateId,
            decision,
            actor: {
              userId: ctx.userId,
              membershipId: ctx.membership?.id ?? null,
              personId: ctx.personId,
              timezone: ctx.timezone,
            },
          },
        },
      })
    }
    return rows
  })
  if (!decided) return { ok: false, error: 'This approval was already resolved' }

  const adapter = buildFlowAdapter(ctx, gate.subjectType, gate.subjectKey, gate.subjectId)

  await recordAudit(ctx, {
    entityType: adapter?.auditEntityType ?? 'flow_gate',
    entityId: adapter ? gate.subjectId : gateId,
    action: decision === 'approve' ? 'sign' : 'update',
    summary: `Flow gate ${decision === 'approve' ? 'approved' : 'rejected'}; downstream branch queued`,
  })
  if (adapter) revalidatePath(adapter.deepLink())

  return { ok: true }
}
