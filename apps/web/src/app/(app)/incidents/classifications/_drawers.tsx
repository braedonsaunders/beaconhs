'use client'

// Create / edit an incident classification in a right-side flyout. Opened via
// the URL (?drawer=new[&parent=<id>] | ?drawer=<id>) so it survives refresh and
// is link-shareable. The save server action is passed in from the RSC page.
//
// Parent is chosen only when creating — re-parenting an existing node is not
// supported (it would orphan TRIR rollups), so the field is hidden on edit.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Textarea, UrlDrawer } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'

export type ClassificationEditing = {
  id: string
  name: string
  code: string | null
  description: string | null
  isRecordable: boolean
}

type SaveAction = (input: {
  id?: string
  parentId: string | null
  name: string
  code: string | null
  description: string | null
  isRecordable: boolean
}) => Promise<{ ok: true } | { ok: false; error: string }>

export function ClassificationDrawer({
  mode,
  editing,
  defaultParentId,
  closeHref,
  saveAction,
}: {
  mode: 'new' | 'edit' | null
  editing: ClassificationEditing | null
  defaultParentId: string
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
      title={mode === 'edit' ? 'Edit classification' : 'New classification'}
      description={
        mode === 'edit'
          ? 'Rename, recode, or change whether this category feeds recordable rollups.'
          : 'Add a category. Recordable nodes feed TRIR and DART.'
      }
      size="md"
    >
      <ClassificationForm
        key={editing?.id ?? `new:${defaultParentId}`}
        editing={editing}
        defaultParentId={defaultParentId}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function ClassificationForm({
  editing,
  defaultParentId,
  saveAction,
  onDone,
}: {
  editing: ClassificationEditing | null
  defaultParentId: string
  saveAction: SaveAction
  onDone: () => void
}) {
  const [parentId, setParentId] = useState(defaultParentId)
  const [name, setName] = useState(editing?.name ?? '')
  const [code, setCode] = useState(editing?.code ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [isRecordable, setIsRecordable] = useState(editing?.isRecordable ?? true)
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
        parentId: editing ? null : parentId || null,
        name: trimmed,
        code: code.trim() || null,
        description: description.trim() || null,
        isRecordable,
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
      {editing ? null : (
        <div className="space-y-1.5">
          <Label htmlFor="cl-parent">Parent</Label>
          <RemoteSearchSelect
            id="cl-parent"
            lookup="incident-classification-parents"
            value={parentId}
            onChange={setParentId}
            placeholder="Top level"
            searchPlaceholder="Search top-level classifications…"
            sheetTitle="Select parent classification"
            ariaLabel="Parent classification"
            clearable
            emptyLabel="— top level —"
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="cl-name">Name *</Label>
        <Input
          id="cl-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="e.g. Slip / trip / fall"
          required
          maxLength={200}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cl-code">Code</Label>
        <Input
          id="cl-code"
          value={code}
          onChange={(e) => setCode(e.currentTarget.value)}
          placeholder="STF"
          maxLength={6}
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={isRecordable}
          onChange={(e) => setIsRecordable(e.currentTarget.checked)}
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        Recordable — feeds TRIR / DART / OSHA-log rollups
      </label>

      <div className="space-y-1.5">
        <Label htmlFor="cl-description">Description</Label>
        <Textarea
          id="cl-description"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          rows={3}
          placeholder="Optional notes"
          maxLength={10000}
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
          {editing ? 'Save changes' : 'Create classification'}
        </Button>
      </div>
    </form>
  )
}
