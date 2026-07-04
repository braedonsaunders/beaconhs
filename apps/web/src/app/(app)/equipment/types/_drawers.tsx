'use client'

// Create / edit flyout for an equipment type. URL-driven (?drawer=new | <id>),
// one UrlDrawer + form handling both modes — mirrors /people/departments.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, Textarea, UrlDrawer } from '@beaconhs/ui'

export type TypeEditing = {
  id: string
  name: string
  description: string | null
  categoryId: string | null
}

type SaveAction = (input: {
  id?: string
  name: string
  description: string | null
  categoryId: string | null
}) => Promise<{ ok: true } | { ok: false; error: string }>

export function EquipmentTypeDrawer({
  mode,
  editing,
  closeHref,
  categories,
  saveAction,
}: {
  mode: 'new' | 'edit' | null
  editing: TypeEditing | null
  closeHref: string
  categories: { id: string; name: string }[]
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
      title={mode === 'edit' ? 'Edit equipment type' : 'New equipment type'}
      description="The make/model catalogue every asset is classified against. Inspection cadences live on each unit's schedules; templates default their own interval."
      size="md"
    >
      <TypeForm
        key={editing?.id ?? 'new'}
        editing={editing}
        categories={categories}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function TypeForm({
  editing,
  categories,
  saveAction,
  onDone,
}: {
  editing: TypeEditing | null
  categories: { id: string; name: string }[]
  saveAction: SaveAction
  onDone: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Name is required.')
      return
    }
    start(async () => {
      const res = await saveAction({
        id: editing?.id,
        name: trimmed,
        description: description.trim() || null,
        categoryId: categoryId || null,
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
        <Label htmlFor="et-name">Name *</Label>
        <Input
          id="et-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="e.g. Pickup truck"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="et-category">Category</Label>
        <Select
          id="et-category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.currentTarget.value)}
        >
          <option value="">— None —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="et-description">Description</Label>
        <Textarea
          id="et-description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          rows={2}
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
          {editing ? 'Save changes' : 'Create type'}
        </Button>
      </div>
    </form>
  )
}
