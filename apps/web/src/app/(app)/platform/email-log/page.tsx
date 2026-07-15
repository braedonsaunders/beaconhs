import { getGeneratedTranslations } from '@/i18n/generated.server'
import { EmailLogListView } from '@/components/email-log/list-view'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_16173cb70c8501') }
}
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
