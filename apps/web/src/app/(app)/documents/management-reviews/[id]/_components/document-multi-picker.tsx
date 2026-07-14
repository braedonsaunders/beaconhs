'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { Badge, Button } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { updateDocumentsReviewed, updateActionItems } from '../actions'

type Option = { id: string; label: string; sub?: string }

/**
 * Multi-picker for documents reviewed in a management review. Persists via a
 * single server action when the user clicks Save — the client maintains a
 * local working set so the user can add/remove repeatedly before committing.
 */
export function DocumentMultiPicker({
  reviewId,
  initial,
  available,
}: {
  reviewId: string
  initial: string[]
  available: Option[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [selected, setSelected] = useState<string[]>(initial)
  const [pendingValue, setPendingValue] = useState('')
  const [resolved, setResolved] = useState<Option[]>(available)

  function add() {
    if (!pendingValue || selected.includes(pendingValue)) return
    setSelected((s) => [...s, pendingValue])
    setPendingValue('')
  }
  function remove(id: string) {
    setSelected((s) => s.filter((x) => x !== id))
  }
  function save() {
    start(async () => {
      await updateDocumentsReviewed(reviewId, selected)
      router.refresh()
    })
  }

  const byId = new Map(resolved.map((o) => [o.id, o]))

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
            Add document
          </label>
          <RemoteSearchSelect
            lookup="management-review-documents"
            value={pendingValue}
            onChange={setPendingValue}
            onOptionChange={(option) => {
              if (!option) return
              setResolved((current) => [
                ...current.filter((item) => item.id !== option.value),
                { id: option.value, label: option.label, sub: option.hint },
              ])
            }}
            excludedValues={selected}
            placeholder="Select a document…"
            searchPlaceholder="Search documents…"
            sheetTitle="Add document"
            clearable
            emptyLabel="— pick —"
          />
        </div>
        <Button type="button" variant="outline" onClick={add}>
          <Plus size={14} /> Add
        </Button>
      </div>

      {selected.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No documents added.</p>
      ) : (
        <ul className="space-y-2">
          {selected.map((id) => {
            const o = byId.get(id)
            return (
              <li
                key={id}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="truncate text-slate-900 dark:text-slate-100">
                  {o?.label ?? id}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(id)}>
                  <Trash2 size={14} className="text-red-500" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex justify-end">
        <Button type="button" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save documents'}
        </Button>
      </div>
    </div>
  )
}

/**
 * Same shape, but for corrective-action follow-up items.
 */
export function ActionItemsPicker({
  reviewId,
  initial,
  available,
}: {
  reviewId: string
  initial: string[]
  available: Option[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [selected, setSelected] = useState<string[]>(initial)
  const [pendingValue, setPendingValue] = useState('')
  const [resolved, setResolved] = useState<Option[]>(available)

  function add() {
    if (!pendingValue || selected.includes(pendingValue)) return
    setSelected((s) => [...s, pendingValue])
    setPendingValue('')
  }
  function remove(id: string) {
    setSelected((s) => s.filter((x) => x !== id))
  }
  function save() {
    start(async () => {
      await updateActionItems(reviewId, selected)
      router.refresh()
    })
  }

  const byId = new Map(resolved.map((o) => [o.id, o]))

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
            Link a corrective action
          </label>
          <RemoteSearchSelect
            lookup="management-review-actions"
            value={pendingValue}
            onChange={setPendingValue}
            onOptionChange={(option) => {
              if (!option) return
              setResolved((current) => [
                ...current.filter((item) => item.id !== option.value),
                { id: option.value, label: option.label, sub: option.hint },
              ])
            }}
            excludedValues={selected}
            placeholder="Select a corrective action…"
            searchPlaceholder="Search corrective actions…"
            sheetTitle="Link corrective action"
            clearable
            emptyLabel="— pick —"
          />
        </div>
        <Button type="button" variant="outline" onClick={add}>
          <Plus size={14} /> Add
        </Button>
      </div>

      {selected.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No follow-up actions linked.</p>
      ) : (
        <ul className="space-y-2">
          {selected.map((id) => {
            const o = byId.get(id)
            return (
              <li
                key={id}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="flex items-center gap-2">
                  <Badge variant="outline">CA</Badge>
                  <span className="truncate text-slate-900 dark:text-slate-100">
                    {o?.label ?? id}
                  </span>
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(id)}>
                  <Trash2 size={14} className="text-red-500" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex justify-end">
        <Button type="button" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save action items'}
        </Button>
      </div>
    </div>
  )
}
