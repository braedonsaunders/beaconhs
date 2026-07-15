import { getGeneratedTranslations } from '@/i18n/generated.server'
import { eq } from 'drizzle-orm'
import { tenants } from '@beaconhs/db/schema'
import { PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { normalizePersonBadgeDesign } from '@/lib/person-badge-design'
import { PageContainer } from '@/components/page-layout'
import { PersonBadgeStudio } from './_studio'
import { savePersonBadgeDesign, resetPersonBadgeDesign } from './_actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1865f8eb5f8b1c') }
}
export const dynamic = 'force-dynamic'

export default async function PersonBadgeDesignPage() {
  const tGenerated = await getGeneratedTranslations()
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
        title={tGenerated('m_1865f8eb5f8b1c')}
        description={tGenerated('m_1d510aa3d3fe13')}
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
