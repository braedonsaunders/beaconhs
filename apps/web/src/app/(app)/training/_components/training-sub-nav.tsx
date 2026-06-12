// Training sub-nav — a thin delegate to the shared, registry-driven <ModuleNav>.
// Operational tabs (Records / Courses / Classes / Assessments / Assignments /
// Matrix / Transcripts / Reports) + a Manage pill; the admin catalogues (skill
// types, authorities, assessment types) live in /training/manage.

import { ModuleNav } from '@/components/module-admin/module-nav'

export type TrainingTab =
  | 'records'
  | 'skills'
  | 'courses'
  | 'library'
  | 'credential-designs'
  | 'classes'
  | 'assessments'
  | 'assessment-types'
  | 'matrix'
  | 'transcripts'
  | 'skill-types'
  | 'authorities'

export function TrainingSubNav({ active }: { active: TrainingTab }) {
  return <ModuleNav moduleKey="training" active={active} />
}
