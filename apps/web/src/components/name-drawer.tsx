'use client'

// Generic name-only create/rename flyout for flat taxonomies (trades, crews, …).
// Opened via the URL (?drawer=new | ?drawer=<id>) so it survives refresh and is
// link-shareable. The save server action is passed in from the RSC page and
// returns {ok|error} for inline validation.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, UrlDrawer } from '@beaconhs/ui'

export type SaveResult = { ok: true } | { ok: false; error: string }

export type NameEditing = { id: string; name: string }

type SaveAction = (input: { id?: string; name: string }) => Promise<SaveResult>

export function NameDrawer({
  open,
  closeHref,
  noun,
  editing,
  saveAction,
}: {
  open: boolean
  closeHref: string
  /** Lowercase singular, e.g. "trade" or "crew". */
  noun: string
  editing: NameEditing | null
  saveAction: SaveAction
}) {
  const router = useRouter()
  function close() {
    router.push(closeHref)
    router.refresh()
  }
  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={editing ? `Rename ${noun}` : `Add ${noun}`}
      description={editing ? `Rename this ${noun}.` : `Add a ${noun} people can be assigned to.`}
      size="sm"
    >
      <NameForm
        key={editing?.id ?? 'new'}
        noun={noun}
        editing={editing}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function NameForm({
  noun,
  editing,
  saveAction,
  onDone,
}: {
  noun: string
  editing: NameEditing | null
  saveAction: SaveAction
  onDone: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
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
      const res = await saveAction({ id: editing?.id, name: trimmed })
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
        <Label htmlFor="name">Name *</Label>
        <Input
          id="name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder={`New ${noun}`}
          required
        />
      </div>

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
          {editing ? 'Save changes' : `Add ${noun}`}
        </Button>
      </div>
    </form>
  )
}
