'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import {
  formResponses,
  formTemplateVersions,
  orgUnits,
  type FormResponseDraftData,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import type { SafetyVisionAnalysis } from '@beaconhs/ai'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { analyzePhotoAttachments } from '@/app/(app)/apps/_lib/analyze-photos'
import { recordAudit } from '@/lib/audit'
import { computeFormScore } from '@/app/(app)/apps/_lib/score-router'
import { fetchSingleEntityAttrs } from '@/app/(app)/apps/_lib/entity-loader'
import { responsePayload } from '@/app/(app)/apps/_lib/response-payload'
import { decideDraftSave } from '@/app/(app)/apps/_lib/draft-save-order'
import { submitFormResponseLifecycle } from '@/lib/forms/form-response-lifecycle'
import {
  canAccessResponseTemplate,
  canAccessTemplateById,
  canEditResponsePayload,
} from '@/app/(app)/apps/_lib/access'
import { parseBuilderReturnTo } from '@/app/(app)/apps/_lib/return-to'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>
const uuidSchema = z.string().uuid()

async function canFillTemplate(ctx: Ctx, templateId: string): Promise<boolean> {
  if (!uuidSchema.safeParse(templateId).success) return false
  return can(ctx, 'forms.response.create') && canAccessTemplateById(ctx, templateId, 'operate')
}

async function canFillResponse(ctx: Ctx, responseId: string): Promise<boolean> {
  if (!uuidSchema.safeParse(responseId).success) return false
  // This helper gates mutations, not read-only record inspection. Historical
  // records may remain visible to a template builder, but an unpublished app
  // must never accept autosaves or inline edits.
  return canAccessResponseTemplate(ctx, responseId, 'operate')
}

export async function submitFormResponse(args: {
  templateId: string
  data: Record<string, unknown>
  siteOrgUnitId?: string | null
  // Optional: when present, finalize this existing draft row instead of
  // inserting a new one. Set by the filler client whenever it has been
  // autosaving against a known response id.
  responseId?: string | null
  // Optional internal path for embedded/bound app flows that should return to
  // their parent workspace after submit instead of the generic response page.
  returnTo?: string | null
}): Promise<{ ok: boolean; responseId?: string; errors?: { fieldId: string; message: string }[] }> {
  const ctx = await requireRequestContext()
  if (
    (args.responseId != null && !uuidSchema.safeParse(args.responseId).success) ||
    !(await canFillTemplate(ctx, args.templateId))
  ) {
    return { ok: false, errors: [{ fieldId: '', message: 'You do not have access to this app' }] }
  }

  const result = await submitFormResponseLifecycle(ctx, {
    templateId: args.templateId,
    data: args.data,
    siteOrgUnitId: args.siteOrgUnitId,
    responseId: args.responseId,
  })

  if (!result.ok) return { ok: false, errors: result.errors }

  revalidatePath('/apps/responses')
  const returnTo = parseBuilderReturnTo(args.returnTo)
  if (returnTo) {
    revalidatePath(returnTo.split('?')[0] || returnTo)
    redirect(returnTo as any)
  }
  redirect(`/apps/responses/${result.responseId}`)
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
}): Promise<{ ok: true; attrs: Record<string, unknown> | null } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  try {
    const attrs = await fetchSingleEntityAttrs(ctx, args.pickerFieldType, args.entityId)
    return { ok: true, attrs }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch failed'
    return { ok: false, error: message }
  }
}

// The org_units hierarchy levels, one per org-unit picker element.
const ORG_UNIT_LEVELS = ['customer', 'project', 'site', 'area'] as const
type OrgUnitLevel = (typeof ORG_UNIT_LEVELS)[number]

/**
 * Active org units at a given hierarchy level (customer / project / site /
 * area), for the org-unit picker elements. Soft-deleted units are excluded.
 * RLS-scoped via ctx.db, so only the active tenant's units are returned.
 */
export async function listOrgUnitOptions(
  level: OrgUnitLevel,
): Promise<{ id: string; name: string; code: string | null }[]> {
  // Defensive: never run an unbounded query for an unexpected level.
  if (!ORG_UNIT_LEVELS.includes(level)) return []
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) =>
    tx
      .select({ id: orgUnits.id, name: orgUnits.name, code: orgUnits.code })
      .from(orgUnits)
      .where(and(eq(orgUnits.level, level), isNull(orgUnits.deletedAt)))
      .orderBy(asc(orgUnits.name)),
  )
}

