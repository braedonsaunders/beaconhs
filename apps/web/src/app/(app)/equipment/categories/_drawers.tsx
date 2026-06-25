'use client'

// Create / edit flyout for an equipment category. URL-driven (?drawer=new | <id>),
// one UrlDrawer + form handling both modes — mirrors /people/departments.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'

export type CategoryEditing = {
  id: string
  name: string
  description: string | null
  sortOrder: number
}

type SaveAction = (input: {
  id?: string
  name: string
  description: string | null
  sortOrder: number
}) => Promise<{ ok: true } | { ok: false; error: string }>

export function EquipmentCategoryDrawer({
  mode,
  editing,
  closeHref,
  saveAction,
}: {
  mode: 'new' | 'edit' | null
  editing: CategoryEditing | null
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
      title={mode === 'edit' ? 'Edit category' : 'New category'}
      description="Buckets that group equipment types — used in the rate matrix and reports."
      size="md"
    >
      <CategoryForm
        key={editing?.id ?? 'new'}
        editing={editing}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function CategoryForm({
  editing,
  saveAction,
  onDone,
}: {
  editing: CategoryEditing | null
  saveAction: SaveAction
  onDone: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [sortOrder, setSortOrder] = useState(String(editing?.sortOrder ?? 0))
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
        sortOrder: Number(sortOrder) || 0,
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
        <Label htmlFor="ec-name">Name *</Label>
        <Input
          id="ec-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="e.g. Vehicles"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ec-sort">Sort order</Label>
        <Input
          id="ec-sort"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.currentTarget.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ec-description">Description</Label>
        <Textarea
          id="ec-description"
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
          {editing ? 'Save changes' : 'Create category'}
        </Button>
      </div>
    </form>
  )
}
