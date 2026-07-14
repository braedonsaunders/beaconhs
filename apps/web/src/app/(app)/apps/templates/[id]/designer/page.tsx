import { notFound, redirect } from 'next/navigation'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import {
  formAutomations,
  formTemplateVersions,
  formTemplates,
  roles as rolesTable,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { isTemplateBuilder } from '@/app/(app)/apps/_lib/access'
import { isUuid } from '@/lib/list-params'
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

export default async function FormDesignerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const initialSurface = sp.surface === 'flows' ? 'flows' : 'build'
  const ctx = await requireRequestContext()
  // The designer is a build/admin surface: it exposes the full schema, every
  // flow graph (which can embed literal recipient emails), tenant role keys,
  // and recipient options. Non-editors land on the records list instead —
  // mirrors the /apps/templates/[id] router.
  if (!isTemplateBuilder(ctx)) {
    redirect(`/apps/templates/${id}/records`)
  }
  const canPin = can(ctx, 'admin.nav.manage')
  const data = await ctx.db(async (tx) => {
    const [tmpl] = await tx
      .select()
      .from(formTemplates)
      .where(and(eq(formTemplates.id, id), isNull(formTemplates.deletedAt)))
      .limit(1)
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
        .orderBy(desc(formTemplateVersions.version))
        .limit(1),
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
  // Every canonical creation path inserts version 1 in the same transaction as
  // the template. A template without a version is corrupt; a GET must not hide
  // that invariant breach by creating unaudited state or racing another GET.
  const latestVersion = data.latestVersion
  if (!latestVersion) notFound()
  const emailTemplateOptions = await listActiveEmailTemplatesForSubject(ctx, 'form_template', id)
  const pdfTemplateOptions = await listActivePdfTemplatesForSubject(ctx, 'form_template', id)
  const recipientOptions = await loadRecipientOptions(ctx)
  const targetAppOptions = await ctx.db((tx) =>
    tx
      .select({ id: formTemplates.id, name: formTemplates.name })
      .from(formTemplates)
      .where(
        and(
          eq(formTemplates.tenantId, ctx.tenantId),
          eq(formTemplates.status, 'published'),
          isNull(formTemplates.deletedAt),
        ),
      )
      .orderBy(asc(formTemplates.name)),
  )
  return (
    <FormDesigner
      templateId={id}
      templateName={data.tmpl.name}
      templateKind={data.tmpl.kind}
      initialSchema={latestVersion.schema}
      currentVersion={latestVersion.version}
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
      targetApps={targetAppOptions}
      recipientOptions={recipientOptions}
      canGenerate={can(ctx, 'forms.ai.generate')}
      canPin={canPin}
      pinned={data.pinned}
    />
  )
}
