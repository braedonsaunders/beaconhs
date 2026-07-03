'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { CheckSquare, Download, Layers, Square, ToggleRight, Users, X } from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import {
  bulkAssignPeopleToDepartment,
  bulkAssignPeopleToGroup,
  bulkExportPeopleCsv,
  bulkSetPeopleStatus,
  type PeopleStatus,
} from './_actions/bulk'

export type GroupOption = { id: string; name: string }
export type DepartmentOption = { id: string; name: string }

const STATUS_LABELS: Record<PeopleStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  terminated: 'Terminated',
}

/**
 * Floating bulk-action bar on /people. Four actions: assign-to-group,
 * assign-to-department, set-status, export-selected.
 */
export function BulkPeopleBar({
  selectedIds,
  onClear,
  groups,
  departments,
  canManage,
  canExport,
}: {
  selectedIds: string[]
  onClear: () => void
  groups: GroupOption[]
  departments: DepartmentOption[]
  /** Viewer may run the bulk mutations (group / department / status). */
  canManage: boolean
  /** Viewer may export the selected rows to CSV. */
  canExport: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [action, setAction] = useState<'group' | 'department' | 'status' | 'export'>(
    canManage ? 'group' : 'export',
  )
  const [groupId, setGroupId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [status, setStatus] = useState<PeopleStatus>('active')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  // position:fixed inside the animated page shell pins to the transformed
  // ancestor, not the viewport — portal to document.body like every other
  // viewport-pinned overlay. document.body only exists after mount.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const label = useMemo(
    () => `${selectedIds.length} person${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (!mounted || selectedIds.length === 0) return null
  if (!canManage && !canExport) return null

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
    if (action === 'department') {
      if (!departmentId) {
        setError('Pick a department.')
        return
      }
      start(async () => {
        const res = await bulkAssignPeopleToDepartment({
          personIds: selectedIds,
          departmentId,
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

  return createPortal(
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
          className="h-8 min-w-[11rem]"
          disabled={pending}
        >
          {canManage ? <option value="group">Assign to group</option> : null}
          {canManage ? <option value="department">Assign to department</option> : null}
          {canManage ? <option value="status">Set status</option> : null}
          {canExport ? <option value="export">Export selected to CSV</option> : null}
        </Select>

        {action === 'group' ? (
          <div className="flex items-center gap-2">
            <Users size={14} className="text-slate-500 dark:text-slate-400" />
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

        {action === 'department' ? (
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-slate-500 dark:text-slate-400" />
            <Select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="h-8 min-w-[12rem]"
              disabled={pending}
            >
              <option value="">Pick department…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        {action === 'status' ? (
          <div className="flex items-center gap-2">
            <ToggleRight size={14} className="text-slate-500 dark:text-slate-400" />
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
          {pending ? (
            'Working…'
          ) : action === 'export' ? (
            <span className="inline-flex items-center gap-1">
              <Download size={14} /> Export
            </span>
          ) : (
            'Apply'
          )}
        </Button>
        {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
        {info ? (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">{info}</span>
        ) : null}
      </div>
    </div>,
    document.body,
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
      className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
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
      className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {allSelected ? (
        <CheckSquare size={16} className="text-teal-700 dark:text-teal-400" />
      ) : (
        <Square size={16} />
      )}
    </button>
  )
}
