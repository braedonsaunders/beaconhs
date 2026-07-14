import { PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { assertCan } from '@beaconhs/tenant'
import { PageContainer } from '@/components/page-layout'
import { pickString } from '@/lib/list-params'
import { ObligationForm } from '../_obligation-form'
import { loadObligationFormOptions } from '../_form-options'
import { OBLIGATION_KINDS, type ObligationKind } from '../_meta'

export const metadata = { title: 'New obligation' }
export const dynamic = 'force-dynamic'

export default async function NewObligationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.assign')
  const sp = await searchParams
  const rawKind = pickString(sp.kind)
  const initialKind: ObligationKind = OBLIGATION_KINDS.includes(rawKind as ObligationKind)
    ? (rawKind as ObligationKind)
    : 'inspection'

  // Pre-select the target when arriving from a module's "make this a compliance
  // obligation" link (e.g. a Builder app passes ?kind=form&formTemplateId=…).
  const prefillTargetRef = {
    formTemplateId: pickString(sp.formTemplateId),
    inspectionTypeId: pickString(sp.inspectionTypeId),
    documentId: pickString(sp.documentId),
    courseId: pickString(sp.courseId),
    skillTypeId: pickString(sp.skillTypeId),
  }

  const { targets, audienceOptions } = await loadObligationFormOptions(ctx, {
    targetRef: prefillTargetRef,
  })

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="New obligation"
          description="Select a kind, requirement, audience, and cadence. One form for every compliance obligation."
          back={{ href: '/compliance/obligations', label: 'Back to obligations' }}
        />
        <ObligationForm
          initialKind={initialKind}
          targets={targets}
          audienceOptions={audienceOptions}
          prefillTargetRef={prefillTargetRef}
        />
      </div>
    </PageContainer>
  )
}
