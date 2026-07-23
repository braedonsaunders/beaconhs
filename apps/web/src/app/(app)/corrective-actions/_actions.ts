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
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import {
  caCompleteSteps,
  caPhotos,
  correctiveActions,
  attachments,
  orgUnits,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import { moduleFlowCommand, recordDomainEvent } from '@beaconhs/events'
import { correctiveActionClosedEvent } from '@beaconhs/integrations'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { appBaseUrl } from '@/lib/app-base-url'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { withStoredSignatureAttachment } from '@/lib/signature-storage'
import { canSeeRecord, moduleScopeWhere } from '@/lib/visibility'
import { requireUuidArrayInput, requireUuidInput } from '@/lib/mutation-input'
import { parsePhotoEdits } from '@/lib/photo-edits'
import { validateTenantImageAttachmentIdsInTx } from '@/lib/attachment-validation'
import { isUuid } from '@/lib/list-params'

type ActionResult = { ok: true } | { ok: false; error: string }

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

  const result = await ctx.db(async (tx) => {
    const [current] = await tx
      .select({ locked: correctiveActions.locked })
      .from(correctiveActions)
      .where(and(eq(correctiveActions.tenantId, ctx.tenantId), eq(correctiveActions.id, caId)))
      .limit(1)
      .for('update')
    if (!current) return { ok: false as const, error: 'Corrective action not found.' }
    if (current.locked) return { ok: false as const, error: 'This action is locked.' }
    const validIds = await validateTenantImageAttachmentIdsInTx(tx, ctx.tenantId, attachmentIds)
    const existing = await tx
      .select({ attachmentId: caPhotos.attachmentId, sortOrder: caPhotos.sortOrder })
      .from(caPhotos)
      .where(and(eq(caPhotos.tenantId, ctx.tenantId), eq(caPhotos.caId, caId)))
    const existingIds = new Set(existing.map((photo) => photo.attachmentId))
    const newAttachmentIds = validIds.filter((attachmentId) => !existingIds.has(attachmentId))
    if (newAttachmentIds.length === 0) return { ok: true as const }
    const baseSortOrder =
      existing.reduce((maximum, photo) => Math.max(maximum, photo.sortOrder), -1) + 1
    await tx.insert(caPhotos).values(
      newAttachmentIds.map((attachmentId, index) => ({
        tenantId: ctx.tenantId,
        caId,
        attachmentId,
        sortOrder: baseSortOrder + index,
      })),
    )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'corrective_action',
      entityId: caId,
      action: 'update',
      summary: `Attached ${newAttachmentIds.length} photo${newAttachmentIds.length === 1 ? '' : 's'}`,
      metadata: { attachmentIds: newAttachmentIds },
    })
    return { ok: true as const }
  })
  if (!result.ok) return result
  revalidatePath(`/corrective-actions/${caId}`)
  return { ok: true }
}

export async function updateCaPhoto(
  caId: string,
  photoId: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
  const ca = await loadCA(ctx, caId)
  if (!ca) return { ok: false, error: 'Corrective action not found.' }
  const lockErr = assertNotLocked(ca)
  if (lockErr) return lockErr
  const edits = parsePhotoEdits(input)

  const changed = await ctx.db(async (tx) => {
    const [current] = await tx
      .select({ locked: correctiveActions.locked })
      .from(correctiveActions)
      .where(and(eq(correctiveActions.tenantId, ctx.tenantId), eq(correctiveActions.id, caId)))
      .limit(1)
      .for('update')
    if (!current || current.locked) return false
    const [photo] = await tx
      .select({ attachmentId: caPhotos.attachmentId })
      .from(caPhotos)
      .where(
        and(eq(caPhotos.tenantId, ctx.tenantId), eq(caPhotos.id, photoId), eq(caPhotos.caId, caId)),
      )
      .limit(1)
      .for('update')
    if (!photo) return false
    await tx
      .update(caPhotos)
      .set({ caption: edits.caption })
      .where(
        and(eq(caPhotos.tenantId, ctx.tenantId), eq(caPhotos.id, photoId), eq(caPhotos.caId, caId)),
      )
    await tx
      .update(attachments)
      .set({ annotations: edits.annotations })
      .where(
        and(
          eq(attachments.tenantId, ctx.tenantId),
          eq(attachments.id, photo.attachmentId),
          eq(attachments.kind, 'image'),
        ),
      )
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'corrective_action',
      entityId: caId,
      action: 'update',
      summary: 'Updated photo caption and markup',
      metadata: { photoId, annotationCount: edits.annotations?.length ?? 0 },
    })
    return true
  })
  if (!changed) return { ok: false, error: 'Photo not found.' }
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

  const removed = await ctx.db(async (tx) => {
    const [current] = await tx
      .select({ locked: correctiveActions.locked })
      .from(correctiveActions)
      .where(and(eq(correctiveActions.tenantId, ctx.tenantId), eq(correctiveActions.id, caId)))
      .limit(1)
      .for('update')
    if (!current || current.locked) return false
    const rows = await tx
      .delete(caPhotos)
      .where(
        and(eq(caPhotos.tenantId, ctx.tenantId), eq(caPhotos.id, photoId), eq(caPhotos.caId, caId)),
      )
      .returning({ id: caPhotos.id })
    if (rows.length === 0) return false
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'corrective_action',
      entityId: caId,
      action: 'delete',
      summary: 'Removed photo',
      metadata: { photoId },
    })
    return true
  })
  if (!removed) return { ok: false, error: 'Photo not found.' }
  revalidatePath(`/corrective-actions/${caId}`)
  return { ok: true }
}

