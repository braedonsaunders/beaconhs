import { notFound } from 'next/navigation'
import { asc, isNull } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import { formTemplates } from '@beaconhs/db/schema'
import { PageContainer } from '@/components/page-layout'
import { requireRequestContext } from '@/lib/auth'
import { loadNavConfig } from '@/lib/nav/resolve'
import { AdminBackLink } from '../_back-link'
import { NavEditor } from './_editor'

export const metadata = { title: 'Navigation' }
export const dynamic = 'force-dynamic'

export default async function NavigationAdminPage() {
  const ctx = await requireRequestContext()
  // Page is gated client-side-safe: non-admins get a 404 rather than a thrown
  // ForbiddenError. The server actions assertCan independently.
  if (!can(ctx, 'admin.nav.manage')) notFound()

  const { config, templates } = await ctx.db(async (tx) => {
    const config = await loadNavConfig(tx)
    const templates = await tx
      .select({
        id: formTemplates.id,
        name: formTemplates.name,
        category: formTemplates.category,
        iconKey: formTemplates.iconKey,
        status: formTemplates.status,
      })
      .from(formTemplates)
      .where(isNull(formTemplates.deletedAt))
      .orderBy(asc(formTemplates.name))
      .limit(300)
    return { config, templates }
  })

  return (
    <PageContainer>
      <AdminBackLink />
      <NavEditor initialConfig={config} templates={templates} />
    </PageContainer>
  )
}
