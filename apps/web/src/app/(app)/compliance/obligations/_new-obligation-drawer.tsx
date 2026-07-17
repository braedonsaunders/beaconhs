'use client'

import { useRouter } from 'next/navigation'
import { UrlDrawer } from '@beaconhs/ui'
import type { ComplianceTargetRef } from '@beaconhs/db/schema'
import { ObligationForm, type ObligationTargets } from './_obligation-form'
import type { AudienceOptions } from '@/components/audience-picker'
import type { ObligationKind } from './_meta'
import { useGeneratedValueTranslations } from '@/i18n/generated'

export function NewObligationDrawer({
  open,
  closeHref,
  initialKind,
  targets,
  audienceOptions,
  prefillTargetRef,
}: {
  open: boolean
  closeHref: string
  initialKind: ObligationKind
  targets: ObligationTargets
  audienceOptions: AudienceOptions
  prefillTargetRef: ComplianceTargetRef
}) {
  const router = useRouter()
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={tGeneratedValue('New obligation')}
      description={tGeneratedValue('Define the requirement, audience, and due schedule.')}
      size="lg"
    >
      <ObligationForm
        initialKind={initialKind}
        targets={targets}
        audienceOptions={audienceOptions}
        prefillTargetRef={prefillTargetRef}
        onClose={() => {
          router.replace(closeHref)
          router.refresh()
        }}
      />
    </UrlDrawer>
  )
}
