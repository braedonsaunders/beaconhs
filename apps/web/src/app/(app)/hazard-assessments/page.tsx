import { getGeneratedTranslations } from '@/i18n/generated.server'
import { AssessmentsListPage } from './_list'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_12db47b4ac8e02') }
}
export const dynamic = 'force-dynamic'

export default async function HazardAssessmentsListRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return <AssessmentsListPage searchParams={sp} basePath="/hazard-assessments" />
}
