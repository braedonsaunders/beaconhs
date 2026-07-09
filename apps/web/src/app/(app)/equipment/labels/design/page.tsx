import { eq } from 'drizzle-orm'
import { tenants } from '@beaconhs/db/schema'
import { PageHeader } from '@beaconhs/ui'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { normalizeEquipmentLabelDesign } from '@/lib/equipment-label-design'
import { PageContainer } from '@/components/page-layout'
import { EquipmentLabelStudio } from './_studio'
import { saveEquipmentLabelDesign } from './_actions'

export const metadata = { title: 'Equipment label design' }
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

  return (
    <PageContainer>
      <PageHeader
        title="QR label design"
        description="Design the printed equipment tag — size, layout, and every field. Labels print as PDFs sized exactly for label printers."
        back={{ href: '/equipment/manage', label: 'Back to Manage equipment' }}
      />
      <EquipmentLabelStudio initialDocument={document} onSave={saveEquipmentLabelDesign} />
    </PageContainer>
  )
}
