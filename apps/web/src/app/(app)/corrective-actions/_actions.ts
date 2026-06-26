'use server'

// Server actions for the corrective-actions suite.
//
// Every mutation records an audit-log entry so the activity tab tells a
// coherent story (who, what, when). Photo attachments reuse the existing
// FileUpload → finalizeUpload flow; this module only stores the join row.
//
// Locking rules:
// - status='closed' sets `locked: true` and stamps `closedAt`.
// - while locked, all mutating actions short-circuit with an error so the
//   client surfaces "this action is locked".

import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  caCompleteSteps,
  caPhotos,
  correctiveActions,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { emitCorrectiveActionAssigned, emitCorrectiveActionCompleted } from '@beaconhs/events'
import { emitCorrectiveActionClosed } from '@beaconhs/integrations'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { canSeeRecord } from '@/lib/visibility'
import { runModuleFlows } from '@/lib/flows/run-module-flows'

export type ActionResult = { ok: true } | { ok: false; error: string }

async function loadCA(ctx: Awaited<ReturnType<typeof requireRequestContext>>, id: string) {
  return ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(correctiveActions)
      .where(eq(correctiveActions.id, id))
      .limit(1)
    if (!row) return null
    // Re-scope to the caller's read tier so a self/site-tier user can't drive a
    // corrective action they cannot see by guessing its id (mirrors the detail
    // page's canSeeRecord check).
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'ca',
      ownerIds: [row.ownerTenantUserId],
      siteId: row.siteOrgUnitId,
    })
    return visible ? row : null
  })
}

function assertNotLocked(ca: { locked: boolean }): ActionResult | null {
  if (ca.locked) return { ok: false, error: 'This action is locked.' }
  return null
}

// Super-admin viewing a tenant has a synthetic membership id ('super-admin')
// that doesn't exist in tenant_users — null it so the FK passes.
function safeTenantUserId(ctx: Awaited<ReturnType<typeof requireRequestContext>>): string | null {
  const id = ctx.membership?.id
  if (!id || id === 'super-admin') return null
  return id
}

// ---------- Photos -------------------------------------------------------

/**
 * Bind a batch of just-uploaded attachment IDs to a CA. Called from the
 * PhotoUploaderSection after FileUpload finalises each file.
 */
export async function attachCaPhotos(caId: string, attachmentIds: string[]): Promise<ActionResult> {
  if (attachmentIds.length === 0) return { ok: true }
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
  const ca = await loadCA(ctx, caId)
  if (!ca) return { ok: false, error: 'Corrective action not found.' }
  const lockErr = assertNotLocked(ca)
  if (lockErr) return lockErr

  await ctx.db((tx) =>
    tx.insert(caPhotos).values(
      attachmentIds.map((attachmentId) => ({
        tenantId: ctx.tenantId,
        caId,
        attachmentId,
      })),
    ),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: caId,
    action: 'update',
    summary: `Attached ${attachmentIds.length} photo${attachmentIds.length === 1 ? '' : 's'}`,
    metadata: { attachmentIds },
  })
  revalidatePath(`/corrective-actions/${caId}`)
  return { ok: true }
}

export async function updateCaPhotoCaption(
  caId: string,
  photoId: string,
  caption: string,
): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
  const ca = await loadCA(ctx, caId)
  if (!ca) return { ok: false, error: 'Corrective action not found.' }
  const lockErr = assertNotLocked(ca)
  if (lockErr) return lockErr

  await ctx.db((tx) =>
    tx
      .update(caPhotos)
      .set({ caption: caption.trim() || null })
      .where(and(eq(caPhotos.id, photoId), eq(caPhotos.caId, caId))),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: caId,
    action: 'update',
    summary: 'Updated photo caption',
    metadata: { photoId, caption },
  })
  revalidatePath(`/corrective-actions/${caId}`)
  return { ok: true }
}

