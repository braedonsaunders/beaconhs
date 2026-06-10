import { redirect } from 'next/navigation'

// The hardcoded CWB welder report was replaced by a tenant-editable custom
// definition over the `skill_assignments` report entity ("Skills &
// certifications roster"). Forward old bookmarks to the report builder.
export default function CwbRedirect() {
  redirect('/reports/definitions')
}
