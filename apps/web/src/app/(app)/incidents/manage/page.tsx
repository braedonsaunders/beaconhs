// /incidents/manage — the Incidents administration hub. Tiles for the module's
// taxonomies (classifications, injury types, hours), driven by the module-admin
// registry. Gated to managers; everyone else lands on the incident log.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Incidents administration' }

export default async function IncidentsManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('incidents')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect(mod.href)
  return <ModuleManageHub module={mod} />
}