export async function reorderCaPhotos(caId: string, photoIds: string[]): Promise<ActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'ca.update')
  if (
    !isUuid(caId) ||
    photoIds.some((photoId) => !isUuid(photoId)) ||
    new Set(photoIds).size !== photoIds.length
  ) {
    return { ok: false, error: 'Photo order is invalid.' }
  }
  const ca = await loadCA(ctx, caId)
  if (!ca) return { ok: false, error: 'Corrective action not found.' }
  const lockErr = assertNotLocked(ca)
  if (lockErr) return lockErr
  const changed = await ctx.db(async (tx) => {
    const [currentAction] = await tx
      .select({ locked: correctiveActions.locked })
      .from(correctiveActions)
      .where(and(eq(correctiveActions.tenantId, ctx.tenantId), eq(correctiveActions.id, caId)))
      .limit(1)
      .for('update')
    if (!currentAction || currentAction.locked) return false
    const current = await tx
      .select({ id: caPhotos.id })
      .from(caPhotos)
      .where(and(eq(caPhotos.tenantId, ctx.tenantId), eq(caPhotos.caId, caId)))
      .orderBy(asc(caPhotos.sortOrder), asc(caPhotos.createdAt), asc(caPhotos.id))
      .for('update')
    const previousIds = current.map((photo) => photo.id)
    if (
      previousIds.length !== photoIds.length ||
      previousIds.some((photoId) => !photoIds.includes(photoId))
    ) {
      return false
    }
    if (previousIds.every((photoId, index) => photoId === photoIds[index])) return true
    for (const [sortOrder, photoId] of photoIds.entries()) {
      await tx
        .update(caPhotos)
        .set({ sortOrder })
        .where(
          and(
            eq(caPhotos.tenantId, ctx.tenantId),
            eq(caPhotos.caId, caId),
            eq(caPhotos.id, photoId),
          ),
        )
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'corrective_action',
      entityId: caId,
      action: 'update',
      summary: 'Reordered photos',
      before: { photoIds: previousIds },
      after: { photoIds },
    })
    return true
  })
  if (!changed) return { ok: false, error: 'Photos changed before they could be reordered.' }
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
  await withStoredSignatureAttachment(ctx, args.signatureDataUrl, async (tx, attachmentId) => {
    const [nextOrder] = await tx
      .select({
        n: sql<number>`COALESCE(MAX(${caCompleteSteps.entityOrder}), 0) + 1`,
      })
      .from(caCompleteSteps)
      .where(eq(caCompleteSteps.caId, args.caId))

    await tx.insert(caCompleteSteps).values({
      tenantId: ctx.tenantId,
      caId: args.caId,
      kind: args.kind,
      description: args.description?.trim() || null,
      signatureAttachmentId: attachmentId,
      completedByTenantUserId: safeTenantUserId(ctx),
      entityOrder: Number(nextOrder?.n ?? 1),
    })
  })
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

  // Verifying a CA that is still open/in-progress is a real status transition,
  // so it must fire the same flows + completed event the header status dropdown
  // fires. A CA already sitting at pending_verification keeps its status
  // untouched (no double-fired automations).
  const transitioning = ca.status !== 'pending_verification'

  const verified = await ctx.db(async (tx) => {
    const [updated] = await tx
      .update(correctiveActions)
      .set({
        verifiedAt: new Date(),
        verifiedByTenantUserId: verifierId,
        verificationNotes: args.notes.trim() || null,
        ...(transitioning ? { status: 'pending_verification' as const } : {}),
      })
      .where(
        and(
          eq(correctiveActions.id, args.caId),
          eq(correctiveActions.locked, false),
          eq(correctiveActions.status, ca.status),
        ),
      )
      .returning({ id: correctiveActions.id })
    if (updated && transitioning) {
      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'corrective_action.completed',
        subjectId: args.caId,
        dedupKey: `corrective_action.completed:${args.caId}:${randomUUID()}`,
        payload: {
          notification: {
            kind: 'corrective_action_completed',
            caId: args.caId,
          },
          web: moduleFlowCommand(ctx, {
            subjectId: args.caId,
            moduleKey: 'corrective-actions',
            event: 'status_change',
            toStatus: 'pending_verification',
          }),
        },
      })
    }
    return Boolean(updated)
  })
  if (!verified) {
    return { ok: false, error: 'The corrective action changed before it could be verified.' }
  }

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
  if (transitioning) revalidatePath('/corrective-actions')
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

  const closedAt = new Date()
  const closed = await ctx.db(async (tx) => {
    const [updated] = await tx
      .update(correctiveActions)
      .set({
        status: 'closed',
        locked: true,
        closedAt,
        costImpact: parsedCost as any,
      })
      .where(and(eq(correctiveActions.id, args.caId), eq(correctiveActions.locked, false)))
      .returning({ id: correctiveActions.id })
    if (!updated) return false
    await recordDomainEvent(tx, {
      tenantId: ctx.tenantId,
      eventType: 'corrective_action.closed',
      subjectId: args.caId,
      dedupKey: `corrective_action.closed:${args.caId}:${closedAt.toISOString()}`,
      payload: {
        notification: {
          kind: 'corrective_action_completed',
          caId: args.caId,
        },
        integration: correctiveActionClosedEvent(ctx.tenantId, {
          id: args.caId,
          reference: ca.reference,
          title: ca.title,
          status: 'closed',
          severity: ca.severity,
          closedAt,
        }),
        web: moduleFlowCommand(ctx, {
          subjectId: args.caId,
          moduleKey: 'corrective-actions',
          event: 'status_change',
          toStatus: 'closed',
        }),
      },
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'corrective_action',
      entityId: args.caId,
      action: 'update',
      summary: 'Closed + locked',
      after: { status: 'closed', closedAt: closedAt.toISOString(), costImpact: parsedCost },
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'corrective_action',
      targetRef: {},
    })
    return true
  })
  if (!closed) return { ok: false, error: 'This corrective action is already closed.' }
  if (args.closeNotes && args.closeNotes.trim().length > 0) {
    await insertCompleteStep(ctx, {
      caId: args.caId,
      kind: 'action_taken',
      description: `Close note: ${args.closeNotes.trim()}`,
    })
  }
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
  await ctx.db(async (tx) => {
    await tx
      .update(correctiveActions)
      .set({
        status: 'in_progress',
        locked: false,
        closedAt: null,
        verifiedAt: null,
        verifiedByTenantUserId: null,
      })
      .where(eq(correctiveActions.id, caId))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'corrective_action',
      entityId: caId,
      action: 'update',
      summary: 'Reopened',
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'corrective_action',
      targetRef: {},
    })
  })
  revalidatePath(`/corrective-actions/${caId}`)
  revalidatePath('/corrective-actions')
  return { ok: true }
}

