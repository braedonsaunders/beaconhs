import { getGeneratedTranslations } from '@/i18n/generated.server'
import { AssessmentsListPage } from '../../hazard-assessments/_list'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0dec5f2c651118') }
}
export const dynamic = 'force-dynamic'

export default async function MyHazardAssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return <AssessmentsListPage searchParams={sp} basePath="/my/hazard-assessments" mineOnly />
}
