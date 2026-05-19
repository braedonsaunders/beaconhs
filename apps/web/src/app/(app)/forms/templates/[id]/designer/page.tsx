import { notFound } from 'next/navigation'
import { desc, eq } from 'drizzle-orm'
import { formTemplateVersions, formTemplates } from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { FormDesigner } from './form-designer'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Designer · ${id.slice(0, 8)}` }
}

function bootstrapSchema(name: string): FormSchemaV1 {
  return {
    schemaVersion: 1,
    title: { en: name },
    sections: [
      {
        id: 'sec_intro',
        title: { en: 'Section 1' },
        fields: [
          { id: 'field_notes', type: 'long_text', label: { en: 'Notes' }, required: false },
        ],
      },
    ],
    workflow: { steps: [{ key: 'submit', label: { en: 'Submit' } }] },
  }
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
  let latestSchema: FormSchemaV1
  let currentVersion: number
  if (!data.latestVersion) {
    const schema = bootstrapSchema(data.tmpl.name)
    await ctx.db(async (tx) => {
      await tx.insert(formTemplateVersions).values({
        tenantId: ctx.tenantId,
        templateId: id,
        version: 1,
        schema,
      })
    })
    latestSchema = schema
    currentVersion = 1
  } else {
    latestSchema = data.latestVersion.schema
    currentVersion = data.latestVersion.version
  }

  return (
    <FormDesigner
      templateId={id}
      templateName={data.tmpl.name}
      initialSchema={latestSchema}
      currentVersion={currentVersion}
    />
  )
}
