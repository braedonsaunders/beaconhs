import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { formTemplates } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

// Starting a lone-worker session now opens the Lone Worker Builder app's filler.
// This legacy route just resolves the tenant's app and redirects to it.
export const dynamic = 'force-dynamic'

export default async function NewLoneWorkerSessionPage() {
  const ctx = await requireRequestContext()
  const [app] = await ctx.db((tx) =>
    tx
      .select({ id: formTemplates.id })
      .from(formTemplates)
      .where(and(eq(formTemplates.key, 'lone_worker'), eq(formTemplates.tenantId, ctx.tenantId)))
      .limit(1),
  )
  redirect(app ? `/forms/templates/${app.id}/fill` : '/lone-worker')
}
