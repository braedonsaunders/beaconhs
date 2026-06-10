import { redirect } from 'next/navigation'

// Training's report links moved into the global report builder (/reports) —
// incl. the CWB welder roster, now a tenant-editable custom definition over
// the skill_assignments entity. Matrix + transcripts remain training tabs.
export default function TrainingReportsRedirect() {
  redirect('/reports/definitions')
}
