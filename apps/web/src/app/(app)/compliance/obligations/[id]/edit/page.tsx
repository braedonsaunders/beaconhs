import { notFound } from 'next/navigation'
import { PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { assertCan } from '@beaconhs/tenant'
import { PageContainer } from '@/components/page-layout'
import { EVERYONE_KEY, type AudienceItem } from '@/components/audience-picker'
import { recurrenceValueFromStored } from '@/components/recurrence'
import { ObligationForm } from '../../_obligation-form'
import { loadObligationFormOptions } from '../../_form-options'
import { getObligationWithAudience } from '../../_data'
import { KIND_META, type ObligationKind, kindLabel } from '../../_meta'

export const metadata = { title: 'Edit obligation' }
export const dynamic = 'force-dynamic'

export default async function EditObligationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireRequestContext()
  assertCan(ctx, 'compliance.manage')

  const data = await getObligationWithAudience(ctx, id)
  if (!data) notFound()
  const { ob, audience } = data
  // Only kinds the unified form can author are editable here (everything the
  // hub creates; rules out future ETL-only source modules).
  if (!(ob.sourceModule in KIND_META)) notFound()
  const kind = ob.sourceModule as ObligationKind

  const { targets, audienceOptions } = await loadObligationFormOptions(ctx)

  // Stored audience rows use '' for the everyone sentinel; the picker uses
  // EVERYONE_KEY. Stored recurrence jsonb maps back through the picker's
  // inverse helper.
  const initialAudience: AudienceItem[] = audience.map((a) => ({
    type: a.kind,
    entityKey: a.kind === 'everyone' ? EVERYONE_KEY : a.entityKey,
  }))

  return (
    <PageContainer>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          title="Edit obligation"
          description={`${kindLabel(kind)} · update the target, audience, and cadence. Compliance re-computes immediately on save.`}
          back={{ href: `/compliance/obligations/${ob.id}`, label: 'Back to obligation' }}
        />
        <ObligationForm
          initialKind={kind}
          targets={targets}
          audienceOptions={audienceOptions}
          initial={{
            id: ob.id,
            title: ob.title,
            notes: ob.notes,
            audience: initialAudience,
            recurrence: recurrenceValueFromStored(ob.recurrence),
            targetRef: ob.targetRef ?? {},
          }}
        />
      </div>
    </PageContainer>
  )
}