export async function deleteCaPhoto(caId: string, photoId: string): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
  const ca = await loadCA(ctx, caId)
  if (!ca) return { ok: false, error: 'Corrective action not found.' }
  const lockErr = assertNotLocked(ca)
  if (lockErr) return lockErr

  await ctx.db((tx) =>
    tx.delete(caPhotos).where(and(eq(caPhotos.id, photoId), eq(caPhotos.caId, caId))),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: caId,
    action: 'delete',
    summary: 'Removed photo',
    metadata: { photoId },
  })
  revalidatePath(`/corrective-actions/${caId}`)
  return { ok: true }
}

// ---------- Complete-action flow ----------------------------------------

/**
 * Record one step in the multi-stage complete-action workflow:
 *   - 'action_taken'  — the assignee documents the fix
 *   - 'verification'  — the verifier signs off (if verificationRequired)
 *   - 'signature'     — captured wet-ink signature data URL
 */
export async function appendCompleteStep(args: {
  caId: string
  kind: 'action_taken' | 'verification' | 'signature'
  description?: string | null
  signatureDataUrl?: string | null
}): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
  const ca = await loadCA(ctx, args.caId)
  if (!ca) return { ok: false, error: 'Corrective action not found.' }
  const lockErr = assertNotLocked(ca)
  if (lockErr) return lockErr

  return insertCompleteStep(ctx, args)
}

// Timeline-step writer shared by the exported `appendCompleteStep` action and
// the verify/close flows. The callers are responsible for their own permission
// gate + lock check; this only performs the insert + audit so a verifier
// (ca.verify, not necessarily ca.update) can still record their sign-off step.
async function insertCompleteStep(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  args: {
    caId: string
    kind: 'action_taken' | 'verification' | 'signature'
    description?: string | null
    signatureDataUrl?: string | null
  },
): Promise<ActionResult> {
  const [nextOrder] = await ctx.db((tx) =>
    tx
      .select({
        n: sql<number>`COALESCE(MAX(${caCompleteSteps.entityOrder}), 0) + 1`,
      })
      .from(caCompleteSteps)
      .where(eq(caCompleteSteps.caId, args.caId)),
  )

  await ctx.db((tx) =>
    tx.insert(caCompleteSteps).values({
      tenantId: ctx.tenantId,
      caId: args.caId,
      kind: args.kind,
      description: args.description?.trim() || null,
      signatureDataUrl: args.signatureDataUrl ?? null,
      completedByTenantUserId: safeTenantUserId(ctx),
      entityOrder: Number(nextOrder?.n ?? 1),
    }),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: args.caId,
    action: 'sign',
    summary: `Recorded ${args.kind.replace('_', ' ')} step`,
    metadata: { kind: args.kind },
  })
  revalidatePath(`/corrective-actions/${args.caId}`)
  return { ok: true }
}

// ---------- Verification ------------------------------------------------

/**
 * Record verifier sign-off. Sets `verifiedAt`, `verifiedByTenantUserId` and
 * stores the notes. Does not auto-close the CA — that's still an explicit
 * status transition through `closeCorrectiveAction`.
 */
export async function verifyCorrectiveAction(args: {
  caId: string
  notes: string
  signatureDataUrl?: string | null
}): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.verify')
  const ca = await loadCA(ctx, args.caId)
  if (!ca) return { ok: false, error: 'Corrective action not found.' }
  const lockErr = assertNotLocked(ca)
  if (lockErr) return lockErr
  if (!ca.verificationRequired) {
    return { ok: false, error: 'Verification is not required for this action.' }
  }

  const verifierId = safeTenantUserId(ctx)

  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({
        verifiedAt: new Date(),
        verifiedByTenantUserId: verifierId,
        verificationNotes: args.notes.trim() || null,
        status: 'pending_verification',
      })
      .where(eq(correctiveActions.id, args.caId)),
  )

  // Persist the verification step + optional signature on the timeline so it
  // shows up in the CA "Complete steps" panel.
  await insertCompleteStep(ctx, {
    caId: args.caId,
    kind: 'verification',
    description: args.notes,
    signatureDataUrl: args.signatureDataUrl,
  })

  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: args.caId,
    action: 'sign',
    summary: 'Verifier signed off',
    after: { verifiedAt: new Date().toISOString(), verifierId, verificationNotes: args.notes },
  })
  revalidatePath(`/corrective-actions/${args.caId}`)
  return { ok: true }
}

