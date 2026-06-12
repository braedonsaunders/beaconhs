import { AssessmentsListPage } from './_list'

export const metadata = { title: 'Hazard assessments' }
export const dynamic = 'force-dynamic'

export default async function HazardAssessmentsListRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return <AssessmentsListPage searchParams={sp} basePath="/hazard-assessments" />
}
