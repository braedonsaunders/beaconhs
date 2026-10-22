import { getGeneratedTranslations } from '@/i18n/generated.server'
import { eq } from 'drizzle-orm'
import { tenants } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { normalizeEquipmentLabelDesign } from '@/lib/equipment-label-design'
import { EquipmentLabelStudio } from './_studio'
import { saveEquipmentLabelDesign } from './_actions'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_17b4383206c775') }
}
export const dynamic = 'force-dynamic'

export default async function EquipmentLabelDesignPage() {
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

  return <EquipmentLabelStudio initialDocument={document} onSave={saveEquipmentLabelDesign} />
}
