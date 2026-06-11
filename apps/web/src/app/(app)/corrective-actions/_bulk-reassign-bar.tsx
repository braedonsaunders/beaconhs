'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckSquare, Square, UserCog, X } from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import { bulkReassignCorrectiveActions } from './_actions'

export type OwnerOption = { id: string; name: string; email: string | null }

/**
 * Floating action bar on the CA list page. Once the user ticks at least one
 * row checkbox, the bar slides up from the bottom with a count and the
 * single bulk action available right now: "Reassign owner".
 *
 * Selection state lives in this client component (URL/cookie persistence
 * would just complicate things — the bar resets on navigation).
 */
export function BulkReassignBar({
  selectedIds,
  onClear,
  owners,
}: {
  selectedIds: string[]
  onClear: () => void
  owners: OwnerOption[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [ownerId, setOwnerId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const label = useMemo(
    () => `${selectedIds.length} action${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0) return null

  function go() {
    if (!ownerId) {
      setError('Pick a new owner first.')
      return
    }
    setError(null)
    start(async () => {
      const res = await bulkReassignCorrectiveActions({
        caIds: selectedIds,
        newOwnerTenantUserId: ownerId,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      onClear()
      router.refresh()
    })
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
        >
          <X size={14} />
        </button>
        <span className="text-sm font-medium text-slate-900">{label}</span>
        <div className="flex items-center gap-2">
          <UserCog size={14} className="text-slate-500" />
          <Select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="h-8 min-w-[12rem]"
            disabled={pending}
          >
            <option value="">Pick new owner…</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.email ? ` · ${o.email}` : ''}
              </option>
            ))}
          </Select>
        </div>
        <Button size="sm" onClick={go} disabled={pending}>
          {pending ? 'Reassigning…' : 'Reassign'}
        </Button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
      </div>
    </div>
  )
}

/**
 * Row-level checkbox cell. Rendered next to each CA row so the user can
 * pick the rows that the BulkReassignBar then operates on.
 */
export function SelectionCheckbox({
  id,
  selected,
  onToggle,
}: {
  id: string
  selected: boolean
  onToggle: (id: string) => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle(id)
      }}
      aria-pressed={selected}
      className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      {selected ? <CheckSquare size={16} className="text-teal-700" /> : <Square size={16} />}
    </button>
  )
}

export function HeaderSelectAll({
  allSelected,
  onToggleAll,
}: {
  allSelected: boolean
  onToggleAll: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggleAll}
      aria-pressed={allSelected}
      className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      {allSelected ? <CheckSquare size={16} className="text-teal-700" /> : <Square size={16} />}
    </button>
  )
}
