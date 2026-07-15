'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
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
      title={tGeneratedValue(
        editing ? tGenerated('m_1817230066dcd4') : tGenerated('m_129529d04e6d96'),
      )}
      description={tGenerated('m_0c51dcd14d49fc')}
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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [name, setName] = useState(contact?.name ?? '')
  const [role, setRole] = useState(contact?.role ?? '')
  const [email, setEmail] = useState(contact?.email ?? '')
  const [phone, setPhone] = useState(contact?.phone ?? '')
  const [notes, setNotes] = useState(contact?.notes ?? '')
  const [isPrimary, setIsPrimary] = useState(contact?.isPrimary ?? false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(tGeneratedValue(null))
    const trimmed = name.trim()
    if (!trimmed) {
      setError(tGenerated('m_1c66cb30434189'))
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
      else setError(tGeneratedValue(res.error))
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
        <Label htmlFor="contact-name">
          <GeneratedText id="m_1a9978900838e6" />
        </Label>
        <Input
          id="contact-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={tGenerated('m_15d21c6eb9e2a9')}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-role">
          <GeneratedText id="m_1099c1fe8b6614" />
        </Label>
        <Input
          id="contact-role"
          value={role}
          onChange={(e) => setRole(e.currentTarget.value)}
          placeholder={tGenerated('m_0a2c926e8e262e')}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-email">
          <GeneratedText id="m_00a0ba9938bdff" />
        </Label>
        <Input
          id="contact-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          placeholder={tGenerated('m_03778215225c60')}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-phone">
          <GeneratedText id="m_129b102b56bf3a" />
        </Label>
        <Input
          id="contact-phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.currentTarget.value)}
          placeholder={tGenerated('m_1f7b2c238d9e44')}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-notes">
          <GeneratedText id="m_0b8dadcb78cd08" />
        </Label>
        <Textarea
          id="contact-notes"
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
          rows={3}
          placeholder={tGenerated('m_1db68018f67929')}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input
          type="checkbox"
          checked={isPrimary}
          onChange={(e) => setIsPrimary(e.currentTarget.checked)}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900"
        />
        <GeneratedText id="m_09902a604eb9e7" />
      </label>

      <GeneratedValue
        value={
          error ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              <GeneratedValue value={error} />
            </p>
          ) : null
        }
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          <GeneratedText id="m_112e2e8ecda428" />
        </Button>
        <Button type="submit" disabled={pending}>
          <GeneratedValue
            value={pending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          />
          <GeneratedValue
            value={
              contact ? (
                <GeneratedText id="m_13469594921a49" />
              ) : (
                <GeneratedText id="m_04260e19acd594" />
              )
            }
          />
        </Button>
      </div>
    </form>
  )
}
