import { CustomFieldsAdminPage } from '@/components/custom-fields/custom-fields-admin-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'People custom fields' }

export default function PeopleCustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <CustomFieldsAdminPage kind="person" searchParams={searchParams} />
}
