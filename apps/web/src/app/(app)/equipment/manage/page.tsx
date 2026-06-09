// /equipment/manage — the Equipment administration hub. Tiles for the asset
// taxonomies (types, categories, inspection types), driven by the module-admin
// registry. Gated to equipment managers; everyone else lands on the register.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Equipment administration' }

export default async function EquipmentManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('equipment')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect(mod.href)
  return <ModuleManageHub module={mod} />
}
