import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirectToModuleManagement } from '@/lib/module-admin/guard'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_13adb05889cbe2') }
}

export default async function DocumentsManagePage() {
  return redirectToModuleManagement('documents')
}
