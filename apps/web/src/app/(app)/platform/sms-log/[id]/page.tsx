import { getGeneratedTranslations } from '@/i18n/generated.server'
import { notFound } from 'next/navigation'
import { SmsLogDetailView } from '@/components/sms-log/detail-view'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_1e9c913c9245ae', { value0: id.slice(0, 8) }) }
}

export default async function PlatformSmsLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  return (
    <SmsLogDetailView
      id={id}
      scope="platform"
      back={{ href: '/platform/sms-log', label: 'Back to SMS log' }}
    />
  )
}
