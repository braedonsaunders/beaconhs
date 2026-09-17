'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { desc, eq, isNull } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import { dataSources, formTemplateVersions, type DataSourceColumn } from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { deriveColumnsFromSchema, slugify } from './_shared'

async function guard() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) return null
  return ctx
}

export async function createDataSource(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return
  const kind = formData.get('kind') === 'responses' ? 'responses' : 'reference'
  const templateId = String(formData.get('templateId') ?? '').trim() || null
  const description = String(formData.get('description') ?? '').trim() || null

  const base = slugify(String(formData.get('key') ?? '').trim() || name)
  const newId = await ctx.db(async (tx) => {
    const existing = await tx
      .select({ key: dataSources.key })
      .from(dataSources)
      .where(isNull(dataSources.deletedAt))
    const taken = new Set(existing.map((r) => r.key))
    let key = base
    let n = 2
    while (taken.has(key)) key = `${base}-${n++}`

    let columns: DataSourceColumn[] = []
    let config: { templateId?: string } = {}
    if (kind === 'responses' && templateId) {
      const [ver] = await tx
        .select({ schema: formTemplateVersions.schema })
        .from(formTemplateVersions)
        .where(eq(formTemplateVersions.templateId, templateId))
        .orderBy(desc(formTemplateVersions.version))
        .limit(1)
      if (ver?.schema) {
        columns = deriveColumnsFromSchema(
          ver.schema as FormSchemaV1,
          ctx.defaultLocale,
          ctx.defaultLocale,
        )
      }
      config = { templateId }
    }

    const [row] = await tx
      .insert(dataSources)
      .values({
        tenantId: ctx.tenantId,
        key,
        name,
        description,
        kind,
        columns,
        config,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: dataSources.id })
    return row?.id ?? null
  })

  if (newId) {
    await recordAudit(ctx, {
      entityType: 'data_source',
      entityId: newId,
      action: 'create',
      summary: `Created data source "${name}" (${kind})`,
      after: { name, kind },
    })
    revalidatePath('/admin/data-sources')
    redirect(`/admin/data-sources/${newId}`)
  }
  revalidatePath('/admin/data-sources')
}

export async function deleteDataSource(formData: FormData): Promise<void> {
  const ctx = await guard()
  if (!ctx) return
  const id = String(formData.get('id') ?? '')
  if (!id) return
  await ctx.db((tx) =>
    tx.update(dataSources).set({ deletedAt: new Date() }).where(eq(dataSources.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'data_source',
    entityId: id,
    action: 'delete',
    summary: 'Deleted data source',
  })
  revalidatePath('/admin/data-sources')
  revalidatePath(`/admin/data-sources/${id}`)
  if (String(formData.get('redirect') ?? '') === 'list') redirect('/admin/data-sources')
}
