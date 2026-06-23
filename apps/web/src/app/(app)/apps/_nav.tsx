// Builder app-type strip — the same shared <ModuleSubNav> pills every other
// module home uses, rendered directly with no Manage pill (the Builder IS the
// global form-admin surface, so it isn't in MODULE_ADMIN). The tabs filter the
// one /apps page by app kind via a query param, so hrefs are built per-request
// to keep the active search term. (App kind is the generic taxonomy — there are
// no hardcoded safety-domain categories here.)

import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'

const KIND_FILTERS = [
  { value: '', label: 'All' },
  { value: 'form', label: 'Forms' },
  { value: 'wizard', label: 'Wizards' },
  { value: 'checklist', label: 'Checklists' },
  { value: 'register', label: 'Registers' },
  { value: 'mini_app', label: 'Mini-apps' },
] as const

export function FormsKindNav({ active, q }: { active: string; q: string }) {
  const tabs = KIND_FILTERS.map((c) => {
    const params = new URLSearchParams()
    if (c.value) params.set('kind', c.value)
    if (q) params.set('q', q)
    return {
      key: c.value || 'all',
      label: c.label,
      href: params.toString() ? `/apps?${params.toString()}` : '/apps',
    }
  })
  return <ModuleSubNav tabs={tabs} active={active || 'all'} />
}
