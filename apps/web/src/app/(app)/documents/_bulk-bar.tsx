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
import { toast } from 'sonner'
import { Archive, BookOpen, Trash2, X } from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import { bulkAddDocumentsToBook, bulkArchiveDocuments, bulkDeleteDocuments } from './_actions'

export type DocumentBookOption = { id: string; label: string }

export function BulkDocumentsBar({
  selectedIds,
  onClear,
  books,
}: {
  selectedIds: string[]
  onClear: () => void
  books: DocumentBookOption[]
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [action, setAction] = useState<'archive' | 'addToBook' | 'delete'>('archive')
  const [bookId, setBookId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const label = useMemo(
    () => `${selectedIds.length} document${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0 || typeof document === 'undefined') return null

  async function go() {
    setError(tGeneratedValue(null))
    // Success is surfaced via toast — clearing the selection unmounts the bar,
    // so any inline message would never be seen.
    if (action === 'archive') {
      if (
        !(await confirmDialog({
          message: `Archive ${selectedIds.length} document(s)?`,
          tone: 'danger',
        }))
      )
        return
      start(async () => {
        const res = await bulkArchiveDocuments({ documentIds: selectedIds })
        if (!res.ok) {
          setError(tGeneratedValue(res.error))
          return
        }
        toast.success(
          tGenerated('m_1c89fad4ce184c', {
            value0: res.updated,
            value1: res.skipped ? `, skipped ${res.skipped}` : '',
          }),
        )
        onClear()
        router.refresh()
      })
      return
    }
    if (action === 'delete') {
      if (
        !(await confirmDialog({
          message: `Delete ${selectedIds.length} document(s)? Readers lose access and they disappear from every list. Version history is kept for audit.`,
          tone: 'danger',
        }))
      )
        return
      start(async () => {
        const res = await bulkDeleteDocuments({ documentIds: selectedIds })
        if (!res.ok) {
          setError(tGeneratedValue(res.error))
          return
        }
        toast.success(
          tGenerated('m_1a4925e8b8cfed', {
            value0: res.updated,
            value1: res.skipped ? `, skipped ${res.skipped}` : '',
          }),
        )
        onClear()
        router.refresh()
      })
      return
    }
    // addToBook
    if (!bookId) {
      setError(tGenerated('m_0416ca46c70a85'))
      return
    }
    start(async () => {
      const res = await bulkAddDocumentsToBook({
        documentIds: selectedIds,
        bookId,
      })
      if (!res.ok) {
        setError(tGeneratedValue(res.error))
        return
      }
      toast.success(
        tGenerated('m_0a87546f305df6', {
          value0: res.updated,
          value1: res.skipped ? `, skipped ${res.skipped}` : '',
        }),
      )
      onClear()
      router.refresh()
    })
  }

  // Portaled to <body>: ancestors with CSS transforms (e.g. the page fade-in
  // wrapper) would otherwise capture position:fixed and mis-pin the bar.
  return createPortal(
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
          className="h-8 min-w-[11rem]"
          disabled={pending}
        >
          <option value="archive">{'Archive'}</option>
          <option value="addToBook">{'Add to book'}</option>
          <option value="delete">{'Delete'}</option>
        </Select>

        <GeneratedValue
          value={
            action === 'addToBook' ? (
              <div className="flex items-center gap-2">
                <BookOpen size={14} className="text-slate-500" />
                <Select
                  value={bookId}
                  onChange={(e) => setBookId(e.target.value)}
                  className="h-8 min-w-[14rem]"
                  disabled={pending}
                >
                  <option value="">{'Pick book…'}</option>
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null
          }
        />

        <Button
          size="sm"
          variant={action === 'delete' ? 'destructive' : 'default'}
          onClick={go}
          disabled={pending}
        >
          <GeneratedValue
            value={
              pending ? (
                <GeneratedText id="m_09001dc89c0edf" />
              ) : action === 'archive' ? (
                <span className="inline-flex items-center gap-1">
                  <Archive size={14} /> <GeneratedText id="m_019c0a64030688" />
                </span>
              ) : action === 'delete' ? (
                <span className="inline-flex items-center gap-1">
                  <Trash2 size={14} /> <GeneratedText id="m_11773f3c3f7558" />
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  <BookOpen size={14} /> <GeneratedText id="m_16c8592e5020a4" />
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
      </div>
    </div>,
    document.body,
  )
}
