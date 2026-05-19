'use client'

import { useState, useTransition } from 'react'
import { Button, Input, Label, Select } from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'
import {
  LIFT_PLAN_SIGNATURE_ROLES,
  formatRole,
  type LiftPlanSignatureRole,
  type PersonForPicker,
} from './_types'

type SignerKind = 'internal' | 'external'

/**
 * Capture a single signature for one role. Internal signer picks from the
 * tenant's people directory; external signer types a name. Both require a
 * signature on the canvas before submit.
 */
export function AddSignatureForm({
  liftPlanId,
  people,
  existingRoles,
  addAction,
}: {
  liftPlanId: string
  people: PersonForPicker[]
  existingRoles: LiftPlanSignatureRole[]
  addAction: (formData: FormData) => Promise<void>
}) {
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
      await addAction(fd)
      setPersonId('')
      setExternalName('')
      setSignature(null)
    })
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/40 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Select value={role} onChange={(e) => setRole(e.target.value as LiftPlanSignatureRole)}>
            {LIFT_PLAN_SIGNATURE_ROLES.map((r) => (
              <option key={r} value={r}>
                {formatRole(r)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Signer</Label>
          <Select value={kind} onChange={(e) => setKind(e.target.value as SignerKind)}>
            <option value="internal">Internal (employee)</option>
            <option value="external">External (contractor / visitor)</option>
          </Select>
        </div>
        {kind === 'internal' ? (
          <div className="space-y-1.5">
            <Label>Person</Label>
            <Select value={personId} onChange={(e) => setPersonId(e.target.value)}>
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
            />
          </div>
        )}
      </div>
      <SignaturePad value={signature} onChange={setSignature} />
      {error ? <div className="text-xs text-red-600">{error}</div> : null}
      <div className="flex items-center justify-end">
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : 'Add signature'}
        </Button>
      </div>
    </div>
  )
}

/**
 * Re-sign an existing slot. Used to re-collect after an unlock cleared all
 * signatures.
 */
export function ResignForm({
  signatureId,
  liftPlanId,
  updateAction,
}: {
  signatureId: string
  liftPlanId: string
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [signature, setSignature] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    if (!signature) return
    const fd = new FormData()
    fd.set('id', signatureId)
    fd.set('liftPlanId', liftPlanId)
    fd.set('signatureDataUrl', signature)
    start(async () => {
      await updateAction(fd)
      setSignature(null)
    })
  }
  return (
    <div className="space-y-2">
      <SignaturePad value={signature} onChange={setSignature} height={100} />
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={submit} disabled={pending || !signature}>
          {pending ? 'Saving…' : 'Save signature'}
        </Button>
      </div>
    </div>
  )
}
