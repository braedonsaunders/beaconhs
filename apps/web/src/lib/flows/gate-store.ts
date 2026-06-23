import 'server-only'

// The ONE gate store — flow_gates — for every flow subject (forms + native
// modules). Pure DB reads/writes; deliberately free of the executor so the
// executor can import recordFlowGate without an import cycle.

import { and, eq } from 'drizzle-orm'
import { flowGates, tenantUsers, users } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'

export type PendingFlowGate = {
  id: string
  title: string
  assigneeName: string | null
  assignedToMe: boolean
  canAct: boolean
}

export async function recordFlowGate(
  ctx: RequestContext,
  i: {
    subjectType: 'form_template' | 'module'
    subjectKey: string | null
    subjectId: string
    flowId: string
    nodeId: string
    title: string
    assigneeTenantUserId: string | null
    signatureRequired: boolean
  },
): Promise<void> {
  await ctx.db((tx) =>
    tx.insert(flowGates).values({
      tenantId: ctx.tenantId,
      subjectType: i.subjectType,
      subjectKey: i.subjectKey,
      subjectId: i.subjectId,
      flowId: i.flowId,
      nodeId: i.nodeId,
      title: i.title,
      assigneeTenantUserId: i.assigneeTenantUserId,
      status: 'pending',
      signatureRequired: i.signatureRequired,
    }),
  )
}

/** Pending gate approvals for one record, with display + can-act flags. */
export async function getPendingFlowGatesForSubject(
  ctx: RequestContext,
  subjectType: 'form_template' | 'module',
  subjectId: string,
  canManage: boolean,
): Promise<PendingFlowGate[]> {
  if (!ctx.tenantId) return []
  const me = ctx.membership?.id ?? null

  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: flowGates.id,
        title: flowGates.title,
        assigneeId: flowGates.assigneeTenantUserId,
        assigneeName: users.name,
        assigneeEmail: users.email,
      })
      .from(flowGates)
      .leftJoin(tenantUsers, eq(tenantUsers.id, flowGates.assigneeTenantUserId))
      .leftJoin(users, eq(users.id, tenantUsers.userId))
      .where(
        and(
          eq(flowGates.subjectType, subjectType),
          eq(flowGates.subjectId, subjectId),
          eq(flowGates.status, 'pending'),
        ),
      ),
  )

  return rows.map((r) => {
    const assignedToMe = !!me && r.assigneeId === me
    return {
      id: r.id,
      title: r.title || 'Approval',
      assigneeName: r.assigneeName ?? r.assigneeEmail ?? null,
      assignedToMe,
      // The assignee can act; managers can act on any (incl. unassigned) gate.
      canAct: assignedToMe || canManage,
    }
  })
}
