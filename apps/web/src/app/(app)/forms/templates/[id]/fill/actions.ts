'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { formResponses, formTemplateVersions } from '@beaconhs/db/schema'
import { extractScores, validateResponse } from '@beaconhs/forms-core'
import { formResponseScores } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

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

    const [resp] = await tx
      .insert(formResponses)
      .values({
        tenantId: ctx.tenantId,
        templateId: args.templateId,
        templateVersionId: version.id,
        status: 'submitted',
        siteOrgUnitId: args.siteOrgUnitId ?? null,
        submittedBy: ctx.membership?.id,
        submittedAt: new Date(),
        data: args.data,
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

    return { ok: true as const, responseId: resp?.id }
  })

  if (result.ok && result.responseId) {
    await recordAudit(ctx, {
      entityType: 'form_response',
      entityId: result.responseId,
      action: 'create',
      summary: 'Form submitted',
    })
    revalidatePath('/forms/responses')
    redirect(`/forms/responses/${result.responseId}`)
  }
  return result
}
