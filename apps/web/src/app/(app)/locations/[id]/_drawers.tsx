'use client'

// Create / edit flyout for the location detail page's Contacts tab. Opened via
// ?drawer=new-contact (create) or ?drawer=edit-contact&contactId=… (edit). A
// contact has no detail page of its own — it's a sub-record created and edited
// in place — so this single drawer covers both. Projects instant-create
// instead: they're org units with their own /locations/[id] page. The save
// actions are passed in from the RSC page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'

export type ContactRow = {
  id: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  notes: string | null
  isPrimary: boolean
}

type CreateAction = (input: {
  orgUnitId: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  notes: string | null
  isPrimary: boolean
}) => Promise<{ ok: true } | { ok: false; error: string }>

type UpdateAction = (input: {
  contactId: string
  orgUnitId: string
  name: string
  role: string | null
  email: string | null
  phone: string | null
  notes: string | null
  isPrimary: boolean
}) => Promise<{ ok: true } | { ok: false; error: string }>

export function ContactDrawer({
  open,
  orgUnitId,
  contact,
  closeHref,
  createAction,
  updateAction,
}: {
  open: boolean
  orgUnitId: string
  /** Present when editing; absent when creating. */
  contact: ContactRow | null
  closeHref: string
  createAction: CreateAction
  updateAction: UpdateAction
}) {
  const router = useRouter()
  function close() {
    router.push(closeHref)
    router.refresh()
  }
  const editing = !!contact
  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={editing ? 'Edit contact' : 'New contact'}
      description="Add a contact — site managers, client reps, emergency-only contacts."
      size="md"
    >
      <ContactForm
        key={editing ? `edit-contact:${contact.id}` : `new-contact:${orgUnitId}`}
        orgUnitId={orgUnitId}
        contact={contact}
        createAction={createAction}
        updateAction={updateAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function ContactForm({
  orgUnitId,
  contact,
  createAction,
  updateAction,
  onDone,
}: {
  orgUnitId: string
  contact: ContactRow | null
  createAction: CreateAction
  updateAction: UpdateAction
  onDone: () => void
}) {
  const [name, setName] = useState(contact?.name ?? '')
  const [role, setRole] = useState(contact?.role ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [phone, setPhone] = useState(contact?.phone ?? '')
  const [notes, setNotes] = useState(contact?.notes ?? '')
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required.')
      return
    }
    startTransition(async () => {
      const payload = {
        name: trimmed,
        role: role.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        notes: notes.trim() || null,
        isPrimary,
      }
      const res = contact
        ? await updateAction({ contactId: contact.id, orgUnitId, ...payload })
        : await createAction({ orgUnitId, ...payload })
      if (res.ok) onDone()
      else setError(res.error)
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="contact-name">Name *</Label>
        <Input
          id="contact-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="e.g. Jordan Lee"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-role">Role</Label>
        <Input
          id="contact-role"
          value={role}
          onChange={(e) => setRole(e.currentTarget.value)}
          placeholder="e.g. Site Manager"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-email">Email</Label>
        <Input
          id="contact-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          placeholder="e.g. jordan@acme.com"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-phone">Phone</Label>
        <Input
          id="contact-phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.currentTarget.value)}
          placeholder="e.g. (555) 010-2233"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-notes">Notes</Label>
        <Textarea
          id="contact-notes"
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          rows={3}
          placeholder="Optional notes"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.currentTarget.checked)}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900"
        />
        Mark as primary contact
      </label>

      {error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          {contact ? 'Save contact' : 'Create contact'}
        </Button>
      </div>
    </form>
  )
}
