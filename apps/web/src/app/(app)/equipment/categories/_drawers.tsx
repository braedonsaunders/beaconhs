'use client'

// Create / edit flyout for an equipment category. URL-driven (?drawer=new | <id>),
// one UrlDrawer + form handling both modes — mirrors /people/departments.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'
import { DEFAULT_ENABLED_GROUP_KEYS, EQUIPMENT_FIELD_GROUPS } from '@/lib/equipment/field-groups'

export type CategoryEditing = {
  id: string
  name: string
  description: string | null
  sortOrder: number
  enabledFieldGroups: string[] | null
}

type SaveAction = (input: {
  id?: string
  name: string
  description: string | null
  sortOrder: number
  enabledFieldGroups: string[] | null
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
  // Field-group layout: null = registry defaults; a list = explicit override.
  const [useDefaultGroups, setUseDefaultGroups] = useState(editing?.enabledFieldGroups == null)
  const [groupKeys, setGroupKeys] = useState<string[]>(
    editing?.enabledFieldGroups ?? DEFAULT_ENABLED_GROUP_KEYS,
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function toggleGroup(key: string) {
    setGroupKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]))
  }

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
        enabledFieldGroups: useDefaultGroups ? null : groupKeys,
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
      <fieldset className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
        <legend className="px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          Record page sections
        </legend>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Which detail sections items of this category show — keep a hand tool lean, give a truck
          registration and meters.
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useDefaultGroups}
            onChange={(e) => setUseDefaultGroups(e.currentTarget.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
          />
          <span>Use recommended defaults</span>
        </label>
        {!useDefaultGroups ? (
          <div className="space-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
            {EQUIPMENT_FIELD_GROUPS.map((g) => (
              <label key={g.key} className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={groupKeys.includes(g.key)}
                  onChange={() => toggleGroup(g.key)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
                />
                <span>
                  {g.label}
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {g.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>
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
