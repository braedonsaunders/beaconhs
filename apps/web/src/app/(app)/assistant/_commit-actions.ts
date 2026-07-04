'use server'

// The ONLY mutation path for assistant-drafted writes. A draft tool returns a
// signed proposal; these actions run when the user clicks Apply. Each one:
//  1. blocks while impersonating, 2. re-checks the REAL module permission,
//  3. verifies the HMAC token (anti-tamper / anti-expiry), 4. re-checks any
//  referenced record's visibility (TOCTOU), 5. inserts exactly like the hand UI,
//  6. audits (flagged via:assistant) + emits + runs flows + revalidates.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { correctiveActions, incidents } from '@beaconhs/db/schema'
import { assertNotImpersonating, can } from '@beaconhs/tenant'
import { emitCorrectiveActionAssigned, emitIncidentReported } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { nextReference } from '@/lib/reference'
import { recordVisibilityWhere } from '@/lib/visibility'
import { runModuleFlows } from '@/lib/flows/run-module-flows'
import { verifyProposal, type CaPreview, type IncidentPreview } from '@/lib/assistant/proposals'

export type CommitResult =
  | { ok: true; id: string; reference: string; href: string }
  | { ok: false; error: string }

export async function commitCorrectiveAction(input: {
  preview: CaPreview
  confirmToken: string
}): Promise<CommitResult> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'assistant write')
  if (!can(ctx, 'ca.create')) return { ok: false, error: 'You cannot create corrective actions.' }
  if (!verifyProposal('create_corrective_action', input.preview, input.confirmToken, ctx)) {
    return {
      ok: false,
      error: 'This draft expired or was modified. Ask the assistant to draft it again.',
    }
  }
  const p = input.preview

  // TOCTOU: the linked incident's visibility may have changed since drafting.
  if (p.sourceEntityId) {
    const visible = await ctx.db(async (tx) => {
      const conds = [eq(incidents.id, p.sourceEntityId!), isNull(incidents.deletedAt)]
      const vis = await recordVisibilityWhere(ctx, tx, {
        siteCol: incidents.siteOrgUnitId,
        createdByCol: incidents.reportedByTenantUserId,
      })
      if (vis) conds.push(vis)
      const [r] = await tx
        .select({ id: incidents.id })
        .from(incidents)
        .where(and(...conds))
        .limit(1)
      return Boolean(r)
    })
    if (!visible) return { ok: false, error: 'The linked incident is no longer accessible.' }
  }

  const row = await ctx.db(async (tx) => {
    const reference = await nextReference(tx, ctx.tenantId, 'corrective_action')
    const [r] = await tx
      .insert(correctiveActions)
      .values({
        tenantId: ctx.tenantId,
        reference,
        title: p.title,
        description: p.description,
        severity: p.severity,
        status: 'open',
        source: p.source,
        sourceEntityType: p.sourceEntityType,
        sourceEntityId: p.sourceEntityId,
        siteOrgUnitId: p.siteOrgUnitId,
        assignedOn: new Date().toISOString().slice(0, 10),
        dueOn: p.dueOn,
        assignedByTenantUserId: ctx.membership?.id,
        ownerTenantUserId: ctx.membership?.id,
      })
      .returning({ id: correctiveActions.id, reference: correctiveActions.reference })
    return r!
  })

  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: row.id,
    action: 'create',
    summary: `Created ${row.reference} via assistant: ${p.title}`,
    metadata: { via: 'assistant' },
    after: { reference: row.reference, severity: p.severity, source: p.source, dueOn: p.dueOn },
  })
  await emitCorrectiveActionAssigned(ctx, {
    caId: row.id,
    assigneeUserId: null,
    assignerUserId: null,
  })
  await runModuleFlows(ctx, {
    moduleKey: 'corrective-actions',
    event: 'on_create',
    subjectId: row.id,
  })
  revalidatePath('/corrective-actions')
  return { ok: true, id: row.id, reference: row.reference, href: `/corrective-actions/${row.id}` }
}

export async function commitIncident(input: {
  preview: IncidentPreview
  confirmToken: string
}): Promise<CommitResult> {
  const ctx = await requireRequestContext()
  assertNotImpersonating(ctx, 'assistant write')
  if (!can(ctx, 'incidents.create')) return { ok: false, error: 'You cannot report incidents.' }
  if (!verifyProposal('create_incident', input.preview, input.confirmToken, ctx)) {
    return {
      ok: false,
      error: 'This draft expired or was modified. Ask the assistant to draft it again.',
    }
  }
  const p = input.preview
  const occurredAt = new Date(p.occurredAt)
  if (Number.isNaN(occurredAt.getTime()))
    return { ok: false, error: 'The drafted date is invalid.' }

  const row = await ctx.db(async (tx) => {
    const reference = await nextReference(tx, ctx.tenantId, 'incident')
    const [r] = await tx
      .insert(incidents)
      .values({
        tenantId: ctx.tenantId,
        reference,
        type: p.type,
        severity: p.severity,
        status: 'reported',
        title: p.title,
        description: p.description,
        occurredAt,
        location: p.location,
        reportedByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: incidents.id, reference: incidents.reference })
    return r!
  })

  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: row.id,
    action: 'create',
    summary: `Reported ${row.reference} via assistant: ${p.title}`,
    metadata: { via: 'assistant' },
    after: { reference: row.reference, type: p.type, severity: p.severity },
  })
  await emitIncidentReported(ctx, { incidentId: row.id })
  await runModuleFlows(ctx, { moduleKey: 'incidents', event: 'on_create', subjectId: row.id })
  revalidatePath('/incidents')
  return { ok: true, id: row.id, reference: row.reference, href: `/incidents/${row.id}` }
}
