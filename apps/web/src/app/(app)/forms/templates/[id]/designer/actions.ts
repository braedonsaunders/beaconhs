'use server'

import { revalidatePath } from 'next/cache'
import { desc, eq } from 'drizzle-orm'
import { formTemplateVersions, formTemplates } from '@beaconhs/db/schema'
import { validateFormSchema, type FormSchemaV1 } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export async function publishNewVersion(args: {
  templateId: string
  schema: FormSchemaV1
  changelog: string
}): Promise<{ ok: boolean; version?: number; error?: string }> {
  const ctx = await requireRequestContext()
  try {
    const validated = validateFormSchema(args.schema)
    const result = await ctx.db(async (tx) => {
      const [latest] = await tx
        .select({ v: formTemplateVersions.version })
        .from(formTemplateVersions)
        .where(eq(formTemplateVersions.templateId, args.templateId))
        .orderBy(desc(formTemplateVersions.version))
        .limit(1)
      const nextVersion = (latest?.v ?? 0) + 1
      await tx.insert(formTemplateVersions).values({
        tenantId: ctx.tenantId,
        templateId: args.templateId,
        version: nextVersion,
        schema: validated,
        changelog: args.changelog || `Version ${nextVersion}`,
        publishedAt: new Date(),
        publishedBy: ctx.userId,
      })
      await tx
        .update(formTemplates)
        .set({ status: 'published' })
        .where(eq(formTemplates.id, args.templateId))
      return nextVersion
    })

    await recordAudit(ctx, {
      entityType: 'form_template',
      entityId: args.templateId,
      action: 'publish',
      summary: `Published version ${result}`,
    })

    revalidatePath(`/forms/templates/${args.templateId}`)
    revalidatePath('/forms')
    return { ok: true, version: result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to save' }
  }
}
