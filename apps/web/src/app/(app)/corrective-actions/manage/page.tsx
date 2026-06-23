// /corrective-actions/manage — the Corrective Actions administration hub, driven
// by the module-admin registry. Gated to CA managers.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Corrective action administration' }

export default async function CorrectiveActionsManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('corrective-actions')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect('/corrective-actions')
  return <ModuleManageHub module={mod} />
}
