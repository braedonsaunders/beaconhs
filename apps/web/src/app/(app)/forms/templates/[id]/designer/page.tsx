import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { formTemplateVersions, formTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { FormDesigner } from './form-designer'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Designer · ${id.slice(0, 8)}` }
}

export default async function FormDesignerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  const data = await ctx.db(async (tx) => {
    const [tmpl] = await tx.select().from(formTemplates).where(eq(formTemplates.id, id)).limit(1)
    if (!tmpl) return null
    const versions = await tx
      .select()
      .from(formTemplateVersions)
      .where(eq(formTemplateVersions.templateId, id))
      .orderBy(desc(formTemplateVersions.version))
    return { tmpl, latestVersion: versions[0] ?? null }
  })

  if (!data) notFound()
  if (!data.latestVersion) {
    // bootstrap a v1 if none exists
    return (
      <div className="p-6 text-sm text-slate-600">
        No version yet. Initial draft will be created on first publish.
      </div>
    )
  }

  return (
    <FormDesigner
      templateId={id}
      templateName={data.tmpl.name}
      initialSchema={data.latestVersion.schema}
      currentVersion={data.latestVersion.version}
    />
  )
}
