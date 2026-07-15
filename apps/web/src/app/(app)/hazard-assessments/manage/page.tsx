import { getGeneratedTranslations } from '@/i18n/generated.server'
// /hazard-assessments/manage — the Hazard Assessments administration hub. Tiles for hazard types,
// hazard sets and assessment types, driven by the module-admin registry. Gated
// to admins; everyone else lands on the assessments list.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0ae4a97ad888a5') }
}

export default async function HazidManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('hazid')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect(mod.href)
  return <ModuleManageHub module={mod} />
}
