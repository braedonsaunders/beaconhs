import { getGeneratedTranslations } from '@/i18n/generated.server'
import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { EmailLogListView } from '@/components/email-log/list-view'
import { requireRequestContext } from '@/lib/auth'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0d39bd3942858a') }
}
export const dynamic = 'force-dynamic'

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'admin.audit.read')) redirect('/admin')

  const sp = await searchParams
  return (
    <EmailLogListView
      searchParams={sp}
      scope="tenant"
      basePath="/admin/email-log"
      back={{ href: '/admin', label: 'Back to admin' }}
    />
  )
}
