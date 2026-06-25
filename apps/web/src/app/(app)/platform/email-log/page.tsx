import { EmailLogListView } from '@/components/email-log/list-view'

export const metadata = { title: 'Email log · Platform' }
export const dynamic = 'force-dynamic'

export default async function PlatformEmailLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  return (
    <EmailLogListView
      searchParams={sp}
      scope="platform"
      basePath="/platform/email-log"
      back={{ href: '/platform', label: 'Back to platform' }}
    />
  )
}
