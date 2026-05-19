'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  CheckSquare,
  Download,
  Layers,
  Square,
  ToggleRight,
  Users,
  X,
} from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import {
  bulkAssignPeopleToDivision,
  bulkAssignPeopleToGroup,
  bulkExportPeopleCsv,
  bulkSetPeopleStatus,
  type PeopleStatus,
} from './_actions/bulk'

export type GroupOption = { id: string; name: string }
export type DivisionOption = { id: string; name: string }

const STATUS_LABELS: Record<PeopleStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  terminated: 'Terminated',
}

/**
 * Floating bulk-action bar on /people. Four actions: assign-to-group,
 * assign-to-division, set-status, export-selected.
 */
export function BulkPeopleBar({
  selectedIds,
  onClear,
  groups,
  divisions,
}: {
  selectedIds: string[]
  onClear: () => void
  groups: GroupOption[]
  divisions: DivisionOption[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [action, setAction] = useState<'group' | 'division' | 'status' | 'export'>(
    'group',
  )
  const [groupId, setGroupId] = useState('')
  const [divisionId, setDivisionId] = useState('')
  const [status, setStatus] = useState<PeopleStatus>('active')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const label = useMemo(
    () => `${selectedIds.length} person${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0) return null

  function go() {
    setError(null)
    setInfo(null)
    if (action === 'group') {
      if (!groupId) {
        setError('Pick a group.')
        return
      }
      start(async () => {
        const res = await bulkAssignPeopleToGroup({ personIds: selectedIds, groupId })
        if (!res.ok) {
          setError(res.error)
          return
        }
        setInfo(`Assigned ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    if (action === 'division') {
      if (!divisionId) {
        setError('Pick a division.')
        return
      }
      start(async () => {
        const res = await bulkAssignPeopleToDivision({
          personIds: selectedIds,
          divisionId,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        setInfo(`Assigned ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    if (action === 'status') {
      start(async () => {
        const res = await bulkSetPeopleStatus({ personIds: selectedIds, status })
        if (!res.ok) {
          setError(res.error)
          return
        }
        setInfo(`Updated ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    // export
    start(async () => {
      const res = await bulkExportPeopleCsv({ personIds: selectedIds })
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
          className="h-8 min-w-[11rem]"
          disabled={pending}
        >
          <option value="group">Assign to group</option>
          <option value="division">Assign to division</option>
          <option value="status">Set status</option>
          <option value="export">Export selected to CSV</option>
        </Select>

        {action === 'group' ? (
          <div className="flex items-center gap-2">
            <Users size={14} className="text-slate-500" />
            <Select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="h-8 min-w-[12rem]"
              disabled={pending}
            >
              <option value="">Pick group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {action === 'division' ? (
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-slate-500" />
            <Select
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              className="h-8 min-w-[12rem]"
              disabled={pending}
            >
              <option value="">Pick division…</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {action === 'status' ? (
          <div className="flex items-center gap-2">
            <ToggleRight size={14} className="text-slate-500" />
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as PeopleStatus)}
              className="h-8 min-w-[10rem]"
              disabled={pending}
            >
              {(['active', 'inactive', 'terminated'] as PeopleStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <Button size="sm" onClick={go} disabled={pending}>
          {pending ? 'Working…' : action === 'export'
            ? (
              <span className="inline-flex items-center gap-1">
                <Download size={14} /> Export
              </span>
            )
            : 'Apply'}
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
