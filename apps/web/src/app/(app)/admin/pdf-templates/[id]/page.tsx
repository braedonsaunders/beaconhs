import { notFound, redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { loadTenantPdfTemplate } from '@/lib/pdf-templates'
import {
  loadSubjectCollections,
  loadSubjectFields,
  loadSubjectLabel,
} from '@/lib/flows/subject-fields'
import { PdfTemplateEditor } from './_editor.client'

export const dynamic = 'force-dynamic'

export default async function PdfTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.settings.manage')) redirect('/admin')

  const tpl = await loadTenantPdfTemplate(ctx, id)
  if (!tpl) notFound()

  const [subjectFields, subjectLabel, collections] = await Promise.all([
    loadSubjectFields(ctx, tpl.recordSubjectType, tpl.recordSubjectKey),
    loadSubjectLabel(ctx, tpl.recordSubjectType, tpl.recordSubjectKey),
    loadSubjectCollections(ctx, tpl.recordSubjectType, tpl.recordSubjectKey),
  ])
  const mergeFields = subjectFields.length > 0 ? subjectFields : (tpl.mergeFields ?? [])

  return (
    <PdfTemplateEditor
      template={{
        id: tpl.id,
        name: tpl.name,
        design: tpl.design ?? {},
        sourceHtml: tpl.sourceHtml,
        paperSize: tpl.paperSize,
        orientation: tpl.orientation,
        marginMm: tpl.marginMm,
        headerHtml: tpl.headerHtml ?? '',
        footerHtml: tpl.footerHtml ?? '',
        mergeFields,
        collections,
        subjectLabel,
      }}
    />
  )
}
