import { getGeneratedTranslations } from '@/i18n/generated.server'
import { SmsLogListView } from '@/components/sms-log/list-view'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1a33caf0f3356d') }
}
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
