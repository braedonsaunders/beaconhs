// /documents/manage — the Documents administration hub. Tiles for the document
// and reference taxonomies, driven by the module-admin registry. Gated to
// document managers; everyone else lands on the library.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Documents administration' }

export default async function DocumentsManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('documents')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect(mod.href)
  return <ModuleManageHub module={mod} />
}
