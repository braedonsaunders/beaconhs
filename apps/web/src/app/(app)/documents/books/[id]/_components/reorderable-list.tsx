'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from 'lucide-react'
import { Badge, Button } from '@beaconhs/ui'
import { reorderBookItemsAction, removeBookItemAction } from '../actions'

type BookItem = {
  documentId: string
  title: string
  status: 'draft' | 'published' | 'archived' | 'under_review'
  pinnedVersion: number | null
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
  locked,
}: {
  bookId: string
  initial: BookItem[]
  locked: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [items, setItems] = useState(initial)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)

  function commit(next: BookItem[]) {
    if (locked) return
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
    if (locked) return
    start(async () => {
      await removeBookItemAction(bookId, documentId)
      router.refresh()
    })
  }

  function onDragStart(idx: number) {
    if (locked) return
    setDragIdx(idx)
  }
  function onDragOver(e: React.DragEvent, idx: number) {
    if (locked) return
    e.preventDefault()
    setOverIdx(idx)
  }
  function onDrop(idx: number) {
    if (locked) return
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
      <GeneratedValue
        value={items.map((row, idx) => (
          <li
            key={row.documentId}
            draggable={!locked}
            onDragStart={() => onDragStart(idx)}
            onDragOver={(e) => onDragOver(e, idx)}
            onDrop={() => onDrop(idx)}
            onDragEnd={onDragEnd}
            className={`flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 transition-colors dark:bg-slate-900 ${
              overIdx === idx && dragIdx !== idx
                ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40'
                : dragIdx === idx
                  ? 'border-slate-300 opacity-60 dark:border-slate-600'
                  : 'border-slate-200 dark:border-slate-800'
            } ${pending ? 'cursor-progress' : locked ? 'cursor-default' : 'cursor-grab'}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <GeneratedValue
                value={
                  !locked ? (
                    <GripVertical
                      size={14}
                      className="shrink-0 text-slate-400 dark:text-slate-500"
                      aria-hidden
                    />
                  ) : null
                }
              />
              <span className="w-6 shrink-0 font-mono text-xs text-slate-400 dark:text-slate-500">
                <GeneratedValue value={idx + 1} />.
              </span>
              <Link
                href={`/documents/${row.documentId}`}
                className="truncate font-medium text-slate-900 hover:underline dark:text-slate-100"
              >
                <GeneratedValue value={row.title} />
              </Link>
              <GeneratedValue
                value={
                  row.status !== 'published' ? (
                    <Badge variant="warning">
                      <GeneratedValue value={row.status} />
                    </Badge>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  locked ? (
                    row.pinnedVersion ? (
                      <Badge variant="secondary">
                        <GeneratedText id="m_1c693e59d64fb2" />
                        <GeneratedValue value={row.pinnedVersion} />
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <GeneratedText id="m_1b1d4d34556ccf" />
                      </Badge>
                    )
                  ) : null
                }
              />
            </div>
            <GeneratedValue
              value={
                !locked ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={idx === 0 || pending}
                      aria-label={tGenerated('m_1ec1460770eaa0')}
                      onClick={() => move(row.documentId, 'up')}
                    >
                      <ArrowUp size={14} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={idx === items.length - 1 || pending}
                      aria-label={tGenerated('m_14ab8cefda3cf9')}
                      onClick={() => move(row.documentId, 'down')}
                    >
                      <ArrowDown size={14} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      aria-label={tGenerated('m_0d64d4cdef1d99')}
                      onClick={() => remove(row.documentId)}
                    >
                      <Trash2 size={14} className="text-red-500" />
                    </Button>
                  </div>
                ) : null
              }
            />
          </li>
        ))}
      />
    </ol>
  )
}
