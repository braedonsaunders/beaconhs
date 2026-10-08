'use client'

import { useState, useTransition } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { Button, Drawer } from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { unwrapSigningResult } from '@/lib/hazid-signing-result'
import { signCrewMember } from './_signing-actions'

export function CrewSignatureDrawer({
  revision,
  signers,
  ready,
  onSaved,
  onClose,
}: {
  revision: number
  ready: boolean
  signers: { id: string; name: string }[]
  onSaved: () => Promise<void>
  onClose: () => void
}) {
  const t = useGeneratedValueTranslations()
  const [index, setIndex] = useState(0)
  const [ink, setInk] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const signer = signers[index]
  function close() {
    if (
      pending ||
      (ink &&
        !window.confirm(
          t('Leave without saving this signature? Already saved signatures are safe.'),
        ))
    )
      return
    onClose()
  }
  return (
    <Drawer
      open
      onClose={close}
      title={signer?.name ?? t('Sign')}
      size="sm"
      footer={
        <Button
          className="h-11 min-w-24"
          disabled={pending || !ready || !ink || !signer}
          onClick={() => {
            if (!ready || !ink || !signer) return
            setError(null)
            start(async () => {
              try {
                unwrapSigningResult(await signCrewMember(signer.id, revision, ink))
                setInk(null)
                if (index + 1 < signers.length) setIndex((i) => i + 1)
                else onClose()
                await onSaved()
              } catch (err) {
                unstable_rethrow(err)
                setError(
                  err instanceof Error ? err.message : 'Could not save your signature. Try again.',
                )
              }
            })
          }}
        >
          <GeneratedValue value={pending ? 'Saving…' : 'Done'} />
        </Button>
      }
    >
      <SignaturePad
        key={signer?.id}
        value={ink}
        onChange={setInk}
        height={200}
        disabled={pending}
      />
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          <GeneratedValue value={error} />
        </p>
      ) : null}
    </Drawer>
  )
}
