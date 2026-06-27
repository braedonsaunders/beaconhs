import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { SmsLogDetailView } from '@/components/sms-log/detail-view'
import { requireRequestContext } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `SMS · ${id.slice(0, 8)}` }
}

export default async function SmsLogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.audit.read')) redirect('/admin')

  const { id } = await params
  return (
    <SmsLogDetailView
      id={id}
      scope="tenant"
      back={{ href: '/admin/sms-log', label: 'Back to SMS log' }}
    />
  )
}
