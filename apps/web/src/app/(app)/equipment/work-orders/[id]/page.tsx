import { notFound } from 'next/navigation'
import { isUuid } from '@/lib/list-params'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { WorkOrderDrawer } from './_panel'
import WorkOrdersPage from '../page'

export const dynamic = 'force-dynamic'
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  if (!isUuid(id)) notFound()
  return { title: tGenerated('m_168d111aeb2bb7', { value0: id.slice(0, 8) }) }
}

export default async function WorkOrderDetailPage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await props.params
  if (!isUuid(id)) notFound()
  return (
    <>
      <WorkOrdersPage searchParams={Promise.resolve({})} />
      <WorkOrderDrawer {...props} />
    </>
  )
}
