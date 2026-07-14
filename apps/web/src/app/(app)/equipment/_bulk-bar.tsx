'use client'

import { useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Download, MapPin, ToggleRight, UserCog, X } from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import {
  bulkAssignEquipmentToHolder,
  bulkExportEquipmentCsv,
  bulkSetEquipmentStatus,
  bulkTransferEquipmentToSite,
  type EquipmentStatus,
} from './_actions'
import { useHydrated } from '@/lib/use-hydrated'

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  in_service: 'In service',
  out_of_service: 'Out of service',
  in_repair: 'In repair',
  lost: 'Lost',
  retired: 'Retired',
}

export function BulkEquipmentBar({
  selectedIds,
  onClear,
  canManage,
  canExport,
}: {
  selectedIds: string[]
  onClear: () => void
  canManage: boolean
  canExport: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [action, setAction] = useState<'site' | 'holder' | 'status' | 'export'>(() =>
    canManage ? 'site' : 'export',
  )
  const [siteId, setSiteId] = useState('')
  const [personId, setPersonId] = useState('')
  const [status, setStatus] = useState<EquipmentStatus>('in_service')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  // Portal target only exists after mount (SSR renders nothing here).
  const mounted = useHydrated()

  const label = useMemo(
    () => `${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0 || !mounted) return null

  function go() {
    setError(null)
    setInfo(null)
    if (action !== 'export' && !canManage) {
      setError('You do not have permission to manage equipment.')
      return
    }
    if (action === 'site') {
      if (!siteId) {
        setError('Pick a site.')
        return
      }
      start(async () => {
        const res = await bulkTransferEquipmentToSite({
          equipmentIds: selectedIds,
          siteOrgUnitId: siteId,
        })
        if (!res.ok) {
          setError(res.error)
          return
        }
        setInfo(`Transferred ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    if (action === 'holder') {
      if (!personId) {
        setError('Pick a holder.')
        return
      }
      start(async () => {
        const res = await bulkAssignEquipmentToHolder({
          equipmentIds: selectedIds,
          personId,
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
        const res = await bulkSetEquipmentStatus({
          equipmentIds: selectedIds,
          status,
        })
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
      const res = await bulkExportEquipmentCsv({ equipmentIds: selectedIds })
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

  // Portaled to <body>: PageContainer's FadeInBody transform would otherwise
  // capture position:fixed and pin the bar to the container, not the viewport.
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
          {canManage ? <option value="site">Transfer to site</option> : null}
          {canManage ? <option value="holder">Assign to holder</option> : null}
          {canManage ? <option value="status">Set status</option> : null}
          {canExport ? <option value="export">Export selected to CSV</option> : null}
        </Select>

        {action === 'site' ? (
          <div className="flex items-center gap-2">
            <MapPin size={14} className="text-slate-500" />
            <RemoteSearchSelect
              lookup="equipment-custody-sites"
              value={siteId}
              onChange={setSiteId}
              placeholder="Pick site…"
              searchPlaceholder="Search sites…"
              sheetTitle="Transfer to site"
              ariaLabel="Transfer to site"
              className="min-w-[12rem]"
              triggerClassName="h-8"
              disabled={pending}
            />
          </div>
        ) : null}

        {action === 'holder' ? (
          <div className="flex items-center gap-2">
            <UserCog size={14} className="text-slate-500" />
            <RemoteSearchSelect
              lookup="equipment-custody-holders"
              value={personId}
              onChange={setPersonId}
              placeholder="Pick holder…"
              searchPlaceholder="Search people…"
              sheetTitle="Assign to holder"
              ariaLabel="Assign to holder"
              className="min-w-[14rem]"
              triggerClassName="h-8"
              disabled={pending}
            />
          </div>
        ) : null}

        {action === 'status' ? (
          <div className="flex items-center gap-2">
            <ToggleRight size={14} className="text-slate-500" />
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as EquipmentStatus)}
              className="h-8 min-w-[11rem]"
              disabled={pending}
            >
              {(Object.keys(STATUS_LABELS) as EquipmentStatus[]).map((s) => (
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