// ---------- Close (lock + cost impact) ----------------------------------

/**
 * Close + lock a CA in one shot, optionally recording a cost-impact figure
 * that the reports roll up. Emits a `corrective_action.completed` event so
 * downstream notifications/jobs fire (handled elsewhere).
 */
export async function closeCorrectiveAction(args: {
  caId: string
  costImpact?: string | null
  closeNotes?: string | null
}): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
  const ca = await loadCA(ctx, args.caId)
  if (!ca) return { ok: false, error: 'Corrective action not found.' }
  if (ca.locked) return { ok: false, error: 'Already closed and locked.' }
  if (ca.verificationRequired && !ca.verifiedAt) {
    return {
      ok: false,
      error: 'Verification is required before closing this action.',
    }
  }

  const cost = args.costImpact?.trim()
  const parsedCost = cost && /^[0-9]+(\.[0-9]{1,2})?$/.test(cost) ? cost : null

  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({
        status: 'closed',
        locked: true,
        closedAt: new Date(),
        costImpact: parsedCost as any,
      })
      .where(eq(correctiveActions.id, args.caId)),
  )
  if (args.closeNotes && args.closeNotes.trim().length > 0) {
    await insertCompleteStep(ctx, {
      caId: args.caId,
      kind: 'action_taken',
      description: `Close note: ${args.closeNotes.trim()}`,
    })
  }
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: args.caId,
    action: 'update',
    summary: 'Closed + locked',
    after: { status: 'closed', closedAt: new Date().toISOString(), costImpact: parsedCost },
  })
  await emitCorrectiveActionCompleted(ctx, { caId: args.caId, completerUserId: ctx.userId })
  await emitCorrectiveActionClosed(ctx, {
    id: args.caId,
    reference: ca.reference,
    title: ca.title,
    status: 'closed',
    severity: ca.severity,
    closedAt: new Date(),
  }).catch(() => {})
  await runModuleFlows(ctx, {
    moduleKey: 'corrective-actions',
    event: 'status_change',
    subjectId: args.caId,
    toStatus: 'closed',
  })
  revalidatePath(`/corrective-actions/${args.caId}`)
  revalidatePath('/corrective-actions')
  revalidatePath('/corrective-actions/reports/overdue')
  revalidatePath('/corrective-actions/reports/aging')
  return { ok: true }
}

/**
 * Reopen a closed CA. Clears the lock + closedAt + verification stamp so the
 * workflow can be re-run cleanly.
 */
export async function reopenCorrectiveAction(caId: string): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
  const ca = await loadCA(ctx, caId)
  if (!ca) return { ok: false, error: 'Corrective action not found.' }
  if (!ca.locked && ca.status !== 'closed') {
    return { ok: false, error: 'Action is not closed.' }
  }
  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({
        status: 'in_progress',
        locked: false,
        closedAt: null,
        verifiedAt: null,
        verifiedByTenantUserId: null,
      })
      .where(eq(correctiveActions.id, caId)),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: caId,
    action: 'update',
    summary: 'Reopened',
  })
  revalidatePath(`/corrective-actions/${caId}`)
  revalidatePath('/corrective-actions')
  return { ok: true }
}

// ---------- Email --------------------------------------------------------

/**
 * Send a notification email containing a link to the CA detail page. Returns
 * `ok: true` even if no recipients were resolved — the audit log captures
 * the attempt either way. The actual delivery is best-effort via the events
 * package; if no SMTP is configured this is effectively a no-op.
 */
export async function sendCorrectiveActionEmail(args: {
  caId: string
  recipients: string[]
  message?: string | null
}): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'ca.read.all') && !can(ctx, 'ca.read.site') && !can(ctx, 'ca.read.self')) {
    return { ok: false, error: 'Not authorized.' }
  }
  const ca = await loadCA(ctx, args.caId)
  if (!ca) return { ok: false, error: 'Corrective action not found.' }

  const cleaned = Array.from(
    new Set(
      args.recipients
        .flatMap((r) => r.split(/[,;\s]+/g))
        .map((r) => r.trim())
        .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)),
    ),
  )

  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: args.caId,
    action: 'export',
    summary:
      cleaned.length > 0
        ? `Sent email to ${cleaned.length} recipient${cleaned.length === 1 ? '' : 's'}`
        : 'Email send requested (no valid recipients)',
    metadata: {
      recipients: cleaned,
      message: args.message ?? null,
      link: `/corrective-actions/${args.caId}`,
    },
  })
  revalidatePath(`/corrective-actions/${args.caId}`)
  return { ok: true }
}

