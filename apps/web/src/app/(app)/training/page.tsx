import { redirect } from 'next/navigation'

// The training landing IS the clean, standard records list. The legacy
// multi-table dashboard (certs issued / expired / attempts / failed) was
// retired in favour of the standard list aesthetic — its data lives in the
// Records table's filters (expiry / source / search) and in the Assessments
// tab (attempts + failed). Add an "Overview" tab back if a dashboard is wanted.
export default function TrainingIndexPage() {
  redirect('/training/records')
}
