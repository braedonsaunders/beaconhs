'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react'
import { Badge, Button } from '@beaconhs/ui'
import { reorderBookItemsAction, removeBookItemAction } from '../actions'

export type BookItem = {
  documentId: string
  title: string
  status: 'draft' | 'published' | 'archived' | 'under_review'
}

/**
 * HTML5-drag reorderable list for book contents. Falls back to up/down arrows
 * for keyboard / touch users — no third-party dependency.
 *
 * Reorder is committed when the user releases the drag (drop fires the server
 * action). Up/down buttons commit immediately too.
 */
export function ReorderableList({
  bookId,
  initial,
}: {
  bookId: string
  initial: BookItem[]
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [items, setItems] = useState(initial)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  function commit(next: BookItem[]) {
    setItems(next)
    start(async () => {
      await reorderBookItemsAction(
        bookId,
        next.map((i) => i.documentId),
      )
      router.refresh()
    })
  }

  function move(documentId: string, dir: 'up' | 'down') {
    const idx = items.findIndex((i) => i.documentId === documentId)
    if (idx < 0) return
    const swap = dir === 'up' ? idx - 1 : idx + 1
    if (swap < 0 || swap >= items.length) return
    const next = items.slice()
    next.splice(swap, 0, next.splice(idx, 1)[0]!)
    commit(next)
  }

  function remove(documentId: string) {
    start(async () => {
      await removeBookItemAction(bookId, documentId)
      router.refresh()
    })
  }

  function onDragStart(idx: number) {
    setDragIdx(idx)
  }
  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    setOverIdx(idx)
  }
  function onDrop(idx: number) {
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null)
      setOverIdx(null)
      return
    }
    const next = items.slice()
    const [removed] = next.splice(dragIdx, 1)
    next.splice(idx, 0, removed!)
    setDragIdx(null)
    setOverIdx(null)
    commit(next)
  }
  function onDragEnd() {
    setDragIdx(null)
    setOverIdx(null)
  }

  return (
    <ol className="space-y-2 text-sm">
      {items.map((row, idx) => (
        <li
          key={row.documentId}
          draggable
          onDragStart={() => onDragStart(idx)}
          onDragOver={(e) => onDragOver(e, idx)}
          onDrop={() => onDrop(idx)}
          onDragEnd={onDragEnd}
          className={`flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 transition-colors ${
            overIdx === idx && dragIdx !== idx
              ? 'border-teal-500 bg-teal-50'
              : dragIdx === idx
                ? 'border-slate-300 opacity-60'
                : 'border-slate-200'
          } ${pending ? 'cursor-progress' : 'cursor-grab'}`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <GripVertical size={14} className="shrink-0 text-slate-400" aria-hidden />
            <span className="w-6 shrink-0 font-mono text-xs text-slate-400">{idx + 1}.</span>
            <Link
              href={`/documents/${row.documentId}`}
              className="truncate font-medium text-slate-900 hover:underline"
            >
              {row.title}
            </Link>
            {row.status !== 'published' ? (
              <Badge variant="warning">{row.status}</Badge>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={idx === 0 || pending}
              aria-label="Move up"
              onClick={() => move(row.documentId, 'up')}
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={idx === items.length - 1 || pending}
              aria-label="Move down"
              onClick={() => move(row.documentId, 'down')}
            >
              <ArrowDown size={14} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              aria-label="Remove from book"
              onClick={() => remove(row.documentId)}
            >
              <Trash2 size={14} className="text-red-500" />
            </Button>
          </div>
        </li>
      ))}
    </ol>
  )
}
