'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { formTemplateVersions, formTemplates, orgUnits } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import type { SafetyVisionAnalysis } from '@beaconhs/ai'
import {
  entityAttrPickerTypeForField,
  formSchemaV1,
  type SketchDraftElement,
} from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { getTenantAiConfig } from '@/lib/ai-config'
import { analyzePhotoAttachments } from '@/app/(app)/apps/_lib/analyze-photos'
import { generateSketchDraft } from '@/app/(app)/apps/_lib/sketch-draft'
import { fetchSingleEntityAttrs } from '@/app/(app)/apps/_lib/entity-loader'
import { submitFormResponseLifecycle } from '@/lib/forms/form-response-lifecycle'
import { canFillTemplate, insertDraftResponse } from '@/app/(app)/apps/_lib/draft-persistence'
import { parseBuilderReturnTo } from '@/app/(app)/apps/_lib/return-to'

const uuidSchema = z.string().uuid()
const entityAttrsInputSchema = z
  .object({
    templateId: uuidSchema,
    fieldId: z.string().trim().min(1).max(256),
    entityId: uuidSchema,
  })
  .strict()
const ENTITY_ATTRS_ERROR = 'Unable to look up this selection'

export async function submitFormResponse(args: {
  templateId: string
  data: Record<string, unknown>
  siteOrgUnitId?: string | null
  complianceObligationId?: string | null
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
    (args.complianceObligationId != null &&
      !uuidSchema.safeParse(args.complianceObligationId).success) ||
    !(await canFillTemplate(ctx, args.templateId))
  ) {
    return { ok: false, errors: [{ fieldId: '', message: 'You do not have access to this app' }] }
  }

  const result = await submitFormResponseLifecycle(ctx, {
    templateId: args.templateId,
    data: args.data,
    siteOrgUnitId: args.siteOrgUnitId,
    complianceObligationId: args.complianceObligationId,
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
 * round-trip. The client supplies only template/field/entity ids. This action
 * re-authorizes the published template and derives the picker type from its
 * trusted schema before the RLS-scoped entity query; unallowlisted columns
 * never leave the database.
 */
export async function fetchEntityAttrs(args: {
  templateId: string
  fieldId: string
  entityId: string
}): Promise<{ ok: true; attrs: Record<string, unknown> } | { ok: false; error: string }> {
  const parsed = entityAttrsInputSchema.safeParse(args)
  if (!parsed.success) return { ok: false, error: ENTITY_ATTRS_ERROR }

  const ctx = await requireRequestContext()
  if (!(await canFillTemplate(ctx, parsed.data.templateId))) {
    return { ok: false, error: ENTITY_ATTRS_ERROR }
  }

  try {
    const version = await ctx.db(async (tx) => {
      const [row] = await tx
        .select({ schema: formTemplateVersions.schema })
        .from(formTemplateVersions)
        .innerJoin(formTemplates, eq(formTemplates.id, formTemplateVersions.templateId))
        .where(
          and(
            eq(formTemplateVersions.templateId, parsed.data.templateId),
            eq(formTemplateVersions.tenantId, ctx.tenantId),
            eq(formTemplates.tenantId, ctx.tenantId),
            eq(formTemplates.status, 'published'),
            isNull(formTemplates.deletedAt),
            isNotNull(formTemplateVersions.publishedAt),
          ),
        )
        .orderBy(desc(formTemplateVersions.version))
        .limit(1)
      return row ?? null
    })
    if (!version) return { ok: false, error: ENTITY_ATTRS_ERROR }

    const schema = formSchemaV1.safeParse(version.schema)
    if (!schema.success) return { ok: false, error: ENTITY_ATTRS_ERROR }
    const pickerFieldType = entityAttrPickerTypeForField(schema.data, parsed.data.fieldId)
    if (!pickerFieldType) return { ok: false, error: ENTITY_ATTRS_ERROR }

    const attrs = await fetchSingleEntityAttrs(ctx, pickerFieldType, parsed.data.entityId)
    if (!attrs) return { ok: false, error: ENTITY_ATTRS_ERROR }
    return { ok: true, attrs }
  } catch (err) {
    console.error('[forms] entity attribute lookup failed', err)
    return { ok: false, error: ENTITY_ATTRS_ERROR }
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
 * Create an empty draft response row with a server-made id. Used by the
 * "New entry" buttons, which then open the record page. (The fill page's
 * local-first draft queue creates rows through /api/apps/draft-save with an
 * id minted on the device instead.)
 */
export async function createDraftResponse(args: {
  templateId: string
  complianceObligationId?: string | null
}): Promise<{ ok: true; responseId: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  const result = await insertDraftResponse(ctx, {
    templateId: args.templateId,
    complianceObligationId: args.complianceObligationId,
  })
  return result.ok ? result : { ok: false, error: result.error }
}

// Fill-time safety analysis for an AI-enabled photo field. Gated by forms.ai.generate
// + a configured AI provider; returns a friendly error rather than throwing so
// the filler can surface it inline. Never persists — the client stores the
// returned findings on the field value.
const MAX_SKETCH_DRAFT_DESCRIPTION_LENGTH = 2_000

// Draft a diagram from a description for a `sketch` element. The AI returns
// content-agnostic primitives; the filler inserts them as an editable draft
// the user reviews and adjusts — nothing is drawn permanently and nothing
// persists until the user explicitly saves. Gated on `forms.ai.generate`
// (same as photo analysis) plus tenant AI config; offline users keep the
// symbol library as the fallback.
export async function draftSketchDiagram(args: {
  templateId: string
  description: string
  symbolNames: string[]
}): Promise<{ ok: true; elements: SketchDraftElement[] } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'forms.ai.generate')) {
    return { ok: false, error: 'You do not have permission to use AI drafting.' }
  }
  if (!args || typeof args !== 'object' || !(await canFillTemplate(ctx, args.templateId))) {
    return { ok: false, error: 'App not found.' }
  }
  const description = typeof args.description === 'string' ? args.description.trim() : ''
  if (!description || description.length > MAX_SKETCH_DRAFT_DESCRIPTION_LENGTH) {
    return { ok: false, error: 'Describe the diagram in a few sentences first.' }
  }
  const symbolNames = Array.isArray(args.symbolNames)
    ? args.symbolNames.filter((name): name is string => typeof name === 'string').slice(0, 50)
    : []
  const aiConfig = await getTenantAiConfig(ctx)
  if (!aiConfig) {
    return { ok: false, error: 'AI is not configured for this workspace (Admin → AI).' }
  }
  try {
    return await generateSketchDraft(aiConfig, { description, symbolNames })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Diagram drafting failed'
    return { ok: false, error: message }
  }
}

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
