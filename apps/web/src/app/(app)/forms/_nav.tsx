// Builder (forms) category strip — the same shared <ModuleSubNav> pills every
// other module home uses, rendered directly with no Manage pill (the Builder IS
// the global form-admin surface, so it isn't in MODULE_ADMIN). The tabs are
// query-param filters on the one /forms page, so hrefs are built per-request to
// keep the active search term.

import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'

const CATEGORY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'jsha', label: 'JSHA' },
  { value: 'toolbox_talk', label: 'Toolbox talk' },
  { value: 'lift_plan', label: 'Lift plan' },
  { value: 'wah', label: 'WAH rescue' },
  { value: 'incident_investigation', label: 'Incident investigation' },
  { value: 'custom', label: 'Custom' },
] as const

export function FormsCategoryNav({ active, q }: { active: string; q: string }) {
  const tabs = CATEGORY_FILTERS.map((c) => {
    const params = new URLSearchParams()
    if (c.value) params.set('category', c.value)
    if (q) params.set('q', q)
    return {
      key: c.value || 'all',
      label: c.label,
      href: params.toString() ? `/forms?${params.toString()}` : '/forms',
    }
  })
  return <ModuleSubNav tabs={tabs} active={active || 'all'} />
}
