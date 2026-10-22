import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirectToModuleManagement } from '@/lib/module-admin/guard'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_161334a93a448f') }
}

export default async function TrainingManagePage() {
  return redirectToModuleManagement('training')
}
