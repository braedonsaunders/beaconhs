// The App detail route is unified into the editor now. Editors land in the
// single-page App editor (Overview / Build / Assignments / Permissions + the
// build surface ⟷ Flows); everyone else goes straight to filling it out.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function FormTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  redirect(
    can(ctx, 'forms.template.create')
      ? `/forms/templates/${id}/designer`
      : `/forms/templates/${id}/fill`,
  )
}
