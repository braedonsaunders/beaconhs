import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { SmsLogListView } from '@/components/sms-log/list-view'
import { requireRequestContext } from '@/lib/auth'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1e58ae4efd7912') }
}
export const dynamic = 'force-dynamic'

export default async function SmsLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.audit.read')) redirect('/admin')

  const sp = await searchParams
  return (
    <SmsLogListView
      searchParams={sp}
      scope="tenant"
      basePath="/admin/sms-log"
      back={{ href: '/admin', label: 'Back to admin' }}
    />
  )
}
