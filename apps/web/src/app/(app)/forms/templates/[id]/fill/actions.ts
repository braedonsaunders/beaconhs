'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { formResponses, formTemplateVersions, formTemplates } from '@beaconhs/db/schema'
import { extractScores, validateResponse } from '@beaconhs/forms-core'
import { formResponseScores } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import type { SafetyVisionAnalysis } from '@beaconhs/ai'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { analyzePhotoAttachments } from '@/app/(app)/forms/_lib/analyze-photos'
import { recordAudit } from '@/lib/audit'
import { computeFormScore } from '@/app/(app)/forms/_lib/score-router'
import { fetchSingleEntityAttrs } from '@/app/(app)/forms/_lib/entity-loader'
import { repopulateParticipants } from '@/app/(app)/forms/_lib/participants'
import { sendFormResponseRecapEmail } from '@/app/(app)/forms/_lib/recap-email'
import { runOnSubmitAutomations } from '@/app/(app)/forms/_lib/run-automations'

export async function submitFormResponse(args: {
  templateId: string
  data: Record<string, unknown>
  siteOrgUnitId?: string | null
  // Optional: when present, finalize this existing draft row instead of
  // inserting a new one. Set by the filler client whenever it has been
  // autosaving against a known response id.
  responseId?: string | null
}): Promise<{ ok: boolean; responseId?: string; errors?: { fieldId: string; message: string }[] }> {
  const ctx = await requireRequestContext()

  const result = await ctx.db(async (tx) => {
    const [version] = await tx
      .select()
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, args.templateId))
      .orderBy(desc(formTemplateVersions.version))
      .limit(1)
    if (!version) return { ok: false as const, errors: [{ fieldId: '', message: 'No version' }] }

    // Template category — denormalized onto participant rows below.
    const [tmpl] = await tx
      .select({ category: formTemplates.category })
      .from(formTemplates)
      .where(eq(formTemplates.id, args.templateId))
      .limit(1)

    const errors = validateResponse(version.schema, args.data, 'submit')
    if (errors.length > 0) return { ok: false as const, errors }

    // Compute compliance verdict from the score-router. Hoist repeating
    // section rows so any section-aware operators in scoreFormula resolve.
    const rows: Record<string, Array<Record<string, unknown>>> = {}
    for (const sec of version.schema.sections) {
      if (!sec.repeating) continue
      const v = args.data[sec.id]
      rows[sec.id] = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
    }
    const verdict = computeFormScore(version.schema, args.data, rows)

    const finalStatus =
      verdict.status === 'non_compliant' ? ('non_compliant' as const) : ('submitted' as const)

    // If the client already has a draft row (autosave was running), finalize
    // it in-place: keep the same id so deep links the user might have stay
    // valid, clear draft state, and stamp the submitted data on top.
    let resp: { id: string } | undefined = undefined
    if (args.responseId) {
      const [existing] = await tx
        .select({
          id: formResponses.id,
          status: formResponses.status,
        })
        .from(formResponses)
        .where(
          and(
            eq(formResponses.id, args.responseId),
            eq(formResponses.tenantId, ctx.tenantId),
          ),
        )
        .limit(1)
      // Only finalize if the row exists AND is still in a pre-submit state.
      // If someone else already submitted it we fall through to the insert
      // path below so the user's work isn't lost.
      if (
        existing &&
        (existing.status === 'draft' || existing.status === 'in_progress')
      ) {
        const [updated] = await tx
          .update(formResponses)
          .set({
            status: finalStatus,
            siteOrgUnitId: args.siteOrgUnitId ?? null,
            submittedBy: ctx.membership?.id,
            submittedAt: new Date(),
            data: args.data,
            complianceScore: String(verdict.score),
            complianceStatus: verdict.status,
            // Clear draft state — the row is no longer in-flight.
            draftData: null,
            draftUpdatedAt: null,
            draftStepIndex: null,
          })
          .where(eq(formResponses.id, args.responseId))
          .returning({ id: formResponses.id })
        resp = updated
      }
    }

    if (!resp) {
      const [inserted] = await tx
        .insert(formResponses)
        .values({
          tenantId: ctx.tenantId,
          templateId: args.templateId,
          templateVersionId: version.id,
          // Auto-flag the response. Workflow status is `submitted` for the
          // happy path; if scoring flagged us non_compliant, surface that as
          // the top-level status so list views immediately call it out.
          status: finalStatus,
          siteOrgUnitId: args.siteOrgUnitId ?? null,
          submittedBy: ctx.membership?.id,
          submittedAt: new Date(),
          data: args.data,
          complianceScore: String(verdict.score),
          complianceStatus: verdict.status,
        })
        .returning({ id: formResponses.id })
      resp = inserted
    }

    if (resp) {
      const scores = extractScores(version.schema, args.data)
      if (scores.length > 0) {
        await tx.insert(formResponseScores).values(
          scores.map((s) => ({
            tenantId: ctx.tenantId,
            responseId: resp.id,
            fieldId: s.fieldId,
            sectionId: s.sectionId,
            score: s.score,
            label: s.label,
            weight: s.weight,
          })),
        )
      }
      // Rebuild the participant index (attendees / person pickers) so it powers
      // transcripts, the form compliance kind, and reports.
      await repopulateParticipants(tx, {
        tenantId: ctx.tenantId,
        responseId: resp.id,
        templateId: args.templateId,
        category: tmpl?.category ?? null,
        schema: version.schema,
        data: args.data,
        submittedAt: new Date(),
      })
    }

    return {
      ok: true as const,
      responseId: resp?.id,
      verdict,
    }
  })

  if (result.ok && result.responseId) {
    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: result.responseId,
      action: 'create',
      summary:
        result.verdict.status === 'non_compliant'
          ? `Form submitted (auto-flagged non-compliant, score ${result.verdict.score})`
          : 'Form submitted',
      metadata: {
        complianceScore: result.verdict.score,
        complianceStatus: result.verdict.status,
        failedFieldKeys: result.verdict.failedFieldKeys,
      },
    })
    // Best-effort recap email — self-gates on the template's emailOnSubmit flag;
    // never block or fail the submit on email errors.
    try {
      await sendFormResponseRecapEmail(ctx, result.responseId)
    } catch {
      // swallow — email is non-critical
    }
    // Best-effort: run the template's on-submit Flow. Never block/fail submit.
    try {
      await runOnSubmitAutomations(ctx, {
        templateId: args.templateId,
        responseId: result.responseId,
        data: args.data,
        score: result.verdict.score,
        status: result.verdict.status,
      })
    } catch {
      // swallow — automations are non-critical to the submit
    }
    revalidatePath('/forms/responses')
    redirect(`/forms/responses/${result.responseId}`)
  }
  // Validation/missing-version error branches — strip the inner discriminator.
  if (!result.ok) return { ok: false, errors: result.errors }
  return { ok: true, responseId: result.responseId }
}

