'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// The kiosk-style group sign-off roster. Pass the device around: each person
// picks their name, signs, and taps "Add signer" — which uploads the signature
// and persists ONE acknowledgment immediately (creating the session on the first
// add), so nothing is lost if the tablet sleeps mid-session. Local state is the
// live roster; every entry is already saved server-side.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, ChevronDown, ChevronRight, PenLine, Trash2, UserPlus, Users } from 'lucide-react'
import { Button, Input, Label, SignaturePad, Textarea } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { addSignOffSigner, completeSignOffSession, removeSignOffSigner } from '../_ack-actions'
import { RawImage } from '@/components/raw-image'

export type SheetSigner = {
  ackId: string
  personId: string
  name: string
  acknowledgedAt: string
  signatureUrl: string | null
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

export function SignOffSheet({
  documentId,
  versionId,
  versionNumber,
  defaultTitle,
  initialRoster,
  initialSessionId,
  initialTitle,
  initialLocation,
  initialNotes,
  initialSiteOrgUnitId,
  completedAt,
  backHref,
}: {
  documentId: string
  versionId: string
  versionNumber: number
  defaultTitle: string
  initialRoster: SheetSigner[]
  initialSessionId: string | null
  initialTitle: string
  initialLocation: string
  initialNotes: string
  initialSiteOrgUnitId: string | null
  completedAt: string | null
  backHref: string
}) {
  const router = useRouter()
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId)
  const [roster, setRoster] = useState<SheetSigner[]>(initialRoster)
  const [title, setTitle] = useState(initialTitle || defaultTitle)
  const [location, setLocation] = useState(initialLocation)
  const [notes, setNotes] = useState(initialNotes)
  const [siteOrgUnitId, setSiteOrgUnitId] = useState(initialSiteOrgUnitId ?? '')
  const [detailsOpen, setDetailsOpen] = useState(false)

  const [personId, setPersonId] = useState('')
  const [sig, setSig] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const signedIds = useMemo(() => new Set(roster.map((r) => r.personId)), [roster])

  function addSigner() {
    if (!personId) {
      toast.error(tGenerated('m_16d72d9e63f13d'))
      return
    }
    if (!sig) {
      toast.error(tGenerated('m_002521e2b63697'))
      return
    }
    startTransition(async () => {
      try {
        const res = await addSignOffSigner({
          documentId,
          versionId,
          session: { id: sessionId, title, location, notes },
          personId,
          signatureDataUrl: sig,
        })
        if (!res.ok) {
          toast.error(tGeneratedValue(res.error))
          return
        }
        setSessionId(res.sessionId)
        setRoster((r) => [
          ...r,
          {
            ackId: res.signer.ackId,
            personId: res.signer.personId,
            name: res.signer.name,
            acknowledgedAt: res.signer.acknowledgedAt,
            signatureUrl: sig,
          },
        ])
        setPersonId('')
        setSig(null)
        toast.success(tGenerated('m_02379147576f90', { value0: res.signer.name }))
      } catch (err) {
        toast.error(
          tGeneratedValue(err instanceof Error ? err.message : tGenerated('m_005c6a6988f649')),
        )
      }
    })
  }

  function removeSigner(ackId: string) {
    const prev = roster
    setRoster((r) => r.filter((x) => x.ackId !== ackId))
    startTransition(async () => {
      const res = await removeSignOffSigner({ documentId, ackId })
      if (!res.ok) {
        toast.error(tGeneratedValue(res.error))
        setRoster(prev)
      }
    })
  }

  function completeSession() {
    if (!sessionId || roster.length === 0) {
      toast.error(tGenerated('m_181a4a77a7bd57'))
      return
    }
    startTransition(async () => {
      const res = await completeSignOffSession({
        documentId,
        sessionId,
        title,
        location,
        notes,
        siteOrgUnitId: siteOrgUnitId || null,
      })
      if (!res.ok) {
        toast.error(tGeneratedValue(res.error))
        return
      }
      toast.success(tGenerated('m_0fa873e4616c26'))
      router.push(backHref)
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {/* Session details */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setDetailsOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-100">
            <GeneratedValue
              value={detailsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            />
            <GeneratedText id="m_1e12ef9292a165" />
          </span>
          <span className="truncate pl-3 text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value={title || <GeneratedText id="m_01e84c627eb6d2" />} />{' '}
            <GeneratedText id="m_03cf121dcd22e3" />
            <GeneratedValue value={versionNumber} />
          </span>
        </button>
        <GeneratedValue
          value={
            detailsOpen ? (
              <div className="space-y-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="space-y-1">
                  <Label htmlFor="so-title">
                    <GeneratedText id="m_0decefd558c355" />
                  </Label>
                  <Input
                    id="so-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={tGenerated('m_016387edb8456c')}
                    disabled={Boolean(completedAt)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>
                    <GeneratedText id="m_09f4d1635fc0f2" />
                  </Label>
                  <RemoteSearchSelect
                    lookup="document-signoff-sites"
                    value={siteOrgUnitId}
                    onChange={setSiteOrgUnitId}
                    placeholder={tGenerated('m_14341b79f2ff1c')}
                    searchPlaceholder={tGenerated('m_14e2a2bb3bbdff')}
                    sheetTitle={tGenerated('m_14341b79f2ff1c')}
                    ariaLabel={tGenerated('m_09f4d1635fc0f2')}
                    disabled={Boolean(completedAt)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="so-location">
                    <GeneratedText id="m_055f11420b2da4" />
                  </Label>
                  <Input
                    id="so-location"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder={tGenerated('m_18d19fe0820620')}
                    disabled={Boolean(completedAt)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="so-notes">
                    <GeneratedText id="m_0b8dadcb78cd08" />
                  </Label>
                  <Textarea
                    id="so-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder={tGenerated('m_0cadbe8ae1ae4e')}
                    disabled={Boolean(completedAt)}
                  />
                </div>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  <GeneratedText id="m_1056b8c872a12a" />
                </p>
              </div>
            ) : null
          }
        />
      </div>

      {/* Add a signer */}
      {!completedAt ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <UserPlus size={16} /> <GeneratedText id="m_03c2011040b1bb" />
          </h3>
          <div className="mt-3 space-y-3">
            <div className="space-y-1">
              <Label>
                <GeneratedText id="m_12e926c9216094" />
              </Label>
              <RemoteSearchSelect
                lookup="document-signoff-people"
                value={personId}
                onChange={setPersonId}
                excludedValues={[...signedIds]}
                placeholder={tGenerated('m_0be39d3a196b5b')}
                searchPlaceholder={tGenerated('m_0b842b664b4f3b')}
                sheetTitle="Add a signer"
                ariaLabel="Signer"
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                <PenLine size={14} /> <GeneratedText id="m_0c0bc02db58371" />
              </div>
              <SignaturePad value={sig} onChange={setSig} height={180} />
            </div>
            <Button
              type="button"
              className="w-full"
              size="lg"
              onClick={addSigner}
              disabled={pending || !personId || !sig}
            >
              <Check size={16} />{' '}
              <GeneratedValue
                value={
                  pending ? (
                    <GeneratedText id="m_106811f2aac664" />
                  ) : (
                    <GeneratedText id="m_1087d33623b6de" />
                  )
                }
              />
            </Button>
          </div>
        </div>
      ) : null}

      {/* Roster */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Users size={16} className="text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            <GeneratedText id="m_1ae15f0f94d0f9" />
            <GeneratedValue value={roster.length} />)
          </h3>
        </div>
        <GeneratedValue
          value={
            roster.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <GeneratedText id="m_0566189d1fd6d5" />
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                <GeneratedValue
                  value={roster.map((r) => (
                    <li key={r.ackId} className="flex items-center gap-3 px-3 py-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <GeneratedValue value={initials(r.name)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          <GeneratedValue value={r.name} />
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          <GeneratedValue
                            value={new Date(r.acknowledgedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          />
                        </div>
                      </div>
                      <GeneratedValue
                        value={
                          r.signatureUrl ? (
                            <RawImage
                              src={r.signatureUrl}
                              alt={tGenerated('m_017383099e620c', { value0: r.name })}
                              optimizationReason="authenticated"
                              className="h-9 w-20 shrink-0 rounded border border-slate-200 bg-white object-contain dark:border-slate-700"
                            />
                          ) : null
                        }
                      />
                      {!completedAt ? (
                        <button
                          type="button"
                          onClick={() => removeSigner(r.ackId)}
                          disabled={pending}
                          className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-950/40"
                          aria-label={tGenerated('m_101f98a70352fa', { value0: r.name })}
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </li>
                  ))}
                />
              </ul>
            )
          }
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        {completedAt ? (
          <Link href={backHref}>
            <Button type="button">
              <GeneratedText id="m_00609f822e0571" />
            </Button>
          </Link>
        ) : (
          <Button
            type="button"
            onClick={completeSession}
            disabled={pending || !sessionId || roster.length === 0}
          >
            <Check size={16} /> <GeneratedText id="m_03959afe91d76c" />
          </Button>
        )}
      </div>
    </div>
  )
}
