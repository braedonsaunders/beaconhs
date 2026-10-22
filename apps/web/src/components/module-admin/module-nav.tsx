// Operational module tabs and a permission-aware Manage link. Configuration
// pages use the persistent management sidebar supplied by the app layout.

import { ModuleSubNav } from './module-sub-nav'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { canManageModule, moduleManagementNavigation } from '@/lib/module-admin/guard'
import { getRequestContext } from '@/lib/auth'
import { can } from '@beaconhs/tenant'

export async function ModuleNav({ moduleKey, active }: { moduleKey: string; active: string }) {
  const m = moduleAdminByKey(moduleKey)
  if (!m) return null

  const isAdmin = m.sections.some((s) => s.key === active)
  // The persistent management sidebar owns navigation on configuration pages.
  if (isAdmin) return null

  const ctx = await getRequestContext()
  const canManage = ctx ? canManageModule(ctx, moduleKey) : false
  const hasManagementPages = ctx
    ? moduleManagementNavigation(ctx).some((entry) => entry.managePath === m.managePath)
    : false
  const visibleTabs = ctx
    ? m.tabs.filter(
        (tab) =>
          canManage ||
          ((!tab.permission || can(ctx, tab.permission)) &&
            (!tab.requiredAnyPermission?.length ||
              tab.requiredAnyPermission.some((permission) => can(ctx, permission)))),
      )
    : m.tabs.filter((tab) => !tab.permission && !tab.requiredAnyPermission?.length)
  return (
    <ModuleSubNav
      tabs={visibleTabs}
      active={active}
      manageHref={hasManagementPages ? m.managePath : undefined}
    />
  )
}