/**
 * Save the in-flight draft state for a form response.
 *
 * Called by the filler client on debounced changes, step navigation, and a
 * sendBeacon on page-unload (via /api/apps/draft-save which delegates to this
 * helper). The filler creates a lazy draft row on the first content change,
 * then passes that response id to every autosave call here.
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
 *
 * Does NOT bump any response version. The submit path is the only one that
 * writes to `data` / `compliance_*` / `submittedAt`.
 */

const draftInputSchema = z.object({
  responseId: uuidSchema,
  values: z.record(z.string(), z.unknown()),
  rows: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  stepIndex: z.number().int().min(0),
  clientSessionId: uuidSchema,
  clientSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
})

export type SaveDraftInput = z.infer<typeof draftInputSchema>
type SaveDraftResult =
  | { ok: true; savedAt: string; revision: number; sequence: number }
  | { ok: false; error: string }

export async function saveFormResponseDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
  const ctx = await requireRequestContext()
  return persistDraft(ctx, input)
}

/**
 * Internal helper shared by both the server action above and the
 * /api/apps/draft-save POST handler (which is used for sendBeacon at unload).
 * The two paths run the same Zod validation + DB writes; only the surface is
 * different.
 */
export async function persistDraft(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  input: SaveDraftInput,
): Promise<SaveDraftResult> {
  const parsed = draftInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid draft payload' }
  if (!(await canFillResponse(ctx, parsed.data.responseId))) {
    return { ok: false, error: 'You do not have access to this app' }
  }
  const draft = parsed.data
  const now = new Date()

  try {
    const result = await ctx.db(async (tx) => {
      const [row] = await tx
        .select({
          id: formResponses.id,
          status: formResponses.status,
          locked: formResponses.locked,
          submittedBy: formResponses.submittedBy,
          draftData: formResponses.draftData,
          draftUpdatedAt: formResponses.draftUpdatedAt,
        })
        .from(formResponses)
        .where(
          and(
            eq(formResponses.id, draft.responseId),
            eq(formResponses.tenantId, ctx.tenantId),
            isNull(formResponses.deletedAt),
          ),
        )
        .limit(1)
        .for('update')

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
      if (row.locked) {
        return {
          ok: false as const,
          error: 'This record is locked',
        }
      }

      if (!canEditResponsePayload(ctx, row)) {
        return {
          ok: false as const,
          error: 'You do not have permission to edit this response',
        }
      }

      const order = decideDraftSave(row.draftData as FormResponseDraftData | null, {
        sessionId: draft.clientSessionId,
        sequence: draft.clientSequence,
        baseRevision: draft.baseRevision,
      })
      if (order.kind === 'conflict') {
        return {
          ok: false as const,
          error: 'This draft changed in another tab. Refresh before continuing.',
        }
      }
      if (order.kind === 'superseded') {
        return {
          ok: true as const,
          savedAt: (row.draftUpdatedAt ?? now).toISOString(),
          revision: order.revision,
          sequence: order.sequence,
          wasFirstSave: false,
        }
      }

      const wasFirstSave = row.draftUpdatedAt === null

      const ownerUnchanged =
        row.submittedBy === null
          ? isNull(formResponses.submittedBy)
          : eq(formResponses.submittedBy, row.submittedBy)
      const [updated] = await tx
        .update(formResponses)
        .set({
          draftData: {
            values: draft.values,
            rows: draft.rows,
            saveSessionId: draft.clientSessionId,
            saveSequence: draft.clientSequence,
            saveRevision: order.nextRevision,
          },
          draftUpdatedAt: now,
          draftStepIndex: draft.stepIndex,
          // Adopt ownership on first save if it was unset (typical for
          // brand-new drafts created by createDraftResponse below).
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
        return {
          ok: false as const,
          error: 'This response changed before the draft could be saved',
        }
      }

      return {
        ok: true as const,
        savedAt: now.toISOString(),
        revision: order.nextRevision,
        sequence: draft.clientSequence,
        wasFirstSave,
      }
    })

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
    console.error('[forms] draft save failed', err)
    return { ok: false, error: 'Unable to save this draft right now' }
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
  if (!(await canFillTemplate(ctx, args.templateId))) {
    return { ok: false, error: 'You do not have access to this app' }
  }
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

/**
 * Per-field inline autosave for a single response (LiveField parity).
 *
 * Powers the renderer's `inlineAutosave` mode: each field saves itself on
 * blur / debounce by writing exactly one key into the response's canonical
 * `data` jsonb (read-modify-write). Unlike `persistDraft` (which writes the
 * separate `draft_data` blob during the guided wizard) this commits straight
 * to `data` and recomputes compliance on every edit — the record is already
 * a live entity being edited in place.
 *
 * Gates (mirrors persistDraft):
 *   - response exists in the active tenant (RLS via ctx.db)
 *   - `locked` must be false
 *   - caller owns the row (submittedBy = membership) OR has the reviewer/manage
 *     tier / wildcard / super-admin; adopts ownership when submittedBy is null
 *   - fieldId must be a top-level field id OR a repeating-section id
 */
export async function updateResponseField(input: {
  responseId: string
  fieldId: string
  value: unknown
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.responseId || !input.fieldId) {
    return { ok: false, error: 'Invalid request' }
  }
  const ctx = await requireRequestContext()
  if (!(await canFillResponse(ctx, input.responseId))) {
    return { ok: false, error: 'You do not have access to this app' }
  }
  try {
    const result = await ctx.db(async (tx) => {
      const [row] = await tx
        .select({
          id: formResponses.id,
          status: formResponses.status,
          locked: formResponses.locked,
          submittedBy: formResponses.submittedBy,
          data: formResponses.data,
          draftData: formResponses.draftData,
          schema: formTemplateVersions.schema,
        })
        .from(formResponses)
        .innerJoin(
          formTemplateVersions,
          eq(formResponses.templateVersionId, formTemplateVersions.id),
        )
        .where(
          and(
            eq(formResponses.id, input.responseId),
            eq(formResponses.tenantId, ctx.tenantId),
            isNull(formResponses.deletedAt),
          ),
        )
        .limit(1)
        .for('update', { of: formResponses })

      if (!row) return { ok: false as const, error: 'Response not found' }
      if (row.locked) return { ok: false as const, error: 'This record is locked' }

      if (!canEditResponsePayload(ctx, row)) {
        return { ok: false as const, error: 'You do not have permission to edit this record' }
      }

      // Validate the field id against the schema: a top-level field or a
      // repeating-section id (whose value is the whole row array).
      const schema = row.schema
      const isTopLevelField = schema.sections.some((sec) =>
        sec.fields.some((f) => f.id === input.fieldId),
      )
      const isSectionId = schema.sections.some((sec) => sec.id === input.fieldId && sec.repeating)
      if (!isTopLevelField && !isSectionId) {
        return { ok: false as const, error: 'Unknown field' }
      }

      // Read-modify-write the single key into the canonical payload.
      const existing = responsePayload(
        row.data ?? {},
        row.draftData as FormResponseDraftData | null,
      )
      const newData = { ...existing, [input.fieldId]: input.value }

      // Recompute compliance from the merged payload. Hoist repeating-section
      // rows so section-aware score operators resolve (same as submit).
      const rows: Record<string, Array<Record<string, unknown>>> = {}
      for (const sec of schema.sections) {
        if (!sec.repeating) continue
        const v = newData[sec.id]
        rows[sec.id] = Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
      }
      const verdict = computeFormScore(schema, newData, rows)

      const ownerUnchanged =
        row.submittedBy === null
          ? isNull(formResponses.submittedBy)
          : eq(formResponses.submittedBy, row.submittedBy)
      const [updated] = await tx
        .update(formResponses)
        .set({
          data: newData,
          draftData: null,
          draftUpdatedAt: null,
          complianceScore: String(verdict.score),
          complianceStatus: verdict.status,
          // First edit on a fresh draft promotes it to in_progress so list
          // views distinguish an empty shell from one being filled.
          ...(row.status === 'draft' ? { status: 'in_progress' as const } : {}),
          // Adopt ownership on the first edit if it was unset.
          ...(row.submittedBy === null && ctx.membership?.id
            ? { submittedBy: ctx.membership.id }
            : {}),
        })
        .where(
          and(
            eq(formResponses.id, input.responseId),
            eq(formResponses.tenantId, ctx.tenantId),
            eq(formResponses.status, row.status),
            eq(formResponses.locked, false),
            isNull(formResponses.deletedAt),
            ownerUnchanged,
          ),
        )
        .returning({ id: formResponses.id })

      if (!updated) {
        return { ok: false as const, error: 'This record changed before it could be saved' }
      }

      return { ok: true as const }
    })

    if (!result.ok) return result

    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: input.responseId,
      action: 'update',
      summary: 'Updated record',
    })
    revalidatePath('/apps/responses/' + input.responseId)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'save failed'
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
