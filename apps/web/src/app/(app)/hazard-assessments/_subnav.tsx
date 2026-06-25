// Hazard Assessments sub-nav — a thin delegate to the shared, registry-driven
// <ModuleNav>. Call sites pass the current pathname (server components have no
// usePathname); we map it to the registry tab key here. The operational face
// only has Assessments; library/type pages render as the Manage face.

import { ModuleNav } from '@/components/module-admin/module-nav'

function activeFor(pathname: string): string {
  if (/^\/hazard-assessments\/hazards\/types/.test(pathname)) return 'hazard-types'
  if (/^\/hazard-assessments\/hazards\/sets/.test(pathname)) return 'hazard-sets'
  if (/^\/hazard-assessments\/hazards/.test(pathname)) return 'hazards'
  if (/^\/hazard-assessments\/tasks/.test(pathname)) return 'tasks'
  if (/^\/hazard-assessments\/types/.test(pathname)) return 'assessment-types'
  if (/^\/hazard-assessments\/risk-matrix/.test(pathname)) return 'risk-matrix'
  return 'assessments'
}

export function HazidSubNav({ pathname }: { pathname: string }) {
  return <ModuleNav moduleKey="hazid" active={activeFor(pathname)} />
}
