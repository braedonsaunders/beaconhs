'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { formResponses, formTemplateVersions } from '@beaconhs/db/schema'
import { extractScores, validateResponse } from '@beaconhs/forms-core'
import { formResponseScores } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { computeFormScore } from '@/app/(app)/forms/_lib/score-router'
import { fetchSingleEntityAttrs } from '@/app/(app)/forms/_lib/entity-loader'

export async function submitFormResponse(args: {
  templateId: string
  data: Record<string, unknown>
  siteOrgUnitId?: string | null
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

    const [resp] = await tx
      .insert(formResponses)
      .values({
        tenantId: ctx.tenantId,
        templateId: args.templateId,
        templateVersionId: version.id,
        // Auto-flag the response. Workflow status is `submitted` for the
        // happy path; if scoring flagged us non_compliant, surface that as
        // the top-level status so list views immediately call it out.
        status:
          verdict.status === 'non_compliant' ? 'non_compliant' : 'submitted',
        siteOrgUnitId: args.siteOrgUnitId ?? null,
        submittedBy: ctx.membership?.id,
        submittedAt: new Date(),
        data: args.data,
        complianceScore: String(verdict.score),
        complianceStatus: verdict.status,
      })
      .returning()

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
