// Training sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tabs (Certificates / Skills / Courses / Classes / Assessments) +
// a Manage pill; the manage surfaces (Library, Card studio, skill types,
// authorities, assessment types) live in /training/manage. The coverage matrix
// lives in Insights; per-person training history lives on each person's page
// (/people/[id]).

import { ModuleNav } from '@/components/module-admin/module-nav'

type TrainingTab =
  | 'records'
  | 'skills'
  | 'courses'
  | 'library'
  | 'credential-designs'
  | 'classes'
  | 'assessments'
  | 'assessment-types'
  | 'skill-types'
  | 'authorities'

export function TrainingSubNav({ active }: { active: TrainingTab }) {
  return <ModuleNav moduleKey="training" active={active} />
}
