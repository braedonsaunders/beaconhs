'use server'

// Spawn-from-response server actions.
//
// Both actions reuse the same loader (computeFormScore output) so prefill
// fields stay in sync with the Failed-checks panel on the response viewer.
// They mirror the signatures of corrective-actions/new and incidents/new
// createCorrectiveAction / reportIncident actions, but as typed-object
// inputs (per the spec) instead of FormData so they can be called from a
// client-rendered drawer.

import { revalidatePath } from 'next/cache'
import { count, eq, sql } from 'drizzle-orm'
import {
  correctiveActions,
  formResponses,
  incidents,
} from '@beaconhs/db/schema'
import {
  emitCorrectiveActionAssigned,
  emitIncidentReported,
} from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

// -- Shared loader ---------------------------------------------------------

async function loadResponseForSpawn(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  responseId: string,
): Promise<
  | { ok: true; response: typeof formResponses.$inferSelect }
  | { ok: false; error: string }
> {
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select()
      .from(formResponses)
      .where(eq(formResponses.id, responseId))
      .limit(1)
    return r ?? null
  })
  if (!row) return { ok: false, error: 'Form response not found' }
  return { ok: true, response: row }
}

// -- 1. Create CAPA from response ------------------------------------------

export type CreateCorrectiveActionFromResponseInput = {
  responseId: string
  title: string
  description?: string | null
  severity?: 'low' | 'medium' | 'high' | 'critical'
  dueOn?: string | null
  siteOrgUnitId?: string | null
  // Optional: only address a single field (the per-row "Create CAPA" button).
  // When set, this field is included in the audit metadata.
  failedFieldKey?: string | null
}

export async function createCorrectiveActionFromResponse(
  input: CreateCorrectiveActionFromResponseInput,
): Promise<{ ok: true; caId: string; reference: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  if (!input.responseId) return { ok: false, error: 'Missing responseId' }
  const title = input.title?.trim()
  if (!title) return { ok: false, error: 'Title is required' }

  const loaded = await loadResponseForSpawn(ctx, input.responseId)
  if (!loaded.ok) return loaded

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
        siteOrgUnitId:
          input.siteOrgUnitId ?? loaded.response.siteOrgUnitId ?? null,
        assignedOn,
        dueOn: input.dueOn ?? null,
        assignedByTenantUserId: ctx.membership?.id,
        ownerTenantUserId: ctx.membership?.id,
      })
      .returning()
    return inserted
  })

  if (!row) return { ok: false, error: 'Failed to create corrective action' }

  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: row.id,
    action: 'create',
    summary: `Spawned ${row.reference} from form response ${input.responseId.slice(0, 8)}`,
    after: {
      reference: row.reference,
      severity,
      sourceFormResponseId: input.responseId,
      failedFieldKey: input.failedFieldKey ?? null,
    },
  })
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: input.responseId,
    action: 'update',
    summary: `Spawned corrective action ${row.reference}`,
    metadata: {
      caId: row.id,
      failedFieldKey: input.failedFieldKey ?? null,
    },
  })
  await emitCorrectiveActionAssigned(ctx, {
    caId: row.id,
    assigneeUserId: null,
    assignerUserId: null,
  })

  revalidatePath(`/forms/responses/${input.responseId}`)
  revalidatePath('/corrective-actions')
  return { ok: true, caId: row.id, reference: row.reference }
}

// -- 2. Create incident from response --------------------------------------

export type CreateIncidentFromResponseInput = {
  responseId: string
  title: string
  description?: string | null
  type?: 'injury' | 'illness' | 'near_miss' | 'property_damage' | 'environmental' | 'security' | 'other'
  severity?: 'first_aid_only' | 'medical_aid' | 'lost_time' | 'fatality' | 'no_injury'
  occurredAt?: string | null
  siteOrgUnitId?: string | null
  location?: string | null
}

export async function createIncidentFromResponse(
  input: CreateIncidentFromResponseInput,
): Promise<
  | { ok: true; incidentId: string; reference: string }
  | { ok: false; error: string }
> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  if (!input.responseId) return { ok: false, error: 'Missing responseId' }
  const title = input.title?.trim()
  if (!title) return { ok: false, error: 'Title is required' }

  const loaded = await loadResponseForSpawn(ctx, input.responseId)
  if (!loaded.ok) return loaded

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
        siteOrgUnitId:
          input.siteOrgUnitId ?? loaded.response.siteOrgUnitId ?? null,
        location: input.location?.trim() || null,
        reportedByTenantUserId: ctx.membership?.id ?? null,
        sourceFormResponseId: input.responseId,
      })
      .returning()
    return inserted
  })

  if (!row) return { ok: false, error: 'Failed to create incident' }

  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: row.id,
    action: 'create',
    summary: `Spawned ${row.reference} from form response ${input.responseId.slice(0, 8)}`,
    after: {
      reference: row.reference,
      sourceFormResponseId: input.responseId,
    },
  })
  await recordAudit(ctx, {
    entityType: 'form_response',
    entityId: input.responseId,
    action: 'update',
    summary: `Spawned incident ${row.reference}`,
    metadata: { incidentId: row.id },
  })
  await emitIncidentReported(ctx, { incidentId: row.id })

  revalidatePath(`/forms/responses/${input.responseId}`)
  revalidatePath('/incidents')
  return { ok: true, incidentId: row.id, reference: row.reference }
}

