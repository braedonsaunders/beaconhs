'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckSquare,
  Download,
  HandHelping,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import {
  bulkDiscardPpe,
  bulkExportPpeCsv,
  bulkIssuePpeToPerson,
} from './_actions'

export type PpeHolderOption = {
  id: string
  name: string
  employeeNo: string | null
}

export function BulkPpeBar({
  selectedIds,
  onClear,
  holders,
}: {
  selectedIds: string[]
  onClear: () => void
  holders: PpeHolderOption[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [action, setAction] = useState<'issue' | 'discard' | 'export'>('issue')
  const [personId, setPersonId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const label = useMemo(
    () => `${selectedIds.length} PPE item${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0) return null

  function go() {
    setError(null)
    setInfo(null)
    if (action === 'issue') {
      if (!personId) {
        setError('Pick a holder.')
        return
      }
      start(async () => {
        const res = await bulkIssuePpeToPerson({
          ppeItemIds: selectedIds,
          personId,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        setInfo(`Issued ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    if (action === 'discard') {
      if (!confirm(`Discard ${selectedIds.length} PPE item(s)?`)) return
      start(async () => {
        const res = await bulkDiscardPpe({
          ppeItemIds: selectedIds,
          reason: reason.trim() || null,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        setInfo(`Discarded ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    // export
    start(async () => {
      const res = await bulkExportPpeCsv({ ppeItemIds: selectedIds })
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
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
        >
          <X size={14} />
        </button>
        <span className="text-sm font-medium text-slate-900">{label}</span>

        <Select
          value={action}
          onChange={(e) => setAction(e.target.value as typeof action)}
          className="h-8 min-w-[10rem]"
          disabled={pending}
        >
          <option value="issue">Issue to person</option>
          <option value="discard">Discard</option>
          <option value="export">Export selected to CSV</option>
        </Select>

        {action === 'issue' ? (
          <div className="flex items-center gap-2">
            <HandHelping size={14} className="text-slate-500" />
            <Select
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
              className="h-8 min-w-[14rem]"
              disabled={pending}
            >
              <option value="">Pick holder…</option>
              {holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                  {h.employeeNo ? ` · ${h.employeeNo}` : ''}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {action === 'discard' ? (
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="h-8 w-48 rounded-md border border-slate-300 bg-white px-2 text-sm"
            disabled={pending}
          />
        ) : null}

        <Button size="sm" onClick={go} disabled={pending}>
          {pending
            ? 'Working…'
            : action === 'discard'
              ? (
                <span className="inline-flex items-center gap-1">
                  <Trash2 size={14} /> Discard
                </span>
              )
              : action === 'export'
                ? (
                  <span className="inline-flex items-center gap-1">
                    <Download size={14} /> Export
                  </span>
                )
                : 'Issue'}
        </Button>
        {error ? <span className="text-xs text-red-600">{error}</span> : null}
        {info ? <span className="text-xs text-emerald-700">{info}</span> : null}
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
      className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      {selected ? (
        <CheckSquare size={16} className="text-teal-700" />
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
      className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
    >
      {allSelected ? (
        <CheckSquare size={16} className="text-teal-700" />
      ) : (
        <Square size={16} />
      )}
    </button>
  )
}
