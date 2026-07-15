import { getGeneratedTranslations } from '@/i18n/generated.server'
import { CustomFieldsAdminPage } from '@/components/custom-fields/custom-fields-admin-page'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1e9785a51b4e50') }
}

export default function PeopleCustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <CustomFieldsAdminPage kind="person" searchParams={searchParams} />
}
