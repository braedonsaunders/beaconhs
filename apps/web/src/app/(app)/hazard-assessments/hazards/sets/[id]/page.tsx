import { redirect } from 'next/navigation'
import { requireModuleManage } from '@/lib/module-admin/guard'

export default async function Redirect({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleManage('hazid')
  const { id } = await params
  redirect(`/hazard-assessments/hazards/sets/${id}/edit`)
}
