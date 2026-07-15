'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, Download, Tag, X } from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import {
  bulkArchiveIncidents,
  bulkExportIncidentsCsv,
  bulkSetIncidentClassification,
} from './_actions'

export type IncidentClassificationOption = {
  id: string
  name: string
  code: string | null
}

/**
 * Floating bulk-action bar on the /incidents list page. Mirrors the corrective-
 * actions bar pattern: appears when count > 0, exposes three actions selected
 * by an action dropdown, hidden when nothing is selected.
 */
export function BulkIncidentsBar({
  selectedIds,
  onClear,
  classifications,
  canUpdate,
  canExport,
}: {
  selectedIds: string[]
  onClear: () => void
  classifications: IncidentClassificationOption[]
  /** Archive / classification mutate rows — hidden without incidents.update. */
  canUpdate: boolean
  /** Bulk CSV export needs admin.data.export — hidden without it. */
  canExport: boolean
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [action, setAction] = useState<'archive' | 'classification' | 'export'>(
    canUpdate ? 'archive' : 'export',
  )
  const [classificationId, setClassificationId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const label = useMemo(
    () => `${selectedIds.length} incident${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0) return null
  if (!canUpdate && !canExport) return null

  async function go() {
    setError(tGeneratedValue(null))
    setInfo(null)
    if (action === 'archive') {
      if (
        !(await confirmDialog({
          message: `Archive ${selectedIds.length} incident(s)? Archived incidents are removed from the list.`,
          tone: 'danger',
        }))
      ) {
        return
      }
      start(async () => {
        const res = await bulkArchiveIncidents({ incidentIds: selectedIds })
        if (!res.ok) {
          setError(tGeneratedValue(res.error))
          return
        }
        setInfo(`Archived ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    if (action === 'classification') {
      if (!classificationId) {
        setError(tGenerated('m_19244f4a38bf3b'))
        return
      }
      start(async () => {
        const res = await bulkSetIncidentClassification({
          incidentIds: selectedIds,
          classificationId,
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
      const res = await bulkExportIncidentsCsv({ incidentIds: selectedIds })
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
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
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
          <GeneratedValue
            value={
              canUpdate ? (
                <option value="archive">
                  <GeneratedText id="m_019c0a64030688" />
                </option>
              ) : null
            }
          />
          <GeneratedValue
            value={
              canUpdate ? (
                <option value="classification">
                  <GeneratedText id="m_0c5f4a29842def" />
                </option>
              ) : null
            }
          />
          <GeneratedValue
            value={
              canExport ? (
                <option value="export">
                  <GeneratedText id="m_1d9f291cfeb56f" />
                </option>
              ) : null
            }
          />
        </Select>

        <GeneratedValue
          value={
            action === 'classification' ? (
              <div className="flex items-center gap-2">
                <Tag size={14} className="text-slate-500" />
                <Select
                  value={classificationId}
                  onChange={(e) => setClassificationId(e.target.value)}
                  className="h-8 min-w-[12rem]"
                  disabled={pending}
                >
                  <option value="">
                    <GeneratedText id="m_070a5cef89fc44" />
                  </option>
                  <GeneratedValue
                    value={classifications.map((c) => (
                      <option key={c.id} value={c.id}>
                        <GeneratedValue value={c.code ? `${c.code} · ` : ''} />
                        <GeneratedValue value={c.name} />
                      </option>
                    ))}
                  />
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
              ) : action === 'archive' ? (
                <span className="inline-flex items-center gap-1">
                  <Archive size={14} /> <GeneratedText id="m_019c0a64030688" />
                </span>
              ) : action === 'classification' ? (
                <span className="inline-flex items-center gap-1">
                  <Tag size={14} /> <GeneratedText id="m_01185cdc1c20a5" />
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
