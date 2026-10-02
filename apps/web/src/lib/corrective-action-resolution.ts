import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { caCompleteSteps, correctiveActions } from '@beaconhs/db/schema'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { moduleFlowCommand, recordDomainEvent } from '@beaconhs/events'
import { correctiveActionClosedEvent } from '@beaconhs/integrations'
import { recordAuditInTransaction } from './audit'
import { canSeeRecord } from './visibility'

/** One atomic resolution path for the action screen and submitted inspection findings. */
export async function resolveCorrectiveActionInTx(
  tx: Database,
  ctx: RequestContext,
  caId: string,
  options: {
    notes?: string | null
    costImpact?: string | null
    allowPendingVerification?: boolean
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  assertCan(ctx, 'ca.update')
  const [ca] = await tx
    .select()
    .from(correctiveActions)
    .where(
      and(
        eq(correctiveActions.tenantId, ctx.tenantId),
        eq(correctiveActions.id, caId),
        isNull(correctiveActions.deletedAt),
      ),
    )
    .limit(1)
    .for('update')
  if (
    !ca ||
    !(await canSeeRecord(ctx, tx, {
      prefix: 'ca',
      ownerIds: [ca.ownerTenantUserId],
      siteId: ca.siteOrgUnitId,
    }))
  )
    return { ok: false, error: 'Corrective action not found.' }
  if (ca.locked || ca.status === 'closed' || ca.status === 'cancelled') {
    return { ok: false, error: 'This corrective action is closed, cancelled, or locked.' }
  }
  const pending = ca.verificationRequired && !ca.verifiedAt
  if (pending && !options.allowPendingVerification) {
    return { ok: false, error: 'Verification is required before closing this action.' }
  }
  const status = pending ? 'pending_verification' : 'closed'
  if (ca.status === status) return { ok: true }
  const now = new Date()
  const patch = {
    status,
    locked: !pending,
    closedAt: pending ? null : now,
    ...(options.costImpact !== undefined ? { costImpact: options.costImpact } : {}),
  } as const
  await tx
    .update(correctiveActions)
    .set(patch)
    .where(and(eq(correctiveActions.tenantId, ctx.tenantId), eq(correctiveActions.id, caId)))
  if (options.notes?.trim()) {
    const [order] = await tx
      .select({ n: sql<number>`coalesce(max(${caCompleteSteps.entityOrder}), 0) + 1` })
      .from(caCompleteSteps)
      .where(and(eq(caCompleteSteps.tenantId, ctx.tenantId), eq(caCompleteSteps.caId, caId)))
    await tx.insert(caCompleteSteps).values({
      tenantId: ctx.tenantId,
      caId,
      kind: 'action_taken',
      description: options.notes.trim(),
      completedByTenantUserId:
        ctx.membership?.id === 'super-admin' ? null : (ctx.membership?.id ?? null),
      entityOrder: order?.n ?? 1,
    })
  }
  await recordDomainEvent(tx, {
    tenantId: ctx.tenantId,
    eventType: pending ? 'corrective_action.pending_verification' : 'corrective_action.closed',
    subjectId: caId,
    dedupKey: `corrective_action.${status}:${caId}:${now.toISOString()}`,
    payload: {
      ...(!pending
        ? {
            notification: { kind: 'corrective_action_completed' as const, caId },
            integration: correctiveActionClosedEvent(ctx.tenantId, {
              id: caId,
              reference: ca.reference,
              title: ca.title,
              status,
              severity: ca.severity,
              closedAt: now,
            }),
          }
        : {}),
      web: moduleFlowCommand(ctx, {
        subjectId: caId,
        moduleKey: 'corrective-actions',
        event: 'status_change',
        toStatus: status,
      }),
    },
  })
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'corrective_action',
    entityId: caId,
    action: 'update',
    summary: pending ? 'Correction recorded; awaiting verification' : 'Closed + locked',
    before: { status: ca.status, locked: ca.locked, closedAt: ca.closedAt },
    after: { ...patch, closedAt: patch.closedAt?.toISOString() ?? null },
  })
  await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
    sourceModule: 'corrective_action',
    targetRef: {},
  })
  return { ok: true }
}

/** Resume follow-up without keeping an obsolete verification or completion stamp. */
export async function resumeCorrectiveActionInTx(
  tx: Database,
  ctx: RequestContext,
  caId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  assertCan(ctx, 'ca.update')
  const [ca] = await tx
    .select()
    .from(correctiveActions)
    .where(
      and(
        eq(correctiveActions.tenantId, ctx.tenantId),
        eq(correctiveActions.id, caId),
        isNull(correctiveActions.deletedAt),
      ),
    )
    .limit(1)
    .for('update')
  if (
    !ca ||
    !(await canSeeRecord(ctx, tx, {
      prefix: 'ca',
      ownerIds: [ca.ownerTenantUserId],
      siteId: ca.siteOrgUnitId,
    }))
  ) {
    return { ok: false, error: 'Corrective action not found.' }
  }
  if (!['closed', 'pending_verification'].includes(ca.status))
    return { ok: false, error: 'Action is not closed or awaiting verification.' }
  const patch = {
    status: 'in_progress',
    locked: false,
    closedAt: null,
    verifiedAt: null,
    verifiedByTenantUserId: null,
  } as const
  await tx
    .update(correctiveActions)
    .set(patch)
    .where(and(eq(correctiveActions.tenantId, ctx.tenantId), eq(correctiveActions.id, caId)))
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'corrective_action',
    entityId: caId,
    action: 'update',
    summary: 'Reopened for follow-up',
    before: { status: ca.status, closedAt: ca.closedAt, verifiedAt: ca.verifiedAt },
    after: patch,
  })
  await recordDomainEvent(tx, {
    tenantId: ctx.tenantId,
    eventType: 'corrective_action.reopened',
    subjectId: caId,
    dedupKey: `corrective_action.reopened:${caId}:${new Date().toISOString()}`,
    payload: {
      web: moduleFlowCommand(ctx, {
        subjectId: caId,
        moduleKey: 'corrective-actions',
        event: 'status_change',
        toStatus: 'in_progress',
      }),
    },
  })
  await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
    sourceModule: 'corrective_action',
    targetRef: {},
  })
  return { ok: true }
}
