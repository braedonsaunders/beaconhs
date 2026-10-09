import { getGeneratedTranslations } from '@/i18n/generated.server'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { CreateEquipment } from './_create'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_105ebaff0d3ac5') }
}
export const dynamic = 'force-dynamic'

export default async function NewEquipmentPage() {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')

  return <CreateEquipment />
}
