import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirectToModuleManagement } from '@/lib/module-admin/guard'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0ae4a97ad888a5') }
}

export default async function HazidManagePage() {
  return redirectToModuleManagement('hazid')
}
