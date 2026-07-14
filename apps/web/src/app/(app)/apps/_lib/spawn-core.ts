import 'server-only'

// Core spawn-from-response writers, shared by:
//   - the user-facing server actions (responses/[id]/_spawn-actions.ts), which
//     gate on assertCan('ca.create' / 'incidents.create') + canSeeRecord; and
//   - the Flows executor (form-flow-adapter.ts), which runs TENANT-AUTHORITATIVE:
//     an admin-authored automation ("create a CAPA when any item fails") must
//     not silently no-op just because the SUBMITTING user lacks ca.create /
//     incidents.create. Flow-initiated writes carry dual attribution in the
//     audit trail (actor = the user whose submit triggered the flow, metadata
//     initiatedBy = 'flow').
//
// Callers own authorization; this module owns validation, the insert, audit
// records, event emission, and path revalidation.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { correctiveActions, formResponses, incidents } from '@beaconhs/db/schema'
import { moduleFlowCommand, recordDomainEvent } from '@beaconhs/events'
import { correctiveActionCreatedEvent, incidentCreatedEvent } from '@beaconhs/integrations'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { nextReference } from '@/lib/reference'

type Initiator = 'user' | 'flow'

async function loadSourceSite(
  ctx: RequestContext,
  responseId: string,
): Promise<{ ok: true; siteOrgUnitId: string | null } | { ok: false; error: string }> {
  const [row] = await ctx.db((tx) =>
    tx
      .select({ siteOrgUnitId: formResponses.siteOrgUnitId })
      .from(formResponses)
      .where(and(eq(formResponses.id, responseId), isNull(formResponses.deletedAt)))
      .limit(1),
  )
  if (!row) return { ok: false, error: 'Form response not found' }
  return { ok: true, siteOrgUnitId: row.siteOrgUnitId }
}

type SpawnCorrectiveActionCoreInput = {
  responseId: string
  title: string
  description?: string | null
  severity?: 'low' | 'medium' | 'high' | 'critical'
  dueOn?: string | null
  siteOrgUnitId?: string | null
  failedFieldKey?: string | null
  flowExecutionKey?: string
  initiatedBy: Initiator
}

export async function spawnCorrectiveActionCore(
  ctx: RequestContext,
  input: SpawnCorrectiveActionCoreInput,
): Promise<{ ok: true; caId: string; reference: string } | { ok: false; error: string }> {
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  if (!input.responseId) return { ok: false, error: 'Missing responseId' }
  const title = input.title?.trim()
  if (!title) return { ok: false, error: 'Title is required' }

  const source = await loadSourceSite(ctx, input.responseId)
  if (!source.ok) return source

  const severity = input.severity ?? 'medium'
  const assignedOn = new Date().toISOString().slice(0, 10)

  const row = await ctx.db(async (tx) => {
    if (input.flowExecutionKey) {
      const [existing] = await tx
        .select()
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
        severity,
        status: 'open',
        source: 'inspection', // form-response-driven CAPAs are inspection-shaped
        sourceEntityType: 'form_response',
        sourceEntityId: input.responseId,
        sourceFormResponseId: input.responseId,
        siteOrgUnitId: input.siteOrgUnitId ?? source.siteOrgUnitId ?? null,
        assignedOn,
        dueOn: input.dueOn ?? null,
        assignedByTenantUserId: ctx.membership?.id,
        ownerTenantUserId: ctx.membership?.id,
        flowExecutionKey: input.flowExecutionKey,
      })
      .onConflictDoNothing({
        target: [correctiveActions.tenantId, correctiveActions.flowExecutionKey],
      })
      .returning()
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
            title: inserted.title,
            status: inserted.status,
            severity: inserted.severity,
            source: inserted.source,
            dueOn: inserted.dueOn,
            assignedOn: inserted.assignedOn,
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
    }
    if (inserted) return { record: inserted, replayed: false }
    if (input.flowExecutionKey) {
      const [existing] = await tx
        .select()
        .from(correctiveActions)
        .where(eq(correctiveActions.flowExecutionKey, input.flowExecutionKey))
        .limit(1)
      if (existing) return { record: existing, replayed: true }
    }
    return null
  })

  if (!row) return { ok: false, error: 'Failed to create corrective action' }
  const record = row.record

  const via = input.initiatedBy === 'flow' ? ' (automation)' : ''
  if (!row.replayed) {
    await recordAudit(ctx, {
      entityType: 'corrective_action',
      entityId: record.id,
      action: 'create',
      summary: `Spawned ${record.reference} from form response ${input.responseId.slice(0, 8)}${via}`,
      after: {
        reference: record.reference,
        severity,
        sourceFormResponseId: input.responseId,
        failedFieldKey: input.failedFieldKey ?? null,
        initiatedBy: input.initiatedBy,
      },
    })
    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: input.responseId,
      action: 'update',
      summary: `Spawned corrective action ${record.reference}${via}`,
      metadata: {
        caId: record.id,
        failedFieldKey: input.failedFieldKey ?? null,
        initiatedBy: input.initiatedBy,
      },
    })
  }
  revalidatePath(`/apps/responses/${input.responseId}`)
  revalidatePath('/corrective-actions')
  return { ok: true, caId: record.id, reference: record.reference }
}

