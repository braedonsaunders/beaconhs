'use client'

import { useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Archive, BookOpen, CheckSquare, Send, Square, Trash2, X } from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import {
  bulkAddDocumentsToBook,
  bulkArchiveDocuments,
  bulkDeleteDocuments,
  bulkPublishDocuments,
} from './_actions'

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
  const router = useRouter()
  const [pending, start] = useTransition()
  const [action, setAction] = useState<'publish' | 'archive' | 'addToBook' | 'delete'>('publish')
  const [bookId, setBookId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const label = useMemo(
    () => `${selectedIds.length} document${selectedIds.length === 1 ? '' : 's'} selected`,
    [selectedIds.length],
  )

  if (selectedIds.length === 0 || typeof document === 'undefined') return null

  async function go() {
    setError(null)
    // Success is surfaced via toast — clearing the selection unmounts the bar,
    // so any inline message would never be seen.
    if (action === 'publish') {
      start(async () => {
        const res = await bulkPublishDocuments({ documentIds: selectedIds })
        if (!res.ok) {
          setError(res.error)
          return
        }
        toast.success(`Published ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    if (action === 'archive') {
      if (!(await confirmDialog({ message: `Archive ${selectedIds.length} document(s)?`, tone: 'danger' }))) return
      start(async () => {
        const res = await bulkArchiveDocuments({ documentIds: selectedIds })
        if (!res.ok) {
          setError(res.error)
          return
        }
        toast.success(`Archived ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
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
          setError(res.error)
          return
        }
        toast.success(`Deleted ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
        onClear()
        router.refresh()
      })
      return
    }
    // addToBook
    if (!bookId) {
      setError('Pick a book.')
      return
    }
    start(async () => {
      const res = await bulkAddDocumentsToBook({
        documentIds: selectedIds,
        bookId,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      toast.success(`Added ${res.updated}${res.skipped ? `, skipped ${res.skipped}` : ''}.`)
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
          <option value="publish">Publish</option>
          <option value="archive">Archive</option>
          <option value="addToBook">Add to book</option>
          <option value="delete">Delete</option>
        </Select>

        {action === 'addToBook' ? (
          <div className="flex items-center gap-2">
            <BookOpen size={14} className="text-slate-500" />
            <Select
              value={bookId}
              onChange={(e) => setBookId(e.target.value)}
              className="h-8 min-w-[14rem]"
              disabled={pending}
            >
              <option value="">Pick book…</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}

        <Button
          size="sm"
          variant={action === 'delete' ? 'destructive' : 'default'}
          onClick={go}
          disabled={pending}
        >
          {pending ? (
            'Working…'
          ) : action === 'publish' ? (
            <span className="inline-flex items-center gap-1">
              <Send size={14} /> Publish
            </span>
          ) : action === 'archive' ? (
            <span className="inline-flex items-center gap-1">
              <Archive size={14} /> Archive
            </span>
          ) : action === 'delete' ? (
            <span className="inline-flex items-center gap-1">
              <Trash2 size={14} /> Delete
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <BookOpen size={14} /> Add
            </span>
          )}
        </Button>
        {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
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
      className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
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
      className="inline-flex items-center justify-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      {allSelected ? (
        <CheckSquare size={16} className="text-teal-700 dark:text-teal-400" />
      ) : (
        <Square size={16} />
      )}
    </button>
  )
}
