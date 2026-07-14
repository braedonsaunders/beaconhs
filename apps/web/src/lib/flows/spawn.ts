import 'server-only'

// Generic CAPA spawn for native-module flows. Mirrors the form-response spawn
// (reference numbering + polymorphic sourceEntityType/Id) so a journal / hazard
// assessment / incident flow can create a corrective action.

import { correctiveActions } from '@beaconhs/db/schema'
import { eq } from 'drizzle-orm'
import { moduleFlowCommand, recordDomainEvent } from '@beaconhs/events'
import { correctiveActionCreatedEvent } from '@beaconhs/integrations'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { nextReference } from '@/lib/reference'

type CaSource = 'inspection' | 'incident' | 'near_miss' | 'observation' | 'audit' | 'jsha' | 'other'

export async function spawnCorrectiveActionForSubject(
  ctx: RequestContext,
  input: {
    sourceEntityType: string
    sourceEntityId: string
    source: CaSource
    title: string
    description?: string | null
    severity?: 'low' | 'medium' | 'high' | 'critical'
    dueOn?: string | null
    siteOrgUnitId?: string | null
    flowExecutionKey?: string
  },
): Promise<{ ok: boolean }> {
  if (!ctx.tenantId) return { ok: false }
  const title = input.title?.trim()
  if (!title) return { ok: false }
  const assignedOn = new Date().toISOString().slice(0, 10)

  const row = await ctx.db(async (tx) => {
    if (input.flowExecutionKey) {
      const [existing] = await tx
        .select({ id: correctiveActions.id, reference: correctiveActions.reference })
        .from(correctiveActions)
        .where(eq(correctiveActions.flowExecutionKey, input.flowExecutionKey))
        .limit(1)
      if (existing) return { record: existing, replayed: true }
    }
    const reference = await nextReference(tx, ctx.tenantId, 'corrective_action')
    const [inserted] = await tx
      .insert(correctiveActions)
      .values({
        tenantId: ctx.tenantId,
        reference,
        title,
        description: input.description?.trim() || null,
        severity: input.severity ?? 'medium',
        status: 'open',
        source: input.source,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId,
        siteOrgUnitId: input.siteOrgUnitId ?? null,
        assignedOn,
        dueOn: input.dueOn ?? null,
        assignedByTenantUserId: ctx.membership?.id,
        ownerTenantUserId: ctx.membership?.id,
        flowExecutionKey: input.flowExecutionKey,
      })
      .onConflictDoNothing({
        target: [correctiveActions.tenantId, correctiveActions.flowExecutionKey],
      })
      .returning({ id: correctiveActions.id, reference: correctiveActions.reference })
    if (inserted) {
      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'corrective_action.created',
        subjectId: inserted.id,
        dedupKey: `corrective_action.created:${inserted.id}`,
        payload: {
          notification: { kind: 'corrective_action_assigned', caId: inserted.id },
          integration: correctiveActionCreatedEvent(ctx.tenantId, {
            id: inserted.id,
            reference: inserted.reference,
            title,
            status: 'open',
            severity: input.severity ?? 'medium',
            source: input.source,
            dueOn: input.dueOn ?? null,
            assignedOn,
          }),
          web: moduleFlowCommand(ctx, {
            subjectId: inserted.id,
            moduleKey: 'corrective-actions',
            event: 'on_create',
          }),
        },
      })
      await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
        sourceModule: 'corrective_action',
        targetRef: {},
      })
      return { record: inserted, replayed: false }
    }
    if (input.flowExecutionKey) {
      const [existing] = await tx
        .select({ id: correctiveActions.id, reference: correctiveActions.reference })
        .from(correctiveActions)
        .where(eq(correctiveActions.flowExecutionKey, input.flowExecutionKey))
        .limit(1)
      if (existing) return { record: existing, replayed: true }
    }
    return null
  })

  if (!row) return { ok: false }
  if (!row.replayed) {
    await recordAudit(ctx, {
      entityType: 'corrective_action',
      entityId: row.record.id,
      action: 'create',
      summary: `Spawned ${row.record.reference} from ${input.sourceEntityType} flow`,
    })
  }
  return { ok: true }
}
