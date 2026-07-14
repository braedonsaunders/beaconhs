'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserCog, X } from 'lucide-react'
import { Button } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { bulkReassignCorrectiveActions } from './_actions'

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
}: {
  selectedIds: string[]
  onClear: () => void
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
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <X size={14} />
        </button>
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</span>
        <div className="flex items-center gap-2">
          <UserCog size={14} className="text-slate-500" />
          <RemoteSearchSelect
            lookup="corrective-action-owners"
            value={ownerId}
            onChange={(val) => setOwnerId(val)}
            placeholder="Pick new owner…"
            searchPlaceholder="Search people…"
            sheetTitle="Select a person"
            className="h-8 min-w-[12rem]"
            disabled={pending}
          />
        </div>
        <Button size="sm" onClick={go} disabled={pending}>
          {pending ? 'Reassigning…' : 'Reassign'}
        </Button>
        {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
      </div>
    </div>
  )
}

/**
 * Row-level checkbox cell. Rendered next to each CA row so the user can
 * pick the rows that the BulkReassignBar then operates on.
 */
