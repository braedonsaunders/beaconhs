'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Download, HandHelping, Trash2, X } from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import { confirmDialog } from '@/lib/confirm'
import { bulkDiscardPpe, bulkExportPpeCsv, bulkIssuePpeToPerson } from './_actions'
import { useHydrated } from '@/lib/use-hydrated'

export function BulkPpeBar({
  selectedIds,
  onClear,
}: {
  selectedIds: string[]
  onClear: () => void
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [action, setAction] = useState<'issue' | 'discard' | 'export'>('issue')
  const [personId, setPersonId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  // Portal target only exists after mount (SSR renders nothing here).
  const mounted = useHydrated()

  const label = useMemo(
    () => `${selectedIds.length} PPE item${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0 || !mounted) return null

  async function go() {
    setError(tGeneratedValue(null))
    setInfo(null)
    if (action === 'issue') {
      if (!personId) {
        setError(tGenerated('m_03a718e0795f65'))
        return
      }
      start(async () => {
        const res = await bulkIssuePpeToPerson({
          ppeItemIds: selectedIds,
          personId,
        })
        if (!res.ok) {
          setError(tGeneratedValue(res.error))
          return
        }
        setInfo(`Issued ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    if (action === 'discard') {
      if (
        !(await confirmDialog({
          message: `Discard ${selectedIds.length} PPE item(s)?`,
          tone: 'danger',
        }))
      )
        return
      start(async () => {
        const res = await bulkDiscardPpe({
          ppeItemIds: selectedIds,
          reason: reason.trim() || null,
        })
        if (!res.ok) {
          setError(tGeneratedValue(res.error))
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

  // Portaled to <body>: PageContainer's FadeInBody transform would otherwise
  // capture position:fixed and pin the bar to the container, not the viewport.
  return createPortal(
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
          onChange={(e) => setAction(e.target.value as typeof action)}
          className="h-8 min-w-[10rem]"
          disabled={pending}
        >
          <option value="issue">{'Issue to person'}</option>
          <option value="discard">{'Discard'}</option>
          <option value="export">{'Export selected to CSV'}</option>
        </Select>

        <GeneratedValue
          value={
            action === 'issue' ? (
              <div className="flex items-center gap-2">
                <HandHelping size={14} className="text-slate-500" />
                <RemoteSearchSelect
                  lookup="ppe-active-people"
                  value={personId}
                  onChange={setPersonId}
                  placeholder={tGenerated('m_152d48ab44e3a0')}
                  className="h-8 min-w-[14rem]"
                  disabled={pending}
                />
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            action === 'discard' ? (
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={tGenerated('m_1d2f68230e66e9')}
                className="h-8 w-48 rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
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
              ) : action === 'discard' ? (
                <span className="inline-flex items-center gap-1">
                  <Trash2 size={14} /> <GeneratedText id="m_056c8c15d77140" />
                </span>
              ) : action === 'export' ? (
                <span className="inline-flex items-center gap-1">
                  <Download size={14} /> <GeneratedText id="m_01edcd3d04ad91" />
                </span>
              ) : (
                <GeneratedText id="m_12ac7fffa3512c" />
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
    </div>,
    document.body,
  )
}
