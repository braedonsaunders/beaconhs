import { getGeneratedTranslations } from '@/i18n/generated.server'
// /journals/manage — the Journals administration hub (reference implementation of
// the unified module-admin pattern). Tiles for Records, Tags, and Compliance,
// driven by the module-admin registry. Gated to managers; self-only users go to
// the workspace. The employee /journals workspace stays purely for writing.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { ModuleManageHub } from '@/components/module-admin/module-manage-hub'

export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_15682e6daef5d6') }
}

export default async function JournalsManagePage() {
  const ctx = await requireRequestContext()
  const mod = moduleAdminByKey('journals')!
  if (!ctx.isSuperAdmin && !can(ctx, mod.permission)) redirect('/journals')
  return <ModuleManageHub module={mod} />
}
