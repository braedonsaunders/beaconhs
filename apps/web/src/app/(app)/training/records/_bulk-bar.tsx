'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckSquare, Download, RotateCcw, ShieldOff, Square, X } from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import {
  bulkExportTrainingRecordsCsv,
  bulkRenewTrainingRecords,
  bulkRevokeTrainingRecords,
} from './_actions'

export function BulkTrainingRecordsBar({
  selectedIds,
  onClear,
}: {
  selectedIds: string[]
  onClear: () => void
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [action, setAction] = useState<'renew' | 'revoke' | 'export'>('renew')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const label = useMemo(
    () => `${selectedIds.length} record${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0) return null

  function go() {
    setError(null)
    setInfo(null)
    if (action === 'renew') {
      if (
        !confirm(`Renew ${selectedIds.length} record(s)? Each creates a new record dated today.`)
      ) {
        return
      }
      start(async () => {
        const res = await bulkRenewTrainingRecords({ recordIds: selectedIds })
        if (!res.ok) {
          setError(res.error)
          return
        }
        setInfo(`Renewed ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    if (action === 'revoke') {
      if (
        !confirm(
          `Revoke ${selectedIds.length} record(s)? They will no longer count toward the training matrix.`,
        )
      ) {
        return
      }
      start(async () => {
        const res = await bulkRevokeTrainingRecords({
          recordIds: selectedIds,
          reason: reason.trim() || null,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        setInfo(`Revoked ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    // export
    start(async () => {
      const res = await bulkExportTrainingRecordsCsv({ recordIds: selectedIds })
      if (!res.ok) {
        setError(res.error)
        return
      }
      const blob = new Blob([res.content], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setInfo(`Exported ${selectedIds.length} row(s).`)
    })
  }

  return (
    <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <X size={14} />
        </button>
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{label}</span>

        <Select
          value={action}
          onChange={(e) => setAction(e.target.value as typeof action)}
          className="h-8 min-w-[10rem]"
          disabled={pending}
        >
          <option value="renew">Renew (create new record)</option>
          <option value="revoke">Revoke</option>
          <option value="export">Export selected to CSV</option>
        </Select>

        {action === 'revoke' ? (
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="h-8 w-48 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            disabled={pending}
          />
        ) : null}

        <Button size="sm" onClick={go} disabled={pending}>
          {pending ? (
            'Working…'
          ) : action === 'renew' ? (
            <span className="inline-flex items-center gap-1">
              <RotateCcw size={14} /> Renew
            </span>
          ) : action === 'revoke' ? (
            <span className="inline-flex items-center gap-1">
              <ShieldOff size={14} /> Revoke
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Download size={14} /> Export
            </span>
          )}
        </Button>
        {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
        {info ? (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">{info}</span>
        ) : null}
      </div>
    </div>
  )
}

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
      className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
    >
      {selected ? (
        <CheckSquare size={16} className="text-teal-700 dark:text-teal-400" />
      ) : (
        <Square size={16} />
      )}
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
      className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
    >
      {allSelected ? (
        <CheckSquare size={16} className="text-teal-700 dark:text-teal-400" />
      ) : (
        <Square size={16} />
      )}
    </button>
  )
}
