// /ppe/manage — the PPE administration hub. Tiles for PPE types and the
// inspection-criteria overview, driven by the module-admin registry. Gated to
// people who can read all PPE; everyone else lands on the register.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'PPE administration' }

export default async function PpeManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('ppe')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect(mod.href)
  return <ModuleManageHub module={mod} />
}
