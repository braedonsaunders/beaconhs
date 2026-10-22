import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirectToModuleManagement } from '@/lib/module-admin/guard'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1d8ceffa862c01') }
}

export default async function PpeManagePage() {
  return redirectToModuleManagement('ppe')
}
