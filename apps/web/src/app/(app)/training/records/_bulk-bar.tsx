'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, Download, RotateCcw, ShieldOff, X } from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import {
  bulkExportTrainingRecordsCsv,
  bulkRenewTrainingRecords,
  bulkRevokeTrainingRecords,
} from './_actions'
import { confirmDialog } from '@/lib/confirm'

type BulkAction = 'print' | 'renew' | 'revoke' | 'export'

export function BulkTrainingRecordsBar({
  selectedIds,
  onClear,
  canManage,
  canExport,
  canPrint,
}: {
  selectedIds: string[]
  onClear: () => void
  /** training.record.create — gates Renew/Revoke. */
  canManage: boolean
  /** training.read.all — gates Export (only all-viewers may bulk-export). */
  canExport: boolean
  /** Any visible training record can have its wallet card printed. */
  canPrint: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [action, setAction] = useState<BulkAction>(
    canPrint ? 'print' : canManage ? 'renew' : 'export',
  )
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const actionOptions = useMemo<{ value: BulkAction; label: string }[]>(
    () => [
      ...(canManage
        ? [
            { value: 'renew' as const, label: 'Renew (create new record)' },
            { value: 'revoke' as const, label: 'Revoke' },
          ]
        : []),
      ...(canPrint ? [{ value: 'print' as const, label: tGenerated('m_04df2153ab0fcf') }] : []),
      ...(canExport ? [{ value: 'export' as const, label: 'Export selected to CSV' }] : []),
    ],
    [canManage, canExport, canPrint, tGenerated],
  )

  const label = useMemo(
    () => `${selectedIds.length} record${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0) return null
  // No actionable permission → no bar (the list also hides the row checkboxes).
  if (actionOptions.length === 0) return null

  async function go() {
    setError(tGeneratedValue(null))
    setInfo(null)
    if (action === 'print') {
      start(async () => {
        try {
          const response = await fetch('/training/records/wallet-cards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recordIds: selectedIds }),
          })
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { error?: string } | null
            setError(body?.error ?? tGenerated('m_0102db1d731a26'))
            return
          }
          const blob = await response.blob()
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `training-wallet-cards-${new Date().toISOString().slice(0, 10)}.pdf`
          document.body.appendChild(link)
          link.click()
          link.remove()
          URL.revokeObjectURL(url)
          const rendered = Number(response.headers.get('X-Rendered-Records') ?? selectedIds.length)
          const skipped = Number(response.headers.get('X-Skipped-Records') ?? 0)
          setInfo(
            `Prepared ${rendered} wallet card${rendered === 1 ? '' : 's'}${skipped ? `; skipped ${skipped}` : ''}.`,
          )
        } catch {
          setError(tGenerated('m_0102db1d731a26'))
        }
      })
      return
    }
    if (action === 'renew') {
      if (
        !(await confirmDialog({
          message: `Renew ${selectedIds.length} record(s)? Each creates a new record dated today.`,
          tone: 'danger',
        }))
      ) {
        return
      }
      start(async () => {
        const res = await bulkRenewTrainingRecords({ recordIds: selectedIds })
        if (!res.ok) {
          setError(tGeneratedValue(res.error))
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
        !(await confirmDialog({
          message: `Revoke ${selectedIds.length} record(s)? They will no longer count toward the training matrix.`,
          tone: 'danger',
        }))
      ) {
        return
      }
      start(async () => {
        const res = await bulkRevokeTrainingRecords({
          recordIds: selectedIds,
          reason: reason.trim() || null,
        })
        if (!res.ok) {
          setError(tGeneratedValue(res.error))
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
    <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={onClear}
          aria-label={tGenerated('m_1013583a7c0e28')}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <X size={14} />
        </button>
        <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
          <GeneratedValue value={label} />
        </span>

        <Select
          value={action}
          onChange={(e) => setAction(e.target.value as BulkAction)}
          className="h-8 min-w-[10rem]"
          disabled={pending}
        >
          {actionOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>

        <GeneratedValue
          value={
            action === 'revoke' ? (
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={tGenerated('m_1d2f68230e66e9')}
                className="h-8 w-48 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                disabled={pending}
              />
            ) : null
          }
        />

        <Button size="sm" onClick={go} disabled={pending}>
          <GeneratedValue
            value={
              pending ? (
                <GeneratedText id="m_09001dc89c0edf" />
              ) : action === 'print' ? (
                <span className="inline-flex items-center gap-1">
                  <CreditCard size={14} /> <GeneratedText id="m_124553ef26fbe5" />
                </span>
              ) : action === 'renew' ? (
                <span className="inline-flex items-center gap-1">
                  <RotateCcw size={14} /> <GeneratedText id="m_1f6557a4319c50" />
                </span>
              ) : action === 'revoke' ? (
                <span className="inline-flex items-center gap-1">
                  <ShieldOff size={14} /> <GeneratedText id="m_18718dd379a57d" />
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <Download size={14} /> <GeneratedText id="m_01edcd3d04ad91" />
                </span>
              )
            }
          />
        </Button>
        <GeneratedValue
          value={
            error ? (
              <span className="text-xs text-red-600 dark:text-red-400">
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
      </div>
    </div>
  )
}
