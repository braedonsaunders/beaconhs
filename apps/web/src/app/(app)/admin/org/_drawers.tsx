'use client'

// Create an org unit / trade / crew in a right-side flyout. Opened via the URL
// (?drawer=new) so it survives refresh and is link-shareable. The save server
// actions are passed in from the RSC page and return {ok|error} for the form.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button, Input, Label, Select, UrlDrawer } from '@beaconhs/ui'

export type SaveResult = { ok: true } | { ok: false; error: string }

type LevelOption = { value: string; label: string }
type ParentOption = { value: string; label: string }

function useClose(closeHref: string) {
  const router = useRouter()
  return () => {
    router.push(closeHref)
    router.refresh()
  }
}

export function OrgUnitDrawer({
  open,
  closeHref,
  levels,
  parentOptions,
  saveAction,
}: {
  open: boolean
  closeHref: string
  levels: LevelOption[]
  parentOptions: ParentOption[]
  saveAction: (input: {
    name: string
    level: string
    parentId: string | null
  }) => Promise<SaveResult>
}) {
  const close = useClose(closeHref)
  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title="Add org unit"
      description="Add a customer, project, site or area to your hierarchy."
      size="md"
    >
      <OrgUnitForm
        key={open ? 'open' : 'closed'}
        levels={levels}
        parentOptions={parentOptions}
        saveAction={saveAction}
        onDone={close}
      />
    </UrlDrawer>
  )
}

function OrgUnitForm({
  levels,
  parentOptions,
  saveAction,
  onDone,
}: {
  levels: LevelOption[]
  parentOptions: ParentOption[]
  saveAction: (input: {
    name: string
    level: string
    parentId: string | null
  }) => Promise<SaveResult>
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [level, setLevel] = useState(levels.find((l) => l.value === 'site')?.value ?? levels[0]?.value ?? '')
  const [parentId, setParentId] = useState('')
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
      const res = await saveAction({ name: trimmed, level, parentId: parentId || null })
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
        <Label htmlFor="org-level">Level</Label>
        <Select
          id="org-level"
          value={level}
          onChange={(e) => setLevel(e.currentTarget.value)}
        >
          {levels.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-parent">Parent</Label>
        <Select
          id="org-parent"
          value={parentId}
          onChange={(e) => setParentId(e.currentTarget.value)}
        >
          <option value="">— top-level —</option>
          {parentOptions.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-name">Name *</Label>
        <Input
          id="org-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="e.g. Site C"
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
          Add org unit
        </Button>
      </div>
    </form>
  )
}

export function NameDrawer({
  open,
  closeHref,
  noun,
  saveAction,
}: {
  open: boolean
  closeHref: string
  /** Lowercase singular, e.g. "trade" or "crew". */
  noun: string
  saveAction: (input: { name: string }) => Promise<SaveResult>
}) {
  const close = useClose(closeHref)
  const title = `Add ${noun}`
  return (
    <UrlDrawer
      open={open}
      closeHref={closeHref}
      title={title}
      description={`Add a ${noun} people can be assigned to.`}
      size="sm"
    >
      <NameForm key={open ? 'open' : 'closed'} noun={noun} saveAction={saveAction} onDone={close} />
    </UrlDrawer>
  )
}

function NameForm({
  noun,
  saveAction,
  onDone,
}: {
  noun: string
  saveAction: (input: { name: string }) => Promise<SaveResult>
  onDone: () => void
}) {
  const [name, setName] = useState('')
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
      const res = await saveAction({ name: trimmed })
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
          Add {noun}
        </Button>
      </div>
    </form>
  )
}
