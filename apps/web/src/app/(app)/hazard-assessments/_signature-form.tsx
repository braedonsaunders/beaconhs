'use client'

import { useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, Input, Label, SearchSelect, Select } from '@beaconhs/ui'
import { SignaturePad } from '@/components/signature-pad'

type Person = { id: string; firstName: string; lastName: string; employeeNo?: string | null }

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
  const tGenerated = useGeneratedTranslations()
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
    // Only send the identity field for the selected signer type — a value left
    // over from the other mode must not ride along.
    if (type === 'internal') fd.set('personId', personId)
    if (type === 'external') fd.set('externalName', externalName)
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
          <Label>
            <GeneratedText id="m_0eb37b54326290" />
          </Label>
          <Select value={type} onChange={(e) => setType(e.target.value as 'internal' | 'external')}>
            <option value="internal">
              <GeneratedText id="m_1ad5bdc61b1e18" />
            </option>
            <option value="external">
              <GeneratedText id="m_017ddded95fdb4" />
            </option>
          </Select>
        </div>
        <GeneratedValue
          value={
            type === 'internal' ? (
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_12e926c9216094" />
                </Label>
                <SearchSelect
                  value={personId}
                  onChange={setPersonId}
                  options={people.map((p) => ({
                    value: p.id,
                    label: `${p.lastName}, ${p.firstName}`,
                    hint: p.employeeNo ?? undefined,
                  }))}
                  placeholder={tGenerated('m_1217000e094ba7')}
                  clearable
                  emptyLabel="—"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_07381c82ba8cc2" />
                </Label>
                <Input
                  value={externalName}
                  onChange={(e) => setExternalName(e.target.value)}
                  placeholder={tGenerated('m_0b8541b5894beb')}
                />
              </div>
            )
          }
        />
        <GeneratedValue
          value={
            showCSRoles ? (
              <div className="space-y-1.5">
                <Label>
                  <GeneratedText id="m_1dcbcb1a64b03f" />
                </Label>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={csEntrant}
                      onChange={(e) => setCsEntrant(e.target.checked)}
                    />
                    <GeneratedText id="m_022b05599a1a05" />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={csAttendant}
                      onChange={(e) => setCsAttendant(e.target.checked)}
                    />
                    <GeneratedText id="m_0d8bbd3094ef27" />
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={csRescue}
                      onChange={(e) => setCsRescue(e.target.checked)}
                    />
                    <GeneratedText id="m_1bac787ac2b6fc" />
                  </label>
                </div>
              </div>
            ) : null
          }
        />
        <div className="space-y-1.5">
          <Label>
            <GeneratedText id="m_0c0bc02db58371" />
          </Label>
          <SignaturePad value={signature} onChange={setSignature} />
        </div>
        <GeneratedValue
          value={
            err ? (
              <div className="text-sm text-red-600">
                <GeneratedValue value={err} />
              </div>
            ) : null
          }
        />
      </div>
      <div className="sticky bottom-0 -mx-6 mt-6 -mb-5 flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-800 dark:bg-slate-800/50">
        <Link href={closeHref as any}>
          <Button type="button" variant="outline">
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
        </Link>
        <Button type="button" onClick={submit} disabled={pending}>
          <GeneratedValue
            value={
              pending ? (
                <GeneratedText id="m_106811f2aac664" />
              ) : (
                <GeneratedText id="m_173c1ae83a1c73" />
              )
            }
          />
        </Button>
      </div>
    </>
  )
}
