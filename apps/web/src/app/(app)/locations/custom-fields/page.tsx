import { CustomFieldsAdminPage } from '@/components/custom-fields/custom-fields-admin-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Location custom fields' }

export default function LocationCustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <CustomFieldsAdminPage kind="location" searchParams={searchParams} />
}