type SpawnIncidentCoreInput = {
  responseId: string
  title: string
  description?: string | null
  type?:
    'injury' | 'illness' | 'near_miss' | 'property_damage' | 'environmental' | 'security' | 'other'
  severity?: 'first_aid_only' | 'medical_aid' | 'lost_time' | 'fatality' | 'no_injury'
  occurredAt?: string | null
  siteOrgUnitId?: string | null
  location?: string | null
  flowExecutionKey?: string
  initiatedBy: Initiator
}

export async function spawnIncidentCore(
  ctx: RequestContext,
  input: SpawnIncidentCoreInput,
): Promise<{ ok: true; incidentId: string; reference: string } | { ok: false; error: string }> {
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  if (!input.responseId) return { ok: false, error: 'Missing responseId' }
  const title = input.title?.trim()
  if (!title) return { ok: false, error: 'Title is required' }

  const source = await loadSourceSite(ctx, input.responseId)
  if (!source.ok) return source

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date()
  if (Number.isNaN(occurredAt.getTime())) {
    return { ok: false, error: 'Invalid occurred date' }
  }

  const row = await ctx.db(async (tx) => {
    if (input.flowExecutionKey) {
      const [existing] = await tx
        .select()
        .from(incidents)
        .where(eq(incidents.flowExecutionKey, input.flowExecutionKey))
        .limit(1)
      if (existing) return { record: existing, replayed: true }
    }
    const reference = await nextReference(tx, ctx.tenantId, 'incident', occurredAt.getFullYear())
    const [inserted] = await tx
      .insert(incidents)
      .values({
        tenantId: ctx.tenantId,
        reference,
        type: input.type ?? 'other',
        severity: input.severity ?? 'no_injury',
        status: 'reported',
        title,
        description: input.description?.trim() || null,
        occurredAt,
        siteOrgUnitId: input.siteOrgUnitId ?? source.siteOrgUnitId ?? null,
        location: input.location?.trim() || null,
        reportedByTenantUserId: ctx.membership?.id ?? null,
        sourceFormResponseId: input.responseId,
        flowExecutionKey: input.flowExecutionKey,
      })
      .onConflictDoNothing({ target: [incidents.tenantId, incidents.flowExecutionKey] })
      .returning()
    if (inserted) {
      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'incident.created',
        subjectId: inserted.id,
        dedupKey: `incident.created:${inserted.id}`,
        payload: {
          notification: { kind: 'incident_reported', incidentId: inserted.id },
          integration: incidentCreatedEvent(ctx.tenantId, {
            id: inserted.id,
            reference: inserted.reference,
            type: inserted.type,
            severity: inserted.severity,
            status: inserted.status,
            title: inserted.title,
            description: inserted.description,
            occurredAt: inserted.occurredAt,
            location: inserted.location,
          }),
          web: moduleFlowCommand(ctx, {
            subjectId: inserted.id,
            moduleKey: 'incidents',
            event: 'on_create',
          }),
        },
      })
    }
    if (inserted) return { record: inserted, replayed: false }
    if (input.flowExecutionKey) {
      const [existing] = await tx
        .select()
        .from(incidents)
        .where(eq(incidents.flowExecutionKey, input.flowExecutionKey))
        .limit(1)
      if (existing) return { record: existing, replayed: true }
    }
    return null
  })

  if (!row) return { ok: false, error: 'Failed to create incident' }
  const record = row.record

  const via = input.initiatedBy === 'flow' ? ' (automation)' : ''
  if (!row.replayed) {
    await recordAudit(ctx, {
      entityType: 'incident',
      entityId: record.id,
      action: 'create',
      summary: `Spawned ${record.reference} from form response ${input.responseId.slice(0, 8)}${via}`,
      after: {
        reference: record.reference,
        sourceFormResponseId: input.responseId,
        initiatedBy: input.initiatedBy,
      },
    })
    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: input.responseId,
      action: 'update',
      summary: `Spawned incident ${record.reference}${via}`,
      metadata: { incidentId: record.id, initiatedBy: input.initiatedBy },
    })
  }
  revalidatePath(`/apps/responses/${input.responseId}`)
  revalidatePath('/incidents')
  return { ok: true, incidentId: record.id, reference: record.reference }
}
