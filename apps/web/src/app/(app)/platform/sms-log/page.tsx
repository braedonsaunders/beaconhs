import { SmsLogListView } from '@/components/sms-log/list-view'

export const metadata = { title: 'SMS log · Platform' }
export const dynamic = 'force-dynamic'

export default async function PlatformSmsLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return (
    <SmsLogListView
      searchParams={sp}
      scope="platform"
      basePath="/platform/sms-log"
      back={{ href: '/platform', label: 'Back to platform' }}
    />
  )
}
