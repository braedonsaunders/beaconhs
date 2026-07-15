import { getGeneratedTranslations } from '@/i18n/generated.server'
import { notFound, redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { SmsLogDetailView } from '@/components/sms-log/detail-view'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_1e9c913c9245ae', { value0: id.slice(0, 8) }) }
}

export default async function SmsLogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.audit.read')) redirect('/admin')

  return (
    <SmsLogDetailView
      id={id}
      scope="tenant"
      back={{ href: '/admin/sms-log', label: 'Back to SMS log' }}
    />
  )
}
