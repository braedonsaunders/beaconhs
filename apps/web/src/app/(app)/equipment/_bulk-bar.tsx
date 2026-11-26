'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, MapPin, QrCode, ToggleRight, UserCog } from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import {
  bulkAssignEquipmentToHolder,
  bulkExportEquipmentCsv,
  bulkSetEquipmentStatus,
  bulkTransferEquipmentToSite,
  type EquipmentStatus,
} from './_actions'
import { generateBulkQrSheet } from './_qr-actions'
import { FloatingSelectionBar } from '@/components/floating-selection-bar'

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
  canCreateQr,
}: {
  selectedIds: string[]
  onClear: () => void
  canManage: boolean
  canExport: boolean
  canCreateQr: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [action, setAction] = useState<'site' | 'holder' | 'status' | 'export' | 'qr'>(() =>
    canManage ? 'site' : canCreateQr ? 'qr' : 'export',
  )
  const [siteId, setSiteId] = useState('')
  const [personId, setPersonId] = useState('')
  const [status, setStatus] = useState<EquipmentStatus>('in_service')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const label = useMemo(
    () => `${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0 || (!canManage && !canExport && !canCreateQr)) return null

  function go() {
    setError(tGeneratedValue(null))
    setInfo(null)
    if (action === 'qr') {
      if (!canCreateQr) return
      start(async () => {
        try {
          const result = await generateBulkQrSheet({ equipmentIds: selectedIds })
          if (!result.ok) {
            setError(tGeneratedValue(result.error))
            return
          }
          const response = await fetch(result.href)
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null
            setError(body?.error ?? tGeneratedValue('Could not create QR codes. Try again.'))
            return
          }
          if (!response.headers.get('content-type')?.includes('application/pdf')) {
            setError(tGeneratedValue('Could not create QR codes. Try again.'))
            return
          }
          const url = URL.createObjectURL(await response.blob())
          const link = document.createElement('a')
          link.href = url
          link.download = `equipment-labels-${result.count}.pdf`
          document.body.appendChild(link)
          link.click()
          link.remove()
          URL.revokeObjectURL(url)
        } catch {
          setError(tGeneratedValue('Could not create QR codes. Try again.'))
        }
      })
      return
    }
    if (action !== 'export' && !canManage) {
      setError(tGenerated('m_1f2655e7ce2296'))
      return
    }
    if (action === 'site') {
      if (!siteId) {
        setError(tGenerated('m_0ea8429976384c'))
        return
      }
      start(async () => {
        const res = await bulkTransferEquipmentToSite({
          equipmentIds: selectedIds,
          siteOrgUnitId: siteId,
        })
        if (!res.ok) {
          setError(tGeneratedValue(res.error))
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
        setError(tGenerated('m_03a718e0795f65'))
        return
      }
      start(async () => {
        const res = await bulkAssignEquipmentToHolder({
          equipmentIds: selectedIds,
          personId,
        })
        if (!res.ok) {
          setError(tGeneratedValue(res.error))
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
          setError(tGeneratedValue(res.error))
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
        setError(tGeneratedValue(res.error))
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
    <FloatingSelectionBar label={label} onClear={onClear} clearDisabled={pending}>
      <Select
        value={action}
        onChange={(e) => setAction(e.target.value as typeof action)}
        className="h-8 min-w-[11rem]"
        disabled={pending}
      >
        {canManage ? <option value="site">{'Transfer to location'}</option> : null}
        {canManage ? <option value="holder">{'Assign to holder'}</option> : null}
        {canManage ? <option value="status">{'Set status'}</option> : null}
        {canCreateQr ? <option value="qr">{tGeneratedValue('Create QR codes')}</option> : null}
        {canExport ? <option value="export">{'Export selected to CSV'}</option> : null}
      </Select>

      <GeneratedValue
        value={
          action === 'site' ? (
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-slate-500" />
              <RemoteSearchSelect
                lookup="equipment-station-locations"
                value={siteId}
                onChange={setSiteId}
                placeholder={tGeneratedValue('Select location…')}
                searchPlaceholder={tGeneratedValue('Search locations…')}
                sheetTitle="Transfer to location"
                ariaLabel="Transfer to location"
                className="min-w-[12rem]"
                triggerClassName="h-8"
                disabled={pending}
              />
            </div>
          ) : null
        }
      />

      <GeneratedValue
        value={
          action === 'holder' ? (
            <div className="flex items-center gap-2">
              <UserCog size={14} className="text-slate-500" />
              <RemoteSearchSelect
                lookup="equipment-custody-holders"
                value={personId}
                onChange={setPersonId}
                placeholder={tGenerated('m_152d48ab44e3a0')}
                searchPlaceholder={tGenerated('m_0b842b664b4f3b')}
                sheetTitle="Assign to holder"
                ariaLabel="Assign to holder"
                className="min-w-[14rem]"
                triggerClassName="h-8"
                disabled={pending}
              />
            </div>
          ) : null
        }
      />

      <GeneratedValue
        value={
          action === 'status' ? (
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
          ) : null
        }
      />

      <Button size="sm" onClick={go} disabled={pending}>
        <GeneratedValue
          value={
            pending ? (
              <GeneratedText id="m_09001dc89c0edf" />
            ) : action === 'qr' ? (
              <span className="inline-flex items-center gap-1">
                <QrCode size={14} /> <GeneratedValue value="Create QR codes" />
              </span>
            ) : action === 'export' ? (
              <span className="inline-flex items-center gap-1">
                <Download size={14} /> <GeneratedText id="m_01edcd3d04ad91" />
              </span>
            ) : (
              <GeneratedText id="m_01185cdc1c20a5" />
            )
          }
        />
      </Button>
      <GeneratedValue
        value={
          error ? (
            <span role="alert" className="text-xs text-red-600 dark:text-red-400">
              <GeneratedValue value={error} />
            </span>
          ) : null
        }
      />
      <GeneratedValue
        value={
          info ? (
            <span className="text-xs text-emerald-700 dark:text-emerald-400">
              <GeneratedValue value={info} />
            </span>
          ) : null
        }
      />
    </FloatingSelectionBar>
  )
}
