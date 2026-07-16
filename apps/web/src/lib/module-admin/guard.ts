// Server-only authorization guards for module administration. The permission
// for each module lives in the module-admin registry, so gating a page or a
// mutating action is a one-liner that can never drift from the Manage hub / the
// /admin rollup tile (they read the same `permission`). Use `requireModuleManage`
// at the top of every /<module>/manage page AND every admin/config CRUD page it
// links to; use `assertCanManageModule` inside the server actions those pages
// invoke so the gate can't be bypassed by a crafted request.

import { redirect } from 'next/navigation'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { moduleAdminByKey } from './registry'

type Ctx = Awaited<ReturnType<typeof requireRequestContext>>

const FLOW_SUBJECT_MODULE: Record<string, string> = {
  'document-signoffs': 'documents',
}

function permissionModule(moduleKey: string) {
  return moduleAdminByKey(FLOW_SUBJECT_MODULE[moduleKey] ?? moduleKey)
}

/** True when the viewer may administer the given module. */
export function canManageModule(ctx: Ctx, moduleKey: string): boolean {
  const m = permissionModule(moduleKey)
  if (!m) return false
  return ctx.isSuperAdmin || can(ctx, m.permission)
}

/**
 * Page guard: resolve the request context, and redirect non-managers to the
 * module home. Returns the context so the page can keep using it. Drop-in
 * replacement for `const ctx = await requireRequestContext()` on admin pages.
 */
export async function requireModuleManage(moduleKey: string): Promise<Ctx> {
  const ctx = await requireRequestContext()
  const m = permissionModule(moduleKey)
  if (!m) redirect('/')
  if (!canManageModule(ctx, moduleKey)) redirect(m.href)
  return ctx
}

/**
 * Action guard: throw if the viewer may not administer the module. Call at the
 * top of every create/update/delete server action behind a module's Manage hub.
 */
export function assertCanManageModule(ctx: Ctx, moduleKey: string): void {
  if (!canManageModule(ctx, moduleKey)) {
    const m = permissionModule(moduleKey)
    throw new Error(`Forbidden: ${m?.permission ?? 'manage'} permission required`)
  }
}
