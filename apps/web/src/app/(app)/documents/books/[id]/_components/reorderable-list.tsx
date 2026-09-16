'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowDown, ArrowUp, Check, GripVertical, Pencil, Trash2, X } from 'lucide-react'
import { Badge, Button, Input } from '@beaconhs/ui'
import { reorderBookItemsAction, removeBookItemAction, renameBookSectionAction } from '../actions'

type BookItem = {
  itemId: string
  kind: 'document' | 'section'
  /** Null for a section. */
  documentId: string | null
  title: string
  status: 'draft' | 'published' | 'archived' | 'under_review' | null
  pinnedVersion: number | null
}

/**
 * HTML5-drag reorderable list for book contents. Falls back to up/down arrows
 * for keyboard / touch users — no third-party dependency.
 *
 * Keyed by ENTRY id, not document id: a book also holds section dividers,
 * which have no document, and two sections are otherwise indistinguishable.
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
  const [editing, setEditing] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  function commit(next: BookItem[]) {
    if (locked) return
    setItems(next)
    start(async () => {
      await reorderBookItemsAction(
        bookId,
        next.map((i) => i.itemId),
      )
      router.refresh()
    })
  }

  function move(itemId: string, dir: 'up' | 'down') {
    const idx = items.findIndex((i) => i.itemId === itemId)
    if (idx < 0) return
    const swap = dir === 'up' ? idx - 1 : idx + 1
    if (swap < 0 || swap >= items.length) return
    const next = items.slice()
    next.splice(swap, 0, next.splice(idx, 1)[0]!)
    commit(next)
  }

  function remove(itemId: string) {
    if (locked) return
    setItems((rows) => rows.filter((row) => row.itemId !== itemId))
    start(async () => {
      await removeBookItemAction(bookId, itemId)
      router.refresh()
    })
  }

  function saveTitle(itemId: string) {
    const next = draftTitle.trim()
    if (!next) return
    setItems((rows) => rows.map((row) => (row.itemId === itemId ? { ...row, title: next } : row)))
    setEditing(null)
    start(async () => {
      await renameBookSectionAction(bookId, itemId, next)
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

  // Documents are numbered; sections are not, because a divider is not an item
  // of the manual's contents — it names the run that follows it.
  //
  // Built with a reduce rather than a counter: mutating a variable while
  // mapping is a render side effect the compiler rejects.
  const numbering = items.reduce<(number | null)[]>((acc, row) => {
    const previous = acc.reduce<number>((max, value) => (value === null ? max : value), 0)
    acc.push(row.kind === 'document' ? previous + 1 : null)
    return acc
  }, [])

  return (
    <ol className="space-y-2 text-sm">
      <GeneratedValue
        value={items.map((row, idx) => {
          const isSection = row.kind === 'section'
          const dropTone =
            overIdx === idx && dragIdx !== idx
              ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/40'
              : dragIdx === idx
                ? 'border-slate-300 opacity-60 dark:border-slate-600'
                : isSection
                  ? 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60'
                  : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'
          return (
            <li
              key={row.itemId}
              draggable={!locked}
              onDragStart={() => onDragStart(idx)}
              onDragOver={(e) => onDragOver(e, idx)}
              onDrop={() => onDrop(idx)}
              onDragEnd={onDragEnd}
              className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors ${dropTone} ${
                pending ? 'cursor-progress' : locked ? 'cursor-default' : 'cursor-grab'
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
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
                  <GeneratedValue value={numbering[idx] ? `${numbering[idx]}.` : ''} />
                </span>

                <GeneratedValue
                  value={
                    isSection ? (
                      editing === row.itemId ? (
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                          <Input
                            autoFocus
                            value={draftTitle}
                            onChange={(e) => setDraftTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveTitle(row.itemId)
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            className="h-7 text-sm"
                            aria-label={tGenerated('m_0a06556050cff5')}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => saveTitle(row.itemId)}
                            aria-label={tGenerated('m_19e6bff894c3c7')}
                          >
                            <Check size={14} />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(null)}
                            aria-label={tGenerated('m_112e2e8ecda428')}
                          >
                            <X size={14} />
                          </Button>
                        </div>
                      ) : (
                        <span className="truncate text-xs font-semibold tracking-[0.12em] text-slate-600 uppercase dark:text-slate-300">
                          <GeneratedValue value={row.title} />
                        </span>
                      )
                    ) : (
                      <Link
                        href={`/documents/${row.documentId}`}
                        className="truncate font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        <GeneratedValue value={row.title} />
                      </Link>
                    )
                  }
                />

                <GeneratedValue
                  value={
                    isSection ? (
                      <Badge variant="secondary">
                        <GeneratedText id="m_0d513924d97753" />
                      </Badge>
                    ) : row.status !== 'published' ? (
                      <Badge variant="warning">
                        <GeneratedValue value={row.status} />
                      </Badge>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    locked && !isSection ? (
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
                      <GeneratedValue
                        value={
                          isSection && editing !== row.itemId ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              aria-label={tGenerated('m_0a06556050cff5')}
                              onClick={() => {
                                setEditing(row.itemId)
                                setDraftTitle(row.title)
                              }}
                            >
                              <Pencil size={14} />
                            </Button>
                          ) : null
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={idx === 0 || pending}
                        aria-label={tGenerated('m_1ec1460770eaa0')}
                        onClick={() => move(row.itemId, 'up')}
                      >
                        <ArrowUp size={14} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={idx === items.length - 1 || pending}
                        aria-label={tGenerated('m_14ab8cefda3cf9')}
                        onClick={() => move(row.itemId, 'down')}
                      >
                        <ArrowDown size={14} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        aria-label={tGenerated('m_0d64d4cdef1d99')}
                        onClick={() => remove(row.itemId)}
                      >
                        <Trash2 size={14} className="text-red-500" />
                      </Button>
                    </div>
                  ) : null
                }
              />
            </li>
          )
        })}
      />
    </ol>
  )
}