// ---------- Bulk reassign ------------------------------------------------

/**
 * Re-assign a batch of CAs to a single owner. Skips locked rows; writes one
 * audit-log entry per row so each detail page sees the change in its own
 * timeline.
 */
export async function bulkReassignCorrectiveActions(args: {
  caIds: string[]
  newOwnerTenantUserId: string
}): Promise<{ ok: true; updated: number; skipped: number } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
  if (args.caIds.length === 0) return { ok: false, error: 'No actions selected.' }
  if (!args.newOwnerTenantUserId) return { ok: false, error: 'Pick an owner.' }

  // Confirm the new owner is a real active member of this tenant.
  const ownerExists = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(
        and(eq(tenantUsers.id, args.newOwnerTenantUserId), eq(tenantUsers.tenantId, ctx.tenantId)),
      )
      .limit(1)
    return Boolean(r)
  })
  if (!ownerExists) return { ok: false, error: 'Owner is not a member of this tenant.' }

  const ids = args.caIds.slice(0, 500)
  const rows = await ctx.db((tx) =>
    tx
      .select({
        id: correctiveActions.id,
        locked: correctiveActions.locked,
        ownerTenantUserId: correctiveActions.ownerTenantUserId,
      })
      .from(correctiveActions)
      .where(inArray(correctiveActions.id, ids)),
  )
  const editable = rows.filter((r) => !r.locked).map((r) => r.id)
  const skipped = rows.length - editable.length

  if (editable.length === 0) {
    return { ok: true, updated: 0, skipped }
  }

  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({ ownerTenantUserId: args.newOwnerTenantUserId })
      .where(inArray(correctiveActions.id, editable)),
  )

  for (const id of editable) {
    await recordAudit(ctx, {
      entityType: 'corrective_action',
      entityId: id,
      action: 'update',
      summary: 'Bulk reassigned',
      after: { ownerTenantUserId: args.newOwnerTenantUserId },
    })
  }
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    action: 'update',
    summary: `Bulk reassigned ${editable.length} action${editable.length === 1 ? '' : 's'}`,
    metadata: {
      caIds: editable,
      skipped,
      newOwnerTenantUserId: args.newOwnerTenantUserId,
    },
  })

  revalidatePath('/corrective-actions')
  revalidatePath('/corrective-actions/reports/by-assignee')
  return { ok: true, updated: editable.length, skipped }
}

// ---------- Misc edits --------------------------------------------------

export async function setVerificationRequired(
  caId: string,
  required: boolean,
): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
  const ca = await loadCA(ctx, caId)
  if (!ca) return { ok: false, error: 'Corrective action not found.' }
  const lockErr = assertNotLocked(ca)
  if (lockErr) return lockErr
  await ctx.db((tx) =>
    tx
      .update(correctiveActions)
      .set({ verificationRequired: required })
      .where(eq(correctiveActions.id, caId)),
  )
  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: caId,
    action: 'update',
    summary: required ? 'Verification required' : 'Verification waived',
    after: { verificationRequired: required },
  })
  revalidatePath(`/corrective-actions/${caId}`)
  return { ok: true }
}

// ---------- Lookups (used by bulk-reassign + verification UI) -----------

export async function listTenantOwners(): Promise<
  { id: string; name: string; email: string | null }[]
> {
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: tenantUsers.id,
        displayName: tenantUsers.displayName,
        name: user.name,
        email: user.email,
      })
      .from(tenantUsers)
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(and(eq(tenantUsers.tenantId, ctx.tenantId), eq(tenantUsers.status, 'active')))
      .orderBy(asc(user.name))
    return rows.map((r) => ({
      id: r.id,
      name: r.displayName ?? r.name ?? 'Unnamed user',
      email: r.email,
    }))
  })
}