// ---------- Email --------------------------------------------------------

/**
 * Email a corrective-action summary (with a link to the detail page) to an
 * explicit list of recipients. Delivery goes through the BullMQ email queue so
 * the worker captures an email_log row and retries on failure; the audit row
 * records the queued send.
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

  const to = Array.from(
    new Set(
      args.recipients
        .flatMap((r) => r.split(/[,;\s]+/g))
        .map((r) => r.trim())
        .filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)),
    ),
  )
  if (to.length === 0) return { ok: false, error: 'Add at least one valid email address.' }

  const names = await ctx.db(async (tx) => {
    const [siteRow] = ca.siteOrgUnitId
      ? await tx
          .select({ name: orgUnits.name })
          .from(orgUnits)
          .where(eq(orgUnits.id, ca.siteOrgUnitId))
          .limit(1)
      : []
    const [ownerRow] = ca.ownerTenantUserId
      ? await tx
          .select({ displayName: tenantUsers.displayName, name: user.name })
          .from(tenantUsers)
          .leftJoin(user, eq(user.id, tenantUsers.userId))
          .where(eq(tenantUsers.id, ca.ownerTenantUserId))
          .limit(1)
      : []
    return {
      site: siteRow?.name ?? null,
      owner: ownerRow?.name ?? ownerRow?.displayName ?? null,
    }
  })

  const appUrl = appBaseUrl()
  const caUrl = `${appUrl}/corrective-actions/${args.caId}`
  const subject = `Corrective action ${ca.reference} · ${ca.title}`
  const message = args.message?.trim() || null

  const text = [
    `CORRECTIVE ACTION`,
    `${ca.reference} · ${ca.title}`,
    ``,
    `Severity: ${ca.severity}`,
    `Status: ${ca.status.replace(/_/g, ' ')}`,
    `Owner: ${names.owner ?? '—'}`,
    `Site: ${names.site ?? '—'}`,
    `Assigned on: ${ca.assignedOn ?? '—'}`,
    `Due on: ${ca.dueOn ?? '—'}`,
    ``,
    message ? `Note: ${message}\n` : '',
    `Description:`,
    ca.description ?? '(none)',
    ``,
    ca.rootCause ? `Root cause:\n${ca.rootCause}\n` : '',
    ca.actionTaken ? `Action taken:\n${ca.actionTaken}\n` : '',
    `View the record: ${caUrl}`,
  ]
    .filter((line) => line !== '')
    .join('\n')

  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:720px;">
      <h2 style="margin:0 0 4px;font-size:18px;">${escapeHtml(ca.title)}</h2>
      <div style="color:#64748b;font-size:13px;margin-bottom:12px;">
        ${escapeHtml(ca.reference)} ·
        severity ${escapeHtml(ca.severity)} ·
        status ${escapeHtml(ca.status.replace(/_/g, ' '))}
      </div>
      ${
        message
          ? `<div style="border-left:3px solid #0f766e;padding:8px 12px;background:#ecfdf5;margin-bottom:12px;font-size:13px;">${escapeHtml(message)}</div>`
          : ''
      }
      <table style="border-collapse:collapse;font-size:13px;margin-bottom:12px;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Owner</td>
            <td style="padding:4px 0;">${escapeHtml(names.owner ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Site</td>
            <td style="padding:4px 0;">${escapeHtml(names.site ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Assigned on</td>
            <td style="padding:4px 0;">${escapeHtml(ca.assignedOn ?? '—')}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Due on</td>
            <td style="padding:4px 0;">${escapeHtml(ca.dueOn ?? '—')}</td></tr>
      </table>
      <h3 style="margin:18px 0 4px;font-size:14px;">Description</h3>
      <div style="font-size:13px;white-space:pre-wrap;">${escapeHtml(ca.description ?? '(none)')}</div>
      ${
        ca.rootCause
          ? `<h3 style="margin:18px 0 4px;font-size:14px;">Root cause</h3>
             <div style="font-size:13px;white-space:pre-wrap;">${escapeHtml(ca.rootCause)}</div>`
          : ''
      }
      ${
        ca.actionTaken
          ? `<h3 style="margin:18px 0 4px;font-size:14px;">Action taken</h3>
             <div style="font-size:13px;white-space:pre-wrap;">${escapeHtml(ca.actionTaken)}</div>`
          : ''
      }
      <p style="margin:18px 0 0;font-size:13px;">
        <a href="${escapeHtml(caUrl)}" style="color:#0f766e;">Open the corrective action</a>
      </p>
    </div>
  `

  // Enqueue via BullMQ so the worker captures an email_log row + retries on
  // failure (mirrors the hazard-assessment / document send helpers).
  const { enqueueEmail } = await import('@beaconhs/jobs')
  await enqueueEmail({
    to,
    subject,
    html,
    text,
    meta: {
      tenantId: ctx.tenantId,
      category: 'corrective_action_send',
      userId: ctx.userId,
    },
  })

  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: args.caId,
    action: 'export',
    summary: `Emailed corrective action to ${to.length} recipient${to.length === 1 ? '' : 's'}`,
    metadata: {
      recipients: to,
      message,
      link: `/corrective-actions/${args.caId}`,
    },
  })
  revalidatePath(`/corrective-actions/${args.caId}`)
  return { ok: true }
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
  if (!can(ctx, 'ca.update')) {
    return { ok: false, error: 'You do not have permission to update corrective actions.' }
  }
  let ids: string[]
  let newOwnerTenantUserId: string
  try {
    if (!args || typeof args !== 'object') throw new Error('Bulk reassignment is invalid.')
    ids = requireUuidArrayInput(args.caIds, 'Selected actions', { max: 500 })
    newOwnerTenantUserId = requireUuidInput(args.newOwnerTenantUserId, 'Owner')
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid request.' }
  }

  const reassignmentEventId = randomUUID()
  const result = await ctx.db(async (tx) => {
    // Hold the membership row for the duration of the reassignment so the
    // owner cannot be deactivated between validation and the business write.
    const [owner] = await tx
      .select({ id: tenantUsers.id })
      .from(tenantUsers)
      .where(
        and(
          eq(tenantUsers.id, newOwnerTenantUserId),
          eq(tenantUsers.tenantId, ctx.tenantId),
          eq(tenantUsers.status, 'active'),
        ),
      )
      .limit(1)
      .for('update')
    if (!owner) return { kind: 'invalid-owner' as const }

    // Re-scope to the caller's read tier so a self/site-tier user can't drive
    // corrective actions they cannot see by posting guessed ids (mirrors the
    // loadCA guard on the single-record mutations).
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'ca',
      ownerCols: [correctiveActions.ownerTenantUserId],
      siteCol: correctiveActions.siteOrgUnitId,
    })
    const rows = await tx
      .select({
        id: correctiveActions.id,
        locked: correctiveActions.locked,
        ownerTenantUserId: correctiveActions.ownerTenantUserId,
      })
      .from(correctiveActions)
      .where(and(inArray(correctiveActions.id, ids), vis))
      .for('update')
    const editable = rows.filter((row) => !row.locked).map((row) => row.id)
    // Out-of-scope / unknown ids never come back from the scoped select, so
    // count everything that wasn't updated as skipped.
    if (editable.length === 0) {
      return { kind: 'updated' as const, ids: [] as string[], skipped: ids.length }
    }

    const changed = await tx
      .update(correctiveActions)
      .set({ ownerTenantUserId: newOwnerTenantUserId })
      .where(and(inArray(correctiveActions.id, editable), eq(correctiveActions.locked, false)))
      .returning({ id: correctiveActions.id })
    for (const { id } of changed) {
      await recordDomainEvent(tx, {
        tenantId: ctx.tenantId,
        eventType: 'corrective_action.assigned',
        subjectId: id,
        dedupKey: `corrective_action.assigned:${id}:${reassignmentEventId}`,
        payload: {
          notification: { kind: 'corrective_action_assigned', caId: id },
        },
      })
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'corrective_action',
        entityId: id,
        action: 'update',
        summary: 'Bulk reassigned',
        after: { ownerTenantUserId: newOwnerTenantUserId },
      })
    }
    const skipped = ids.length - changed.length
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'corrective_action',
      action: 'update',
      summary: `Bulk reassigned ${changed.length} action${changed.length === 1 ? '' : 's'}`,
      metadata: {
        caIds: changed.map((row) => row.id),
        skipped,
        newOwnerTenantUserId,
      },
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'corrective_action',
      targetRef: {},
    })
    return {
      kind: 'updated' as const,
      ids: changed.map((row) => row.id),
      skipped,
    }
  })
  if (result.kind === 'invalid-owner') {
    return { ok: false, error: 'Owner is not an active member of this tenant.' }
  }

  revalidatePath('/corrective-actions')
  revalidatePath('/corrective-actions/reports/by-assignee')
  return { ok: true, updated: result.ids.length, skipped: result.skipped }
}
