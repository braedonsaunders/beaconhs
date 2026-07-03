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
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { correctiveActions, formResponses, incidents } from '@beaconhs/db/schema'
import { emitCorrectiveActionAssigned, emitIncidentReported } from '@beaconhs/events'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'

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

export type SpawnCorrectiveActionCoreInput = {
  responseId: string
  title: string
  description?: string | null
  severity?: 'low' | 'medium' | 'high' | 'critical'
  dueOn?: string | null
  siteOrgUnitId?: string | null
  failedFieldKey?: string | null
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
    const year = new Date().getFullYear()
    const [{ c } = { c: 0 }] = await tx
      .select({ c: count() })
      .from(correctiveActions)
      .where(
        sql`extract(year from coalesce(${correctiveActions.assignedOn}, current_date)) = ${year}`,
      )
    const reference = `CA-${year}-${String(Number(c ?? 0) + 1).padStart(4, '0')}`
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
      })
      .returning()
    return inserted
  })

  if (!row) return { ok: false, error: 'Failed to create corrective action' }

  const via = input.initiatedBy === 'flow' ? ' (automation)' : ''
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: row.id,
    action: 'create',
    summary: `Spawned ${row.reference} from form response ${input.responseId.slice(0, 8)}${via}`,
    after: {
      reference: row.reference,
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
    summary: `Spawned corrective action ${row.reference}${via}`,
    metadata: {
      caId: row.id,
      failedFieldKey: input.failedFieldKey ?? null,
      initiatedBy: input.initiatedBy,
    },
  })
  await emitCorrectiveActionAssigned(ctx, {
    caId: row.id,
    assigneeUserId: null,
    assignerUserId: null,
  })

  revalidatePath(`/apps/responses/${input.responseId}`)
  revalidatePath('/corrective-actions')
  return { ok: true, caId: row.id, reference: row.reference }
}

export type SpawnIncidentCoreInput = {
  responseId: string
  title: string
  description?: string | null
  type?:
    | 'injury'
    | 'illness'
    | 'near_miss'
    | 'property_damage'
    | 'environmental'
    | 'security'
    | 'other'
  severity?: 'first_aid_only' | 'medical_aid' | 'lost_time' | 'fatality' | 'no_injury'
  occurredAt?: string | null
  siteOrgUnitId?: string | null
  location?: string | null
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
    const year = occurredAt.getFullYear()
    const [{ c } = { c: 0 }] = await tx
      .select({ c: count() })
      .from(incidents)
      .where(sql`extract(year from ${incidents.occurredAt}) = ${year}`)
    const reference = `INC-${year}-${String(Number(c ?? 0) + 1).padStart(4, '0')}`
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
      })
      .returning()
    return inserted
  })

  if (!row) return { ok: false, error: 'Failed to create incident' }

  const via = input.initiatedBy === 'flow' ? ' (automation)' : ''
  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: row.id,
    action: 'create',
    summary: `Spawned ${row.reference} from form response ${input.responseId.slice(0, 8)}${via}`,
    after: {
      reference: row.reference,
      sourceFormResponseId: input.responseId,
      initiatedBy: input.initiatedBy,
    },
  })
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: input.responseId,
    action: 'update',
    summary: `Spawned incident ${row.reference}${via}`,
    metadata: { incidentId: row.id, initiatedBy: input.initiatedBy },
  })
  await emitIncidentReported(ctx, { incidentId: row.id })
  await runModuleFlows(ctx, { moduleKey: 'incidents', event: 'on_create', subjectId: row.id })

  revalidatePath(`/apps/responses/${input.responseId}`)
  revalidatePath('/incidents')
  return { ok: true, incidentId: row.id, reference: row.reference }
}
