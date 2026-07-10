import { eq } from 'drizzle-orm'
import { tenants } from '@beaconhs/db/schema'
import { PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { normalizePersonBadgeDesign } from '@/lib/person-badge-design'
import { PageContainer } from '@/components/page-layout'
import { PersonBadgeStudio } from './_studio'
import { savePersonBadgeDesign, resetPersonBadgeDesign } from './_actions'

export const metadata = { title: 'ID badge design' }
export const dynamic = 'force-dynamic'

export default async function PersonBadgeDesignPage() {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')

  const settings = await ctx.db(async (tx) => {
    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    return t?.settings ?? {}
  })
  const document = normalizePersonBadgeDesign(settings)

  return (
    <PageContainer>
      <PageHeader
        title="ID badge design"
        description="Design the printed employee ID badge — photo, details, and a QR code that opens the person's live training transcript. Badges print from each person's page as CR80 card PDFs."
        back={{ href: '/people/manage', label: 'Back to Manage people' }}
      />
      <PersonBadgeStudio
        initialDocument={document}
        onSave={savePersonBadgeDesign}
        onReset={resetPersonBadgeDesign}
      />
    </PageContainer>
  )
}
