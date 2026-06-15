'use server'

import { revalidatePath } from 'next/cache'
import { desc, eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
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

// Update an App's "overview" metadata (name / description / category / icon /
// email-on-submit). Distinct from publishing a new schema version.
export async function updateAppOverview(args: {
  templateId: string
  name: string
  description?: string | null
  category?: string | null
  iconKey?: string | null
  emailOnSubmit?: boolean
  surfaceAsTool?: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.template.create')
  const name = (args.name ?? '').trim()
  if (!name) return { ok: false, error: 'Name is required' }
  await ctx.db((tx) =>
    tx
      .update(formTemplates)
      .set({
        name,
        description: args.description?.trim() || null,
        // Only touch category / icon / emailOnSubmit when explicitly provided —
        // the Overview panel no longer edits them, so they must survive saves.
        ...(args.category === undefined
          ? {}
          : { category: (args.category?.trim() || null) as never }),
        ...(args.iconKey === undefined ? {} : { iconKey: args.iconKey?.trim() || null }),
        ...(args.emailOnSubmit === undefined ? {} : { emailOnSubmit: args.emailOnSubmit }),
        ...(args.surfaceAsTool === undefined ? {} : { surfaceAsTool: args.surfaceAsTool }),
        updatedAt: new Date(),
      })
      .where(eq(formTemplates.id, args.templateId)),
  )
  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: args.templateId,
    action: 'update',
    summary: 'Updated app overview',
  })
  revalidatePath(`/forms/templates/${args.templateId}`)
  revalidatePath('/forms')
  return { ok: true }
}

// Restrict (or open up) which roles may see + fill an App. Empty array ⇒
// visible to everyone.
export async function updateAppPermissions(args: {
  templateId: string
  allowedRoles: string[]
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'forms.template.create')
  const roles = Array.from(new Set((args.allowedRoles ?? []).map((r) => r.trim()).filter(Boolean)))
  await ctx.db((tx) =>
    tx
      .update(formTemplates)
      .set({ allowedRoles: roles.length ? roles : null, updatedAt: new Date() })
      .where(eq(formTemplates.id, args.templateId)),
  )
  await recordAudit(ctx, {
    entityType: 'form_template',
    entityId: args.templateId,
    action: 'update',
    summary: roles.length ? `Restricted to roles: ${roles.join(', ')}` : 'Opened to all roles',
  })
  revalidatePath(`/forms/templates/${args.templateId}`)
  revalidatePath('/forms')
  return { ok: true }
}
