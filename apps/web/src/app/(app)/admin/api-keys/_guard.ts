import 'server-only'

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'

/** API keys are a privileged credential — gate every page and action on the
 *  dedicated permission (super-admins always pass). Shared by the list page,
 *  the edit page, and the server actions so the gate stays in one place. */
export async function requireApiKeyAdmin() {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin && !can(ctx, 'admin.api-keys.manage')) redirect('/admin')
  return ctx
}
