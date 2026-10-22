import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirectToModuleManagement } from '@/lib/module-admin/guard'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_15682e6daef5d6') }
}

export default async function JournalsManagePage() {
  return redirectToModuleManagement('journals')
}
