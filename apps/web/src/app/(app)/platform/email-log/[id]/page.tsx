import { EmailLogDetailView } from '@/components/email-log/detail-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Email · ${id.slice(0, 8)}` }
}

export default async function PlatformEmailLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return (
    <EmailLogDetailView
      id={id}
      scope="platform"
      back={{ href: '/platform/email-log', label: 'Back to email log' }}
    />
  )
}
