// Flows are now a surface inside the unified App editor. This route just
// forwards to the editor with the Flows surface active.

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function FlowsRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/apps/templates/${id}/designer?surface=flows`)
}
