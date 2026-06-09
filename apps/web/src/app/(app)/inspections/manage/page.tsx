// /inspections/manage — the Inspections administration hub. Tiles for types,
// assignments and criteria banks, driven by the module-admin registry. Gated to
// people who can build/read form templates; everyone else lands on the module.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Inspections administration' }

export default async function InspectionsManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('inspections')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect(mod.href)
  return <ModuleManageHub module={mod} />
}
