// Server-side draft persistence for Builder responses.
//
// Shared by the `createDraftResponse` Server Action and the
// /api/apps/draft-save route (the guided fill page's local-first sync queue
// and its unload beacon), which saves whole-draft snapshots. Record-page
// field edits go through /api/records/sync instead (see record-edits.ts).
// Kept out of the 'use server' actions module on purpose: these helpers take
// a trusted request context argument and must never be exposed as
// client-callable Server Actions.

import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { isFormResponseParentLockedError, lockFormResponseForMutation } from '@beaconhs/db'
import {
  formResponses,
  formTemplateVersions,
  type FormResponseDraftData,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { normalizeFormResponseDraftData, validateResponse } from '@beaconhs/forms-core'
import type { requireRequestContext } from '@/lib/auth'
import type { DraftSaveFailureReason } from '@/lib/offline-drafts/protocol'
import { recordAudit } from '@/lib/audit'
import { decideDraftSave } from '@/app/(app)/apps/_lib/draft-save-order'
import {
  canAccessResponseTemplate,
  canAccessTemplateById,
  canEditResponsePayload,
} from '@/app/(app)/apps/_lib/access'
import { loadApplicableFormObligation } from '@/lib/forms/form-compliance-obligation'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>
const uuidSchema = z.string().uuid()

export async function canFillTemplate(ctx: Ctx, templateId: string): Promise<boolean> {
  if (!uuidSchema.safeParse(templateId).success) return false
  return can(ctx, 'forms.response.create') && canAccessTemplateById(ctx, templateId, 'operate')
}

export async function canFillResponse(ctx: Ctx, responseId: string): Promise<boolean> {
  if (!uuidSchema.safeParse(responseId).success) return false
  // This helper gates mutations, not read-only record inspection. Historical
  // records may remain visible to a template builder, but an unpublished app
  // must never accept autosaves or inline edits.
  return canAccessResponseTemplate(ctx, responseId, 'operate')
}

type DraftFailure = { ok: false; error: string; reason: DraftSaveFailureReason; revision?: number }

// --- Draft creation ---------------------------------------------------------

/**
 * Create the empty draft row the autosave client writes against.
 *
 * With `responseId` the call is idempotent: the local-first filler mints the
 * id on the device so a queued create can be retried after a dropped
 * response without ever producing a second row. A retry that finds the row
 * already present succeeds only when it is this caller's draft for the same
 * template.
 */
export async function insertDraftResponse(
  ctx: Ctx,
  args: { templateId: string; complianceObligationId?: string | null; responseId?: string },
): Promise<{ ok: true; responseId: string } | DraftFailure> {
  if (
    !uuidSchema.safeParse(args.templateId).success ||
    (args.complianceObligationId != null &&
      !uuidSchema.safeParse(args.complianceObligationId).success) ||
    (args.responseId !== undefined && !uuidSchema.safeParse(args.responseId).success) ||
    !(await canFillTemplate(ctx, args.templateId))
  ) {
    return { ok: false, error: 'You do not have access to this app', reason: 'forbidden' }
  }
  try {
    return await ctx.db(async (tx): Promise<{ ok: true; responseId: string } | DraftFailure> => {
      const linkedObligation = args.complianceObligationId
        ? await loadApplicableFormObligation(tx, {
            tenantId: ctx.tenantId,
            obligationId: args.complianceObligationId,
            templateId: args.templateId,
            personId: ctx.personId,
          })
        : null
      if (args.complianceObligationId && !linkedObligation) {
        return {
          ok: false,
          error: 'This compliance task is not assigned to you',
          reason: 'forbidden',
        }
      }
      const [version] = await tx
        .select()
        .from(formTemplateVersions)
        .where(
          and(
            eq(formTemplateVersions.templateId, args.templateId),
            eq(formTemplateVersions.tenantId, ctx.tenantId),
            isNotNull(formTemplateVersions.publishedAt),
          ),
        )
        .orderBy(desc(formTemplateVersions.version))
        .limit(1)
      if (!version) return { ok: false, error: 'No published version', reason: 'forbidden' }

      const [inserted] = await tx
        .insert(formResponses)
        .values({
          ...(args.responseId ? { id: args.responseId } : {}),
          tenantId: ctx.tenantId,
          templateId: args.templateId,
          templateVersionId: version.id,
          complianceObligationId: linkedObligation?.id ?? null,
          status: 'draft',
          submittedBy: ctx.membership?.id ?? null,
          data: {},
        })
        .onConflictDoNothing({ target: formResponses.id })
        .returning({ id: formResponses.id })
      if (inserted) return { ok: true, responseId: inserted.id }
      if (!args.responseId) {
        return { ok: false, error: 'Failed to create draft', reason: 'unavailable' }
      }

      // Retried create: the row already exists. Accept it only if it is this
      // caller's own entry for the same template in this tenant.
      const [existing] = await tx
        .select({
          templateId: formResponses.templateId,
          submittedBy: formResponses.submittedBy,
        })
        .from(formResponses)
        .where(
          and(
            eq(formResponses.id, args.responseId),
            eq(formResponses.tenantId, ctx.tenantId),
            isNull(formResponses.deletedAt),
          ),
        )
        .limit(1)
      if (
        !existing ||
        existing.templateId !== args.templateId ||
        existing.submittedBy !== (ctx.membership?.id ?? null)
      ) {
        return { ok: false, error: 'Response not found', reason: 'not_found' }
      }
      return { ok: true, responseId: args.responseId }
    })
  } catch (err) {
    console.error('[forms] draft create failed', err)
    return { ok: false, error: 'Failed to create draft', reason: 'unavailable' }
  }
}

// --- Draft saves ------------------------------------------------------------

const draftInputSchema = z.object({
  responseId: uuidSchema,
  values: z.record(z.string(), z.unknown()),
  rows: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  stepIndex: z.number().int().min(0),
  clientSessionId: uuidSchema,
  clientSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
})

const draftSaveRequestSchema = draftInputSchema.extend({
  // The device scope the draft was saved under (checked by the sync route).
  scope: z.string().min(1).max(400),
  // Present while the draft row may not exist yet (a new entry whose id was
  // minted on the device). Creation is idempotent, so retries are safe.
  create: z
    .object({
      templateId: uuidSchema,
      complianceObligationId: uuidSchema.nullable(),
    })
    .optional(),
})

export type DraftSaveRequest = z.infer<typeof draftSaveRequestSchema>
type DraftSaveResult =
  { ok: true; savedAt: string; revision: number; sequence: number } | DraftFailure

/**
 * Save the in-flight draft state for a form response.
 *
 * Called by the client sync queue (debounced edits, step changes, retries)
 * and by the unload beacon, both through /api/apps/draft-save.
 *
 * Audits ONLY on first draft save in a session (when draft_updated_at was
 * null), not every keystroke. Keeps the audit log readable.
 *
 * Validation:
 *   - input shape via Zod
 *   - response belongs to active tenant (RLS via ctx.db)
 *   - response is in draft / in_progress status (no editing after submit)
 *   - response is owned by current user (submittedBy = ctx.membership.id) OR
 *     current user has the reviewer/manage tier
 *   - whole-draft ordering via `decideDraftSave` (session + sequence + revision)
 *
 * Does NOT bump any response version. The submit path is the only one that
 * writes to `data` / `compliance_*` / `submittedAt`.
 */
export async function saveDraftRequest(ctx: Ctx, input: unknown): Promise<DraftSaveResult> {
  const parsed = draftSaveRequestSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid draft payload', reason: 'invalid' }
  const { create, ...draft } = parsed.data
  if (create) {
    const created = await insertDraftResponse(ctx, {
      templateId: create.templateId,
      complianceObligationId: create.complianceObligationId,
      responseId: draft.responseId,
    })
    if (!created.ok) return created
  }
  return persistDraft(ctx, draft)
}

async function persistDraft(
  ctx: Ctx,
  draft: z.infer<typeof draftInputSchema>,
): Promise<DraftSaveResult> {
  if (!(await canFillResponse(ctx, draft.responseId))) {
    return { ok: false, error: 'You do not have access to this app', reason: 'forbidden' }
  }
  const now = new Date()

  try {
    const result = await ctx.db(
      async (
        tx,
      ): Promise<
        | {
            ok: true
            savedAt: string
            revision: number
            sequence: number
            wasFirstSave: boolean
          }
        | DraftFailure
      > => {
        const mutable = await lockFormResponseForMutation(tx, ctx.tenantId, draft.responseId)
        if (!mutable) return { ok: false, error: 'Response not found', reason: 'not_found' }
        const [row] = await tx
          .select({
            id: formResponses.id,
            status: formResponses.status,
            locked: formResponses.locked,
            submittedBy: formResponses.submittedBy,
            draftData: formResponses.draftData,
            draftUpdatedAt: formResponses.draftUpdatedAt,
            schema: formTemplateVersions.schema,
          })
          .from(formResponses)
          .innerJoin(
            formTemplateVersions,
            eq(formResponses.templateVersionId, formTemplateVersions.id),
          )
          .where(
            and(
              eq(formResponses.id, draft.responseId),
              eq(formResponses.tenantId, ctx.tenantId),
              isNull(formResponses.deletedAt),
            ),
          )
          .limit(1)

        if (!row) return { ok: false, error: 'Response not found', reason: 'not_found' }

        // Only drafts / in-progress responses accept autosave. Once submitted,
        // the client drops its device copy.
        if (row.status !== 'draft' && row.status !== 'in_progress') {
          return { ok: false, error: 'This response has already been submitted', reason: 'closed' }
        }
        if (row.locked) return { ok: false, error: 'This record is locked', reason: 'locked' }

        if (!canEditResponsePayload(ctx, row)) {
          return {
            ok: false,
            error: 'You do not have permission to edit this response',
            reason: 'forbidden',
          }
        }

        const order = decideDraftSave(row.draftData as FormResponseDraftData | null, {
          sessionId: draft.clientSessionId,
          sequence: draft.clientSequence,
          baseRevision: draft.baseRevision,
        })
        if (order.kind === 'conflict') {
          return {
            ok: false,
            error: 'This draft was changed in another tab or on another device.',
            reason: 'conflict',
            revision: order.revision,
          }
        }
        if (order.kind === 'superseded') {
          return {
            ok: true,
            savedAt: (row.draftUpdatedAt ?? now).toISOString(),
            revision: order.revision,
            sequence: order.sequence,
            wasFirstSave: false,
          }
        }

        const wasFirstSave = row.draftUpdatedAt === null
        const rawDraftErrors = validateResponse(
          row.schema,
          { ...draft.values, ...draft.rows },
          'draft',
        )
        if (rawDraftErrors.length > 0) {
          return {
            ok: false,
            error: rawDraftErrors[0]?.message ?? 'Invalid draft value',
            reason: 'invalid',
          }
        }

        const normalizedDraft = normalizeFormResponseDraftData(row.schema, draft.values, draft.rows)
        const draftErrors = validateResponse(
          row.schema,
          { ...normalizedDraft.values, ...normalizedDraft.rows },
          'draft',
        )
        if (draftErrors.length > 0) {
          return {
            ok: false,
            error: draftErrors[0]?.message ?? 'Invalid draft value',
            reason: 'invalid',
          }
        }

        const ownerUnchanged =
          row.submittedBy === null
            ? isNull(formResponses.submittedBy)
            : eq(formResponses.submittedBy, row.submittedBy)
        const [updated] = await tx
          .update(formResponses)
          .set({
            draftData: {
              values: normalizedDraft.values,
              rows: normalizedDraft.rows,
              saveSessionId: draft.clientSessionId,
              saveSequence: draft.clientSequence,
              saveRevision: order.nextRevision,
            },
            draftUpdatedAt: now,
            draftStepIndex: draft.stepIndex,
            // Adopt ownership on first save if it was unset.
            ...(row.submittedBy === null && ctx.membership?.id
              ? { submittedBy: ctx.membership.id }
              : {}),
            // Bump status to in_progress on the first content save so list
            // views can distinguish "empty shell" from "actively being filled".
            ...(row.status === 'draft' ? { status: 'in_progress' as const } : {}),
          })
          .where(
            and(
              eq(formResponses.id, draft.responseId),
              eq(formResponses.tenantId, ctx.tenantId),
              eq(formResponses.status, row.status),
              eq(formResponses.locked, false),
              isNull(formResponses.deletedAt),
              ownerUnchanged,
            ),
          )
          .returning({ id: formResponses.id })

        if (!updated) {
          // The row moved under us; the retry sees its new state.
          return {
            ok: false,
            error: 'This response changed before the draft could be saved',
            reason: 'unavailable',
          }
        }

        return {
          ok: true,
          savedAt: now.toISOString(),
          revision: order.nextRevision,
          sequence: draft.clientSequence,
          wasFirstSave,
        }
      },
    )

    if (!result.ok) return result

    // Audit ONLY on first draft save — one row per "started filling" event,
    // not per keystroke.
    if (result.wasFirstSave) {
      await recordAudit(ctx, {
        entityType: 'form_response',
        entityId: draft.responseId,
        action: 'create',
        summary: 'Started filling out form (draft saved)',
        metadata: { stepIndex: draft.stepIndex },
      })
    }

    return {
      ok: true,
      savedAt: result.savedAt,
      revision: result.revision,
      sequence: result.sequence,
    }
  } catch (err) {
    if (isFormResponseParentLockedError(err)) {
      return { ok: false, error: err.message, reason: 'locked' }
    }
    console.error('[forms] draft save failed', err)
    return { ok: false, error: 'Unable to save this draft right now', reason: 'unavailable' }
  }
}