/**
 * Look up the allowlisted entity-attr map for a single picker selection.
 *
 * Called by the filler client on picker-change so `entity_attr` formula
 * fields can re-render with the new selection before the next server
 * round-trip. RLS is enforced via the underlying `ctx.db(...)` so callers
 * cannot retrieve another tenant's rows. The loader's per-kind SELECT
 * lists are the security boundary — unallowlisted columns never leave
 * the database.
 */
export async function fetchEntityAttrs(args: {
  pickerFieldType: string
  entityId: string
}): Promise<
  | { ok: true; attrs: Record<string, unknown> | null }
  | { ok: false; error: string }
> {
  const ctx = await requireRequestContext()
  try {
    const attrs = await fetchSingleEntityAttrs(
      ctx,
      args.pickerFieldType,
      args.entityId,
    )
    return { ok: true, attrs }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed'
    return { ok: false, error: message }
  }
}

/**
 * Save the in-flight draft state for a form response.
 *
 * Called by the filler client on debounced changes, step navigation, and a
 * sendBeacon on page-unload (via /api/forms/draft-save which delegates to this
 * helper). Creates a lazy draft row the first time we see this responseId =
 * `null` — that is, on the user's first keystroke. Subsequent calls update
 * in-place.
 *
 * Audits ONLY on first draft save in a session (when draft_updated_at was
 * null), not every keystroke. Keeps the audit log readable.
 *
 * Validation:
 *   - input shape via Zod
 *   - response belongs to active tenant (RLS via ctx.db)
 *   - response is in draft / in_progress status (no editing after submit)
 *   - response is owned by current user (submittedBy = ctx.membership.id) OR
 *     current user has the `forms.responses.write_any` permission
 *
 * Does NOT bump any response version. The submit path is the only one that
 * writes to `data` / `compliance_*` / `submittedAt`.
 */

const draftInputSchema = z.object({
  responseId: z.string().min(1),
  values: z.record(z.string(), z.unknown()),
  rows: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  stepIndex: z.number().int().min(0),
})

export type SaveDraftInput = z.infer<typeof draftInputSchema>

export async function saveFormResponseDraft(
  input: SaveDraftInput,
): Promise<
  | { ok: true; savedAt: string }
  | { ok: false; error: string }
> {
  const parsed = draftInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Invalid draft payload' }
  }
  const ctx = await requireRequestContext()
  return await persistDraft(ctx, parsed.data)
}

/**
 * Internal helper shared by both the server action above and the
 * /api/forms/draft-save POST handler (which is used for sendBeacon at unload).
 * The two paths run the same Zod validation + DB writes; only the surface is
 * different.
 */
export async function persistDraft(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  input: SaveDraftInput,
): Promise<
  | { ok: true; savedAt: string }
  | { ok: false; error: string }
