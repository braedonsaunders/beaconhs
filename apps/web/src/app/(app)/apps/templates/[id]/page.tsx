// The App detail route is unified into the editor now. Editors land in the
// single-page App editor (Overview / Build / Assignments / Permissions + the
// build surface <-> Flows); everyone else lands on the native-style records
// list where New entry opens the unified create/edit/view page.

import { notFound, redirect } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'
import { isTemplateBuilder } from '@/app/(app)/apps/_lib/access'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export default async function FormTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  redirect(
    isTemplateBuilder(ctx) ? `/apps/templates/${id}/designer` : `/apps/templates/${id}/records`,
  )
}
