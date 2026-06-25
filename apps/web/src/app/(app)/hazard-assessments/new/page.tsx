import { redirect } from 'next/navigation'
import { pickString } from '@/lib/list-params'
import { startAssessment } from '../_actions'

export const dynamic = 'force-dynamic'

// The full-page "new assessment" form is gone — picking a type now happens in
// the assessments-list flyout, and everything else (site, project, supervisor,
// job scope, location) is captured inline on the assessment itself. An
// `?assessmentTypeId=` deep link creates straight away; otherwise we just open
// the flyout.
export default async function NewAssessmentRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const typeId = pickString(sp.assessmentTypeId) ?? pickString(sp.typeId)
  if (typeId) {
    const fd = new FormData()
    fd.set('assessmentTypeId', typeId)
    await startAssessment(fd) // creates the assessment, then redirects to it
  }
  redirect('/hazard-assessments?drawer=new')
}