> {
  const now = new Date()

  try {
    const result = await ctx.db(async (tx) => {
      const [row] = await tx
        .select({
          id: formResponses.id,
          status: formResponses.status,
          submittedBy: formResponses.submittedBy,
          draftUpdatedAt: formResponses.draftUpdatedAt,
        })
        .from(formResponses)
        .where(
          and(
            eq(formResponses.id, input.responseId),
            eq(formResponses.tenantId, ctx.tenantId),
          ),
        )
        .limit(1)

      if (!row) {
        return { ok: false as const, error: 'Response not found' }
      }

      // Only drafts / in-progress responses accept autosave. If the response
      // moved to submitted / closed / etc., bail with a clear message — the
      // client surfaces this as a refresh prompt.
      if (row.status !== 'draft' && row.status !== 'in_progress') {
        return {
          ok: false as const,
          error: 'This response has already been submitted',
        }
      }

      // Ownership check. The submitter is the canonical owner; anyone with
      // the wildcard / write-any permission may also save (e.g. an admin
      // helping a worker recover a form).
      const submitterId = row.submittedBy
      const callerMembershipId = ctx.membership?.id ?? null
      const isOwner =
        submitterId !== null && submitterId === callerMembershipId
      const hasOverride =
        ctx.isSuperAdmin ||
        ctx.permissions.has('*') ||
        ctx.permissions.has('forms.responses.write_any') ||
        ctx.permissions.has('forms.responses.*')
      // First save of the lifetime of this response (no submittedBy yet) →
      // the current user takes ownership.
      const isAdopting = submitterId === null
      if (!isOwner && !hasOverride && !isAdopting) {
        return {
          ok: false as const,
          error: 'You do not have permission to edit this response',
        }
      }

      const wasFirstSave = row.draftUpdatedAt === null

      await tx
        .update(formResponses)
        .set({
          draftData: { values: input.values, rows: input.rows },
          draftUpdatedAt: now,
          draftStepIndex: input.stepIndex,
          // Adopt ownership on first save if it was unset (typical for
          // brand-new drafts created by createDraftResponse below).
          ...(isAdopting && callerMembershipId
            ? { submittedBy: callerMembershipId }
            : {}),
          // Bump status to in_progress on the first content save so list
          // views can distinguish "empty shell" from "actively being filled".
          ...(row.status === 'draft' ? { status: 'in_progress' as const } : {}),
        })
        .where(eq(formResponses.id, input.responseId))

      return { ok: true as const, wasFirstSave }
    })

    if (!result.ok) return result

    // Audit ONLY on first draft save — one row per "started filling" event,
    // not per keystroke.
    if (result.wasFirstSave) {
      await recordAudit(ctx, {
        entityType: 'form_response',
        entityId: input.responseId,
        action: 'create',
        summary: 'Started filling out form (draft saved)',
        metadata: { stepIndex: input.stepIndex },
      })
    }

    return { ok: true, savedAt: now.toISOString() }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'save failed'
    return { ok: false, error: message }
  }
}

/**
 * Create an empty draft response row so the autosave client has an id to
 * write against. Called on the user's first content change — NOT on page
 * load — to avoid creating empty draft rows for users who just glance at
 * the form. Returns the new response id.
 */
export async function createDraftResponse(args: {
  templateId: string
}): Promise<{ ok: true; responseId: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  try {
    const result = await ctx.db(async (tx) => {
      const [version] = await tx
        .select()
        .from(formTemplateVersions)
        .where(eq(formTemplateVersions.templateId, args.templateId))
        .orderBy(desc(formTemplateVersions.version))
        .limit(1)
      if (!version) {
        return { ok: false as const, error: 'No published version' }
      }
      const [resp] = await tx
        .insert(formResponses)
        .values({
          tenantId: ctx.tenantId,
          templateId: args.templateId,
          templateVersionId: version.id,
          status: 'draft',
          submittedBy: ctx.membership?.id ?? null,
          data: {},
        })
        .returning({ id: formResponses.id })
      if (!resp) return { ok: false as const, error: 'Failed to create draft' }
      return { ok: true as const, responseId: resp.id }
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'failed to create draft'
    return { ok: false, error: message }
  }
}

// Fill-time safety analysis for a `photo_ai` element. Gated by forms.ai.generate
// + a configured AI provider; returns a friendly error rather than throwing so
// the filler can surface it inline. Never persists — the client stores the
// returned findings on the field value.
export async function analyzePhotos(args: {
  attachmentIds: string[]
}): Promise<{ ok: true; analysis: SafetyVisionAnalysis } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'forms.ai.generate')) {
    return { ok: false, error: 'You do not have permission to use AI analysis.' }
  }
  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig) {
    return { ok: false, error: 'AI is not configured for this workspace (Admin → AI).' }
  }
  if (!args.attachmentIds || args.attachmentIds.length === 0) {
    return { ok: false, error: 'Add a photo first, then run the analysis.' }
  }
  try {
    const analysis = await analyzePhotoAttachments(ctx, args.attachmentIds)
    if (!analysis) return { ok: false, error: 'No readable photo to analyse.' }
    return { ok: true, analysis }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed'
    return { ok: false, error: message }
  }
}
