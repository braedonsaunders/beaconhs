// Registry-driven module nav strip. Encapsulates the "operate vs administer"
// split so every module's *-sub-nav.tsx collapses to a one-line delegate:
//   - on an operational page → the module's operational tabs + a manager-only
//     "Manage" pill (hidden from viewers without the module's admin permission)
//   - on an admin/config page → a back pill up to the module home + the admin
//     section tabs
// Everything renders through the single shared <ModuleSubNav>; nothing is
// bespoke per module. The active key decides which face to show: any key that
// matches an admin section renders the admin face, otherwise the operational
// one. Server component — it resolves the (request-memoized) context itself so
// call sites stay one-liners.

import { ModuleSubNav } from './module-sub-nav'
import { moduleAdminByKey } from '@/lib/module-admin/registry'
import { canManageModule } from '@/lib/module-admin/guard'
import { getRequestContext } from '@/lib/auth'
import { can } from '@beaconhs/tenant'

export async function ModuleNav({ moduleKey, active }: { moduleKey: string; active: string }) {
  const m = moduleAdminByKey(moduleKey)
  if (!m) return null

  const isAdmin = m.sections.some((s) => s.key === active)
  if (isAdmin) {
    return (
      <ModuleSubNav
        active={active}
        back={{ href: m.href, label: m.label }}
        tabs={m.sections.map((s) => ({ key: s.key, label: s.label, href: s.href }))}
      />
    )
  }

  const ctx = await getRequestContext()
  const canManage = ctx ? canManageModule(ctx, moduleKey) : false
  const visibleTabs = ctx
    ? m.tabs.filter((tab) => !tab.permission || canManage || can(ctx, tab.permission))
    : m.tabs.filter((tab) => !tab.permission)
  return (
    <ModuleSubNav
      tabs={visibleTabs}
      active={active}
      manageHref={canManage ? m.managePath : undefined}
    />
  )
}
