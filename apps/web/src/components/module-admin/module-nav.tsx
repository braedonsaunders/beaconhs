// Registry-driven module nav strip. Encapsulates the "operate vs administer"
// split so every module's *-sub-nav.tsx collapses to a one-line delegate:
//   - on an operational page → the module's operational tabs + a "Manage" pill
//   - on an admin/config page → a "‹ Module" back pill + the admin section tabs
// Everything renders through the single shared <ModuleSubNav>; nothing is
// bespoke per module. The active key decides which face to show: any key that
// matches an admin section renders the admin face, otherwise the operational one.

import { ModuleSubNav } from './module-sub-nav'
import { moduleAdminByKey } from '@/lib/module-admin/registry'

export function ModuleNav({ moduleKey, active }: { moduleKey: string; active: string }) {
  const m = moduleAdminByKey(moduleKey)
  if (!m) return null

  const isAdmin = m.sections.some((s) => s.key === active)
  if (isAdmin) {
    return (
      <ModuleSubNav
        active={active}
        tabs={[
          { key: '__back', label: `‹ ${m.label}`, href: m.href },
          ...m.sections.map((s) => ({ key: s.key, label: s.label, href: s.href })),
        ]}
      />
    )
  }

  return <ModuleSubNav tabs={m.tabs} active={active} manageHref={m.managePath} />
}
