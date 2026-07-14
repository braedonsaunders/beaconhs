import { notFound, redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { EmailLogDetailView } from '@/components/email-log/detail-view'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Email · ${id.slice(0, 8)}` }
}

export default async function EmailLogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.audit.read')) redirect('/admin')

  return (
    <EmailLogDetailView
      id={id}
      scope="tenant"
      back={{ href: '/admin/email-log', label: 'Back to email log' }}
    />
  )
}
