// /training/manage — the Training administration hub. Tiles for skill types,
// authorities and assessment types, driven by the module-admin registry. Gated
// to training managers; everyone else lands on the records list.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Training administration' }

export default async function TrainingManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('training')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect(mod.href)
  return <ModuleManageHub module={mod} />
}
