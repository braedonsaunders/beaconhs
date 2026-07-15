import { getGeneratedTranslations } from '@/i18n/generated.server'
// /people/manage — the People administration hub. Tiles for departments,
// groups, job titles and the org chart, driven by the module-admin registry.
// Gated to people who can manage the org; everyone else lands on the directory.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_12c4f582511d38') }
}

export default async function PeopleManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('people')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect(mod.href)
  return <ModuleManageHub module={mod} />
}
