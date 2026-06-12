import { AssessmentsListPage } from '../../hazard-assessments/_list'

export const metadata = { title: 'My hazard assessments' }
export const dynamic = 'force-dynamic'

export default async function MyHazardAssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return <AssessmentsListPage searchParams={sp} basePath="/my/hazard-assessments" mineOnly />
}
