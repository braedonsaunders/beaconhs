import { CustomFieldsAdminPage } from '@/components/custom-fields/custom-fields-admin-page'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Equipment custom fields' }

export default function EquipmentCustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return <CustomFieldsAdminPage kind="equipment" searchParams={searchParams} />
}
