import { SmsLogListView } from '@/components/sms-log/list-view'

export const metadata = { title: 'SMS log' }
export const dynamic = 'force-dynamic'

export default async function SmsLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return (
    <SmsLogListView
      searchParams={sp}
      scope="tenant"
      basePath="/admin/sms-log"
      back={{ href: '/admin', label: 'Back to admin' }}
    />
  )
}
