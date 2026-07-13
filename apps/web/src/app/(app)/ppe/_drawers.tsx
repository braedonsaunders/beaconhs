'use client'

// Sub-entity drawer for the PPE register:
//   • issue → register a new PPE item and (optionally) issue it to a person
//
// Opens via `?drawer=issue` so it survives refresh + is link-shareable. The
// register-and-issue server action is passed in from the RSC list page. Person
// blank ⇒ the item just lands in stock; otherwise it's issued in the same step.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, UserPlus } from 'lucide-react'
import {
  Button,
  Input,
  Label,
  SearchSelect,
  Select,
  Textarea,
  UrlDrawer,
  type SelectOption,
} from '@beaconhs/ui'

type PpeDrawerType = {
  id: string
  name: string
  category: string | null
  sizingScheme: string[] | null
}

type IssueAction = (input: {
  typeId: string
  serialNumber?: string | null
  size?: string | null
  purchaseDate?: string | null
  expiresOn?: string | null
  notes?: string | null
  personId?: string | null
  note?: string | null
}) => Promise<{ ok: true; id: string; issued: boolean } | { ok: false; error: string }>

export function PpeDrawers({
  openDrawer,
  closeHref,
  types,
  people,
  issueAction,
}: {
  openDrawer: 'issue' | null
  closeHref: string
  types: PpeDrawerType[]
  people: SelectOption[]
  issueAction: IssueAction
}) {
  return (
    <IssueDrawer
      open={openDrawer === 'issue'}
      closeHref={closeHref}
      types={types}
      people={people}
      action={issueAction}
    />
  )
}

function IssueDrawer({
  open,
  closeHref,
  types,
  people,
  action,
}: {
  open: boolean
  closeHref: string
  types: PpeDrawerType[]
  people: SelectOption[]
  action: IssueAction
}) {
  const router = useRouter()
  const [typeId, setTypeId] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [size, setSize] = useState('')
  const [purchaseDate, setPurchaseDate] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [notes, setNotes] = useState('')
  const [personId, setPersonId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    if (!typeId) {
      setError('Pick a PPE type.')
      return
    }
    startTransition(async () => {
      const res = await action({
        typeId,
        serialNumber: serialNumber.trim() || null,
        size: size.trim() || null,
        purchaseDate: purchaseDate || null,
        expiresOn: expiresOn || null,
        notes: notes.trim() || null,
        personId: personId || null,
        note: note.trim() || null,
      })
      if (res.ok) {
        router.push(`/ppe/${res.id}`)
        router.refresh()
      } else {
        setError(res.error)
      }
    })
  }

  const typeOptions: SelectOption[] = types.map((t) => ({
    value: t.id,
    label: t.name,
    hint: t.category ? t.category.replace(/_/g, ' ') : undefined,
  }))

  // Types with a configured sizing scheme get a dropdown of their valid sizes;
  // everything else stays free text.
  const sizingScheme = types.find((t) => t.id === typeId)?.sizingScheme ?? null
  const sizeOptions = sizingScheme && sizingScheme.length > 0 ? sizingScheme : null

  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="Issue PPE"
      description="Register a new PPE item. Pick a person to hand it over in the same step, or leave blank to add it to stock."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(closeHref)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !typeId}>
            {pending ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <UserPlus size={14} className="mr-1.5" />
            )}
            {personId ? 'Create & issue' : 'Add to stock'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>PPE type *</Label>
          <SearchSelect
            value={typeId}
            onChange={(next) => {
              setTypeId(next)
              // A different type may have a different sizing scheme.
              setSize('')
            }}
            options={typeOptions}
            placeholder="Select a PPE type…"
            searchPlaceholder="Search PPE types…"
            sheetTitle="Select a PPE type"
            clearable={false}
          />
          {types.length === 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              No PPE types yet — add one under PPE → Types first.
            </p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pi-serial">Serial number</Label>
            <Input
              id="pi-serial"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.currentTarget.value)}
              placeholder="manufacturer or in-house tag"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pi-size">Size</Label>
            {sizeOptions ? (
              <Select id="pi-size" value={size} onChange={(e) => setSize(e.currentTarget.value)}>
                <option value="">— No size —</option>
                {sizeOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id="pi-size"
                value={size}
                onChange={(e) => setSize(e.currentTarget.value)}
                placeholder="S / M / L / 10 / etc."
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pi-purchase">Purchase date</Label>
            <Input
              id="pi-purchase"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.currentTarget.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pi-expires">Expires on</Label>
            <Input
              id="pi-expires"
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.currentTarget.value)}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pi-notes">Notes</Label>
          <Textarea
            id="pi-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            placeholder="Anything reviewers should know."
          />
        </div>

        <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          <div className="space-y-1.5">
            <Label>Issue to a person (optional)</Label>
            <SearchSelect
              value={personId}
              onChange={setPersonId}
              options={people}
              placeholder="Leave blank to add to stock…"
              searchPlaceholder="Search people…"
              sheetTitle="Issue to a person"
              clearable
              emptyLabel="— Add to stock —"
            />
          </div>
          {personId ? (
            <div className="space-y-1.5">
              <Label htmlFor="pi-note">Issuance note</Label>
              <Input
                id="pi-note"
                value={note}
                onChange={(e) => setNote(e.currentTarget.value)}
                placeholder='e.g. "Replaces lost helmet, site induction"'
              />
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </p>
        ) : null}
      </div>
    </UrlDrawer>
  )
}
