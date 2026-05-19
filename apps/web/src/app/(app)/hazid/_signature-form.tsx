'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, Input, Label, Select } from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'

type Person = { id: string; firstName: string; lastName: string }

/**
 * Drawer body for capturing a new signature. Renders into the body slot of
 * an <UrlDrawer> on the HazID detail page. Closes the drawer (router.replace
 * to `closeHref`) after the server action completes.
 */
export function AddSignatureDrawerBody({
  assessmentId,
  people,
  showCSRoles,
  closeHref,
  addAction,
}: {
  assessmentId: string
  people: Person[]
  showCSRoles: boolean
  closeHref: string
  addAction: (formData: FormData) => Promise<void>
}) {
  const router = useRouter()
  const [type, setType] = useState<'internal' | 'external'>('internal')
  const [personId, setPersonId] = useState<string>('')
  const [externalName, setExternalName] = useState<string>('')
  const [signature, setSignature] = useState<string | null>(null)
  const [csEntrant, setCsEntrant] = useState(false)
  const [csAttendant, setCsAttendant] = useState(false)
  const [csRescue, setCsRescue] = useState(false)
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function submit() {
    setErr(null)
    if (type === 'internal' && !personId) {
      setErr('Pick an internal signer')
      return
    }
    if (type === 'external' && !externalName.trim()) {
      setErr('External signer needs a name')
      return
    }
    if (!signature) {
      setErr('Capture a signature')
      return
    }
    const fd = new FormData()
    fd.set('assessmentId', assessmentId)
    fd.set('signatureType', type)
    fd.set('personId', personId)
    fd.set('externalName', externalName)
    fd.set('signatureDataUrl', signature)
    if (showCSRoles) {
      if (csEntrant) fd.set('csEntrant', 'on')
      if (csAttendant) fd.set('csAttendant', 'on')
      if (csRescue) fd.set('csRescue', 'on')
    }
    start(async () => {
      await addAction(fd)
      router.replace(closeHref as any)
    })
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Signer type</Label>
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as 'internal' | 'external')}
          >
            <option value="internal">Internal (employee)</option>
            <option value="external">External (visitor / contractor)</option>
          </Select>
        </div>
        {type === 'internal' ? (
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
            <Label>External name</Label>
            <Input
              value={externalName}
              onChange={(e) => setExternalName(e.target.value)}
              placeholder="Full name"
            />
          </div>
        )}
        {showCSRoles ? (
          <div className="space-y-1.5">
            <Label>CS role(s)</Label>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={csEntrant}
                  onChange={(e) => setCsEntrant(e.target.checked)}
                />
                Entrant
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={csAttendant}
                  onChange={(e) => setCsAttendant(e.target.checked)}
                />
                Attendant
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={csRescue}
                  onChange={(e) => setCsRescue(e.target.checked)}
                />
                Rescue
              </label>
            </div>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label>Signature</Label>
          <SignaturePad value={signature} onChange={setSignature} />
        </div>
        {err ? <div className="text-sm text-red-600">{err}</div> : null}
      </div>
      <div className="sticky bottom-0 -mx-6 -mb-5 mt-6 flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3">
        <Link href={closeHref as any}>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </Link>
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : 'Add signature'}
        </Button>
      </div>
    </>
  )
}
