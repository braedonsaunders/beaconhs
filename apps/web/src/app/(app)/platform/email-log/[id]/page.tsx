import { getGeneratedTranslations } from '@/i18n/generated.server'
import { notFound } from 'next/navigation'
import { EmailLogDetailView } from '@/components/email-log/detail-view'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_0476cbf4caf3d0', { value0: id.slice(0, 8) }) }
}

export default async function PlatformEmailLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  return (
    <EmailLogDetailView
      id={id}
      scope="platform"
      back={{ href: '/platform/email-log', label: 'Back to email log' }}
    />
  )
}
