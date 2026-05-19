'use client'

// Drawer-body widget for adding a lift-plan signature. Pairs with a parent
// `<UrlDrawer drawer=add-signature>` whose footer Submit button targets
// `form={formId}`.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Label, Select } from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'
import {
  LIFT_PLAN_SIGNATURE_ROLES,
  formatRole,
  type LiftPlanSignatureRole,
  type PersonForPicker,
} from '../_types'

type SignerKind = 'internal' | 'external'

export function AddSignatureBody({
  formId,
  liftPlanId,
  people,
  existingRoles,
  action,
  closeHref,
}: {
  formId: string
  liftPlanId: string
  people: PersonForPicker[]
  existingRoles: LiftPlanSignatureRole[]
  action: (formData: FormData) => Promise<void>
  closeHref: string
}) {
  const router = useRouter()
  const [role, setRole] = useState<LiftPlanSignatureRole>(
    LIFT_PLAN_SIGNATURE_ROLES.find((r) => !existingRoles.includes(r)) ?? 'supervisor',
  )
  const [kind, setKind] = useState<SignerKind>('internal')
  const [personId, setPersonId] = useState('')
  const [externalName, setExternalName] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    if (kind === 'internal' && !personId) {
      setError('Pick an internal signer')
      return
    }
    if (kind === 'external' && !externalName.trim()) {
      setError('External signer needs a name')
      return
    }
    if (!signature) {
      setError('Capture a signature')
      return
    }
    const fd = new FormData()
    fd.set('liftPlanId', liftPlanId)
    fd.set('role', role)
    if (kind === 'internal') fd.set('personId', personId)
    else fd.set('externalName', externalName)
    fd.set('signatureDataUrl', signature)
    start(async () => {
      await action(fd)
      router.push(closeHref as any)
      router.refresh()
    })
  }

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as LiftPlanSignatureRole)}
            disabled={pending}
          >
            {LIFT_PLAN_SIGNATURE_ROLES.map((r) => (
              <option key={r} value={r}>
                {formatRole(r)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Signer</Label>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as SignerKind)}
            disabled={pending}
          >
            <option value="internal">Internal (employee)</option>
            <option value="external">External (contractor / visitor)</option>
          </Select>
        </div>
      </div>
      {kind === 'internal' ? (
        <div className="space-y-1.5">
          <Label>Person</Label>
          <Select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            disabled={pending}
          >
            <option value="">—</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.lastName}, {p.firstName}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>Name</Label>
          <Input
            value={externalName}
            onChange={(e) => setExternalName(e.target.value)}
            placeholder="Full name"
            disabled={pending}
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Signature</Label>
        <SignaturePad value={signature} onChange={setSignature} height={140} />
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </form>
  )
}
