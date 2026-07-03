import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// The full-page "new assessment" form is gone — picking a type happens in the
// assessments-list flyout, and everything else (site, project, supervisor,
// job scope, location) is captured inline on the assessment itself. This route
// must never create a record: a GET can be fired by prefetch, history
// re-navigation, or a cross-site top-level link, so creation always requires
// the explicit type-card click in the flyout (a POST server action).
export default function NewAssessmentRedirect() {
  redirect('/hazard-assessments?drawer=new')
}
