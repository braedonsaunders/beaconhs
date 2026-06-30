import { CustomFieldsAdminPage } from '@/components/custom-fields/custom-fields-admin-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'PPE custom fields' }

export default function PpeCustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <CustomFieldsAdminPage kind="ppe" searchParams={searchParams} />
}
