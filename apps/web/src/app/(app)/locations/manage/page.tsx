// /locations/manage — the Locations administration hub. Tiles for org units and
// custom fields, driven by the module-admin registry. Gated to people who can
// manage the org; everyone else lands on the locations list.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Locations administration' }

export default async function LocationsManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('locations')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect(mod.href)
  return <ModuleManageHub module={mod} />
}
