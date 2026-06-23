import { notFound, redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { loadTenantEmailTemplate } from '@/lib/email-templates'
import {
  loadSubjectCollections,
  loadSubjectFields,
  loadSubjectLabel,
} from '@/lib/flows/subject-fields'
import { EmailTemplateEditor } from './_editor.client'

export const dynamic = 'force-dynamic'

export default async function EmailTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const tpl = await loadTenantEmailTemplate(ctx, id)
  if (!tpl) notFound()

  // The palette is the subject's FULL, live field set (so schema changes show up);
  // generic templates (no subject) fall back to the stored snapshot.
  const [subjectFields, subjectLabel, collections] = await Promise.all([
    loadSubjectFields(ctx, tpl.recordSubjectType, tpl.recordSubjectKey),
    loadSubjectLabel(ctx, tpl.recordSubjectType, tpl.recordSubjectKey),
    loadSubjectCollections(ctx, tpl.recordSubjectType, tpl.recordSubjectKey),
  ])
  const mergeFields = subjectFields.length > 0 ? subjectFields : (tpl.mergeFields ?? [])

  return (
    <EmailTemplateEditor
      template={{
        id: tpl.id,
        name: tpl.name,
        subjectTemplate: tpl.subjectTemplate,
        design: tpl.design ?? {},
        mjmlSource: tpl.mjmlSource,
        mergeFields,
        collections,
        subjectLabel,
      }}
    />
  )
}
