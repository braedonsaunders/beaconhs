// HazID / JSHA sub-nav — a thin delegate to the shared, registry-driven
// <ModuleNav>. Call sites pass the current pathname (server components have no
// usePathname); we map it to the registry tab key here. Operational tabs
// (Assessments / Hazards / Tasks / Signed reports) + a Manage pill; the admin
// taxonomies (hazard types/sets, assessment types) live in /hazid/manage.

import { ModuleNav } from '@/components/module-admin/module-nav'

function activeFor(pathname: string): string {
  if (/^\/hazid\/hazards\/types/.test(pathname)) return 'hazard-types'
  if (/^\/hazid\/hazards\/sets/.test(pathname)) return 'hazard-sets'
  if (/^\/hazid\/hazards/.test(pathname)) return 'hazards'
  if (/^\/hazid\/tasks/.test(pathname)) return 'tasks'
  if (/^\/hazid\/types/.test(pathname)) return 'assessment-types'
  if (/^\/hazid\/reports\/signed/.test(pathname)) return 'signed'
  return 'assessments'
}

export function HazidSubNav({ pathname }: { pathname: string }) {
  return <ModuleNav moduleKey="hazid" active={activeFor(pathname)} />
}
