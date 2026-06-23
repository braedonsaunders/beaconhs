import { notFound, redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { loadTenantEmailTemplate } from '@/lib/email-templates'
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

  return (
    <EmailTemplateEditor
      template={{
        id: tpl.id,
        name: tpl.name,
        subjectTemplate: tpl.subjectTemplate,
        design: tpl.design ?? {},
        mergeFields: tpl.mergeFields ?? [],
      }}
    />
  )
}
