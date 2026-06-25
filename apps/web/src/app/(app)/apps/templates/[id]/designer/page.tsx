import { notFound } from 'next/navigation'
import { asc, desc, eq } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import {
  formAutomations,
  formTemplateVersions,
  formTemplates,
  roles as rolesTable,
} from '@beaconhs/db/schema'
import type { FormSchemaV1 } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { loadNavConfig } from '@/lib/nav/resolve'
import { listActiveEmailTemplatesForSubject } from '@/lib/email-templates'
import { listActivePdfTemplatesForSubject } from '@/lib/pdf-templates'
import { loadRecipientOptions } from '@/lib/flows/recipient-options'
import { FormDesigner } from './form-designer'
import type { RecordConfig } from './_record-behavior-panel'
import type { FlowSummary } from '../flows/_flows-canvas'

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
        fields: [{ id: 'field_notes', type: 'long_text', label: { en: 'Notes' }, required: false }],
      },
    ],
    workflow: {
      steps: [
        {
          key: 'submit',
          title: { en: 'Submit' },
          assignee: { type: 'expression', expr: '$submitter' },
        },
      ],
    },
  }
}

export default async function FormDesignerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const initialSurface = sp.surface === 'flows' ? 'flows' : 'build'
  const ctx = await requireRequestContext()
  const canPin = can(ctx, 'admin.nav.manage')
  const data = await ctx.db(async (tx) => {
    const [tmpl] = await tx.select().from(formTemplates).where(eq(formTemplates.id, id)).limit(1)
    if (!tmpl) return null
    // Is this app currently pinned to the sidebar? (admins only — drives the
    // Pin toggle in the Overview panel.)
    const pinned = canPin
      ? (await loadNavConfig(tx)).groups
          .flatMap((g) => g.items)
          .some((i) => i.kind === 'form' && i.templateId === id)
      : false
    const [versions, flows, tenantRoles] = await Promise.all([
      tx
        .select()
        .from(formTemplateVersions)
        .where(eq(formTemplateVersions.templateId, id))
        .orderBy(desc(formTemplateVersions.version)),
      tx
        .select({
          id: formAutomations.id,
          name: formAutomations.name,
          enabled: formAutomations.enabled,
          graph: formAutomations.graph,
        })
        .from(formAutomations)
        .where(eq(formAutomations.templateId, id))
        .orderBy(asc(formAutomations.createdAt)),
      tx
        .select({ key: rolesTable.key, name: rolesTable.name })
        .from(rolesTable)
        .where(eq(rolesTable.tenantId, ctx.tenantId))
        .orderBy(asc(rolesTable.name)),
    ])
    return { tmpl, latestVersion: versions[0] ?? null, flows, tenantRoles, pinned }
  })

  if (!data) notFound()
  const emailTemplateOptions = await listActiveEmailTemplatesForSubject(ctx, 'form_template', id)
  const pdfTemplateOptions = await listActivePdfTemplatesForSubject(ctx, 'form_template', id)
  const recipientOptions = await loadRecipientOptions(ctx)
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
      templateKind={data.tmpl.kind}
      initialSchema={latestSchema}
      currentVersion={currentVersion}
      initialSurface={initialSurface}
      overview={{
        description: data.tmpl.description,
        category: data.tmpl.category,
        iconKey: data.tmpl.iconKey,
        emailOnSubmit: data.tmpl.emailOnSubmit,
        surfaceAsTool: data.tmpl.surfaceAsTool,
      }}
      recordConfig={(data.tmpl.recordConfig ?? undefined) as RecordConfig | undefined}
      allowedRoles={data.tmpl.allowedRoles ?? []}
      roles={data.tenantRoles}
      flows={data.flows as FlowSummary[]}
      emailTemplates={emailTemplateOptions}
      pdfTemplates={pdfTemplateOptions}
      recipientOptions={recipientOptions}
      canGenerate={can(ctx, 'forms.ai.generate')}
      canPin={canPin}
      pinned={data.pinned}
    />
  )
}
