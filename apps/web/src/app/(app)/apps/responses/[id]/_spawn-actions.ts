'use server'

// Spawn-from-response server actions.
//
// These are the USER-initiated entry points (the Create CAPA / Create incident
// drawers and per-failed-field buttons). They authorize the caller — assertCan
// on the module create permission plus the per-user record-visibility re-check —
// then delegate the actual write to the shared core in _lib/spawn-core.ts,
// which the Flows executor also uses (tenant-authoritatively, without the
// caller-permission gate). One insert/audit/event path, two authorization
// policies.

import { and, eq, isNull } from 'drizzle-orm'
import { formResponses } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { spawnCorrectiveActionCore, spawnIncidentCore } from '@/app/(app)/apps/_lib/spawn-core'

// -- Shared visibility gate --------------------------------------------------

async function canSpawnFromResponse(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  responseId: string,
): Promise<boolean> {
  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({
        submittedBy: formResponses.submittedBy,
        subjectPersonId: formResponses.subjectPersonId,
        siteOrgUnitId: formResponses.siteOrgUnitId,
      })
      .from(formResponses)
      .where(and(eq(formResponses.id, responseId), isNull(formResponses.deletedAt)))
      .limit(1)
    return r ?? null
  })
  if (!row) return false
  // Per-user record visibility re-check: incident/CA creation is intentionally
  // broad, but the caller must at least be able to SEE the source response
  // before spawning from it by id.
  return ctx.db((tx) =>
    canSeeRecord(ctx, tx, {
      prefix: 'forms.response',
      ownerIds: [row.submittedBy],
      personId: row.subjectPersonId,
      siteId: row.siteOrgUnitId,
    }),
  )
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
  try {
    assertCan(ctx, 'ca.create')
  } catch {
    return { ok: false, error: 'You do not have permission to create corrective actions.' }
  }
  if (!input.responseId) return { ok: false, error: 'Missing responseId' }
  if (!(await canSpawnFromResponse(ctx, input.responseId))) {
    return { ok: false, error: 'Form response not found' }
  }
  return spawnCorrectiveActionCore(ctx, { ...input, initiatedBy: 'user' })
}

// -- 2. Create incident from response --------------------------------------

export type CreateIncidentFromResponseInput = {
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
}

export async function createIncidentFromResponse(
  input: CreateIncidentFromResponseInput,
): Promise<{ ok: true; incidentId: string; reference: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return { ok: false, error: 'Active tenant required' }
  try {
    assertCan(ctx, 'incidents.create')
  } catch {
    return { ok: false, error: 'You do not have permission to report incidents.' }
  }
  if (!input.responseId) return { ok: false, error: 'Missing responseId' }
  if (!(await canSpawnFromResponse(ctx, input.responseId))) {
    return { ok: false, error: 'Form response not found' }
  }
  return spawnIncidentCore(ctx, { ...input, initiatedBy: 'user' })
}
