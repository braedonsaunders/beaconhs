// /equipment/vehicle-log/manage — Vehicle log administration hub. Tiles for
// log-mode settings and automations, driven by the module-admin registry.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Vehicle log administration' }

export default async function VehicleLogManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('vehicle-log')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect(mod.href)
  return <ModuleManageHub module={mod} />
}
