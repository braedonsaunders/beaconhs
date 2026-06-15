'use client'

// Create / edit an injury type in a right-side flyout. Opened via the URL
// (?drawer=new | ?drawer=<id>) so it survives refresh and is link-shareable.
// The save server action is passed in from the RSC list page.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'

export type InjuryTypeEditing = {
  id: string
  name: string
  oshaCode: string | null
  description: string | null
}

type SaveAction = (input: {
  id?: string
  name: string
  oshaCode: string | null
  description: string | null
}) => Promise<{ ok: true } | { ok: false; error: string }>

export function InjuryTypeDrawer({
  mode,
  editing,
  closeHref,
  saveAction,
}: {
  mode: 'new' | 'edit' | null
  editing: InjuryTypeEditing | null
  closeHref: string
  saveAction: SaveAction
}) {
  const router = useRouter()
  function close() {
    router.push(closeHref)
    router.refresh()
  }
  return (
    <UrlDrawer
      open={mode !== null}
      closeHref={closeHref}
      title={mode === 'edit' ? 'Edit injury type' : 'New injury type'}
      description={
        mode === 'edit'
          ? 'Rename, recode, or describe this injury label.'
          : 'Add a label used by every injury row on every incident.'
      }
      size="md"
    >
      <InjuryTypeForm
        key={editing?.id ?? 'new'}
        editing={editing}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function InjuryTypeForm({
  editing,
  saveAction,
  onDone,
}: {
  editing: InjuryTypeEditing | null
  saveAction: SaveAction
  onDone: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [oshaCode, setOshaCode] = useState(editing?.oshaCode ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
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
      const res = await saveAction({
        id: editing?.id,
        name: trimmed,
        oshaCode: oshaCode.trim() || null,
        description: description.trim() || null,
      })
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
        <Label htmlFor="it-name">Name *</Label>
        <Input
          id="it-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="e.g. Laceration"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="it-osha">OSHA code</Label>
        <Input
          id="it-osha"
          value={oshaCode}
          onChange={(e) => setOshaCode(e.currentTarget.value)}
          placeholder="Optional, e.g. CUT"
          maxLength={8}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="it-description">Description</Label>
        <Textarea
          id="it-description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          rows={3}
          placeholder="Optional notes"
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
          {editing ? 'Save changes' : 'Create injury type'}
        </Button>
      </div>
    </form>
  )
}
