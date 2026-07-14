// Flows are now a surface inside the unified App editor. This route just
// forwards to the editor with the Flows surface active.

import { notFound, redirect } from 'next/navigation'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export default async function FlowsRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  redirect(`/apps/templates/${id}/designer?surface=flows`)
}
