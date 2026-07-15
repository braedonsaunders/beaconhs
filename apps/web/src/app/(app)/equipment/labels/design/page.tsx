import { getGeneratedTranslations } from '@/i18n/generated.server'
import { eq } from 'drizzle-orm'
import { tenants } from '@beaconhs/db/schema'
import { PageHeader } from '@beaconhs/ui'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { normalizeEquipmentLabelDesign } from '@/lib/equipment-label-design'
import { PageContainer } from '@/components/page-layout'
import { EquipmentLabelStudio } from './_studio'
import { saveEquipmentLabelDesign } from './_actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_17b4383206c775') }
}
export const dynamic = 'force-dynamic'

export default async function EquipmentLabelDesignPage() {
  const tGenerated = await getGeneratedTranslations()
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')

  const settings = await ctx.db(async (tx) => {
    const [t] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    return t?.settings ?? {}
  })
  const document = normalizeEquipmentLabelDesign(settings)

  return (
    <PageContainer>
      <PageHeader
        title={tGenerated('m_0f44d475f864cd')}
        description={tGenerated('m_1b8fb70c0a62dd')}
        back={{ href: '/equipment/manage', label: 'Back to Manage equipment' }}
      />
      <EquipmentLabelStudio initialDocument={document} onSave={saveEquipmentLabelDesign} />
    </PageContainer>
  )
}
