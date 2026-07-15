'use client'

import { useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// Edit an obligation in a right-side flyout, opened from the detail page via
// ?drawer=edit (so it survives refresh and is link-shareable). Reuses the
// unified ObligationForm in embedded mode — on save it closes the drawer and
// refreshes the detail page, where compliance has re-computed.

import { useRouter } from 'next/navigation'
import { UrlDrawer } from '@beaconhs/ui'
import type { AudienceOptions } from '@/components/audience-picker'
import {
  ObligationForm,
  type ObligationFormInitial,
  type ObligationTargets,
} from '../_obligation-form'
import type { ObligationKind } from '../_meta'

export type ObligationEditData = {
  kind: ObligationKind
  targets: ObligationTargets
  audienceOptions: AudienceOptions
  initial: ObligationFormInitial
}

export function ObligationEditDrawer({
  edit,
  closeHref,
}: {
  edit: ObligationEditData | null
  closeHref: string
}) {
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  function close() {
    router.push(closeHref)
    router.refresh()
  }
  return (
    <UrlDrawer
      open={edit !== null}
      closeHref={closeHref}
      title={tGenerated('m_17a2d7d0c66b35')}
      description={tGenerated('m_0e0e1f163269fd')}
      size="xl"
    >
      <GeneratedValue
        value={
          edit ? (
            <ObligationForm
              key={edit.initial.id}
              initialKind={edit.kind}
              targets={edit.targets}
              audienceOptions={edit.audienceOptions}
              initial={edit.initial}
              onClose={close}
            />
          ) : null
        }
      />
    </UrlDrawer>
  )
}
