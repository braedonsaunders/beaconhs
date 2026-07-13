// Builder app-type strip — the same shared <ModuleSubNav> pills every other
// module home uses, rendered directly with no Manage pill (the Builder IS the
// global form-admin surface, so it isn't in MODULE_ADMIN). The tabs filter the
// one /apps page by app kind via a query param, so hrefs are built per-request
// to preserve the active search and sort while resetting pagination. (App kind
// is the generic taxonomy — there are no hardcoded safety-domain categories.)

import { ModuleSubNav } from '@/components/module-admin/module-sub-nav'
import { mergeHref } from '@/lib/list-params'

const KIND_FILTERS = [
  { value: '', label: 'All' },
  { value: 'form', label: 'Forms' },
  { value: 'wizard', label: 'Wizards' },
  { value: 'checklist', label: 'Checklists' },
  { value: 'register', label: 'Registers' },
  { value: 'mini_app', label: 'Mini-apps' },
] as const

export function FormsKindNav({
  active,
  currentParams,
}: {
  active: string
  currentParams: Record<string, string | string[] | undefined>
}) {
  const tabs = KIND_FILTERS.map((c) => {
    return {
      key: c.value || 'all',
      label: c.label,
      href: mergeHref('/apps', currentParams, { kind: c.value || undefined, page: 1 }),
    }
  })
  return <ModuleSubNav tabs={tabs} active={active || 'all'} />
}
