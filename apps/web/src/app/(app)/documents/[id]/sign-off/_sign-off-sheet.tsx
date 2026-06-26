'use client'

// The kiosk-style group sign-off roster. Pass the device around: each person
// picks their name, signs, and taps "Add signer" — which uploads the signature
// and persists ONE acknowledgment immediately (creating the session on the first
// add), so nothing is lost if the tablet sleeps mid-session. Local state is the
// live roster; every entry is already saved server-side.

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, ChevronDown, ChevronRight, PenLine, Trash2, UserPlus, Users } from 'lucide-react'
import {
  Button,
  Input,
  Label,
  SearchSelect,
  SignaturePad,
  Textarea,
  type SelectOption,
} from '@beaconhs/ui'
import { addSignOffSigner, removeSignOffSigner } from '../_ack-actions'
import { uploadSignatureDataUrl } from '@/lib/upload-signature'

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
  peopleOptions,
  initialRoster,
  initialSessionId,
  backHref,
}: {
  documentId: string
  versionId: string
  versionNumber: number
  defaultTitle: string
  peopleOptions: SelectOption[]
  initialRoster: SheetSigner[]
  initialSessionId: string | null
  backHref: string
}) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId)
  const [roster, setRoster] = useState<SheetSigner[]>(initialRoster)
  const [title, setTitle] = useState(defaultTitle)
  const [location, setLocation] = useState('')
  const [notes, setNotes] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)

  const [personId, setPersonId] = useState('')
  const [sig, setSig] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const signedIds = useMemo(() => new Set(roster.map((r) => r.personId)), [roster])
  const available = useMemo(
    () => peopleOptions.filter((o) => !signedIds.has(o.value)),
    [peopleOptions, signedIds],
  )

  function addSigner() {
    if (!personId) {
      toast.error('Select a person')
      return
    }
    if (!sig) {
      toast.error('Capture a signature first')
      return
    }
    startTransition(async () => {
      try {
        const signatureAttachmentId = await uploadSignatureDataUrl(sig)
        const res = await addSignOffSigner({
          documentId,
          versionId,
          session: { id: sessionId, title, location, notes },
          personId,
          signatureAttachmentId,
        })
        if (!res.ok) {
          toast.error(res.error)
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
        toast.success(`${res.signer.name} signed`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not add signer')
      }
    })
  }

  function removeSigner(ackId: string) {
    const prev = roster
    setRoster((r) => r.filter((x) => x.ackId !== ackId))
    startTransition(async () => {
      const res = await removeSignOffSigner({ documentId, ackId })
      if (!res.ok) {
        toast.error(res.error)
        setRoster(prev)
      }
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
            {detailsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            Session details
          </span>
          <span className="truncate pl-3 text-xs text-slate-500 dark:text-slate-400">
            {title || 'Untitled'} · v{versionNumber}
          </span>
        </button>
        {detailsOpen ? (
          <div className="space-y-3 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="space-y-1">
              <Label htmlFor="so-title">Title</Label>
              <Input
                id="so-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Toolbox talk"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="so-location">Location</Label>
              <Input
                id="so-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. North yard"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="so-notes">Notes</Label>
              <Textarea
                id="so-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Optional"
              />
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Saved with the first signer. Changes after that won't alter the existing session.
            </p>
          </div>
        ) : null}
      </div>

      {/* Add a signer */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <UserPlus size={16} /> Add a signer
        </h3>
        <div className="mt-3 space-y-3">
          <div className="space-y-1">
            <Label>Person</Label>
            <SearchSelect
              value={personId}
              onChange={setPersonId}
              options={available}
              placeholder="Select a person…"
              searchPlaceholder="Search people…"
              sheetTitle="Add a signer"
              ariaLabel="Signer"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
              <PenLine size={14} /> Signature
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
            <Check size={16} /> {pending ? 'Saving…' : 'Add signer'}
          </Button>
        </div>
      </div>

      {/* Roster */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Users size={16} className="text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Signed ({roster.length})
          </h3>
        </div>
        {roster.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
            No signatures yet. Add the first signer above.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {roster.map((r) => (
              <li key={r.ackId} className="flex items-center gap-3 px-3 py-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {initials(r.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {r.name}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {new Date(r.acknowledgedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                {r.signatureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.signatureUrl}
                    alt={`${r.name} signature`}
                    className="h-9 w-20 shrink-0 rounded border border-slate-200 bg-white object-contain dark:border-slate-700"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => removeSigner(r.ackId)}
                  disabled={pending}
                  className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-950/40"
                  aria-label={`Remove ${r.name}`}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <Link href={backHref}>
          <Button type="button" variant={roster.length > 0 ? 'default' : 'outline'}>
            Done
          </Button>
        </Link>
      </div>
    </div>
  )
}
