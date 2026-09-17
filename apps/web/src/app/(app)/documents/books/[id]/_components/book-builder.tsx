'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Reorder, useDragControls } from 'framer-motion'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  BookText,
  Check,
  FileDown,
  FilePlus2,
  GripVertical,
  Hash,
  Library,
  Loader2,
  Lock,
  Plus,
  Printer,
  Trash2,
} from 'lucide-react'
import { Badge, Button, Drawer, EmptyState } from '@beaconhs/ui'
import { toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/confirm'
import { useReseededState } from '@/lib/use-reseeded-state'
import {
  BuilderRailHeader,
  BuilderRailTab,
  BuilderRailTabs,
  BuilderScroll,
  BuilderShell,
  BuilderSurfaceHeader,
} from '@/components/builder/builder-shell'
import { useDebouncedCallback } from '@/components/builder/sortable-list'
import { RemoteSearchSelect } from '@/components/remote-search-select'
import type { PickerOption } from '@/lib/picker-options'
import {
  addBookHeadingAction,
  addDocumentsToBookAction,
  publishBookAction,
  removeBookItemAction,
  renameBookHeadingAction,
  reorderBookItemsAction,
  unpublishBookAction,
} from '../actions'
import {
  buildBookTree,
  documentNumbering,
  flattenBookTree,
  moveBookEntry,
  type BookChapterNode,
  type BookEntry,
  type BookSectionNode,
} from './book-tree'

type RailView = 'build' | 'print' | 'settings' | 'activity'

/**
 * The document book builder: a 1/3 palette rail beside a 2/3 build surface,
 * the same split as the form designer and every type builder.
 *
 * Structure is stored flat and ordered (see ./book-tree) but edited as the
 * hierarchy it prints as — chapters holding sections holding documents.
 *
 * Edits apply optimistically and persist immediately; drag-reorders are
 * debounced so one drag is one write rather than one per frame.
 */
export function BookBuilder({
  bookId,
  title,
  subtitle,
  published,
  entries,
  settingsSlot,
  printSlot,
  activitySlot,
}: {
  bookId: string
  title: string
  subtitle: string
  published: boolean
  entries: BookEntry[]
  settingsSlot: React.ReactNode
  printSlot: React.ReactNode
  activitySlot: React.ReactNode
}) {
  const tGenerated = useGeneratedTranslations()
  const tGeneratedValue = useGeneratedValueTranslations()
  const router = useRouter()
  const [, startTransition] = React.useTransition()
  // Rendering a book is seconds of work with no visual change until it
  // navigates, so the control has to say it is busy — otherwise people click
  // it again and queue a second render.
  const [rendering, startRender] = React.useTransition()
  const [rail, setRail] = React.useState<RailView>('build')
  const [adding, setAdding] = React.useState(false)
  // A heading arrives named "Untitled chapter". Focusing its title the moment
  // it lands makes naming it one keystroke instead of a hunt down the page.
  const [focusItemId, setFocusItemId] = React.useState<string | null>(null)
  // A published book is locked to exact document versions, so the whole surface
  // is read-only until it is unpublished.
  const locked = published

  const seed = entries.map((entry) => `${entry.itemId}:${entry.title}`).join('|')
  const [items, setItems] = useReseededState(seed, entries)
  const tree = React.useMemo(() => buildBookTree(items), [items])
  const numbering = React.useMemo(() => documentNumbering(items), [items])
  const documentIds = React.useMemo(
    () => items.flatMap((entry) => (entry.documentId ? [entry.documentId] : [])),
    [items],
  )

  const run = React.useCallback(
    (action: () => Promise<unknown>, fallback: string) => {
      startTransition(async () => {
        try {
          await action()
        } catch (error) {
          toast.error(tGeneratedValue(error instanceof Error ? error.message : fallback))
          router.refresh()
        }
      })
    },
    [router, tGeneratedValue],
  )

  const persistOrder = useDebouncedCallback((orderedIds: string[]) => {
    run(() => reorderBookItemsAction(bookId, orderedIds), tGenerated('m_052d39fb27327f'))
  })

  const applyOrder = React.useCallback(
    (next: BookEntry[]) => {
      setItems(next)
      persistOrder(next.map((entry) => entry.itemId))
    },
    [persistOrder, setItems],
  )

  /** Swap one branch of the tree and flatten the whole thing back to order. */
  const reorderBranch = React.useCallback(
    (mutate: (chapters: BookChapterNode[]) => BookChapterNode[]) => {
      applyOrder(flattenBookTree(mutate(tree)))
    },
    [applyOrder, tree],
  )

  function move(entry: BookEntry, direction: -1 | 1) {
    const next = moveBookEntry(items, entry.itemId, direction)
    if (next) applyOrder(next)
  }

  function addHeading(kind: 'chapter' | 'section') {
    run(async () => {
      await addBookHeadingAction(bookId, kind)
      router.refresh()
    }, tGenerated('m_1adc1c26100284'))
  }

  function addDocuments(ids: string[]) {
    setAdding(false)
    run(async () => {
      await addDocumentsToBookAction(bookId, ids)
      router.refresh()
    }, tGenerated('m_1adc1c26100284'))
  }

  async function remove(entry: BookEntry) {
    if (entry.kind !== 'document') {
      const owned = ownedCount(items, entry.itemId)
      // Removing a heading removes only the heading: everything under it stays
      // in the book and joins whatever comes before. Say so, or it reads as
      // "this will delete 42 documents".
      const confirmed = await confirmDialog({
        title: tGenerated('m_1038065563d8a0'),
        message:
          owned > 0
            ? tGenerated('m_109692a8998da7', { value0: entry.title, value1: owned })
            : tGenerated('m_0d5bcbc1e2ab88', { value0: entry.title }),
        confirmLabel: tGenerated('m_11773f3c3f7558'),
        tone: 'danger',
      })
      if (!confirmed) return
    }
    setItems((rows) => rows.filter((row) => row.itemId !== entry.itemId))
    run(async () => {
      await removeBookItemAction(bookId, entry.itemId)
      router.refresh()
    }, tGenerated('m_10514ea7e3722c'))
  }

  function rename(entry: BookEntry, next: string) {
    const trimmed = next.trim() || entry.title
    if (trimmed === entry.title) return
    setItems((rows) =>
      rows.map((row) => (row.itemId === entry.itemId ? { ...row, title: trimmed } : row)),
    )
    run(
      () => renameBookHeadingAction(bookId, entry.itemId, trimmed),
      tGenerated('m_134c8c0662edbf'),
    )
  }

  function togglePublished() {
    run(async () => {
      await (published ? unpublishBookAction(bookId) : publishBookAction(bookId))
      router.refresh()
    }, tGenerated('m_16c73b6230c543'))
  }

  // The pre-chapter bucket has no heading to drag, so it sits outside the
  // reorder group rather than inside it as a child framer cannot move.
  const rootNode = tree[0] && !tree[0].chapter ? tree[0] : null
  const chapterNodes = rootNode ? tree.slice(1) : tree

  const documentCount = items.filter((entry) => entry.kind === 'document').length
  const chapterCount = items.filter((entry) => entry.kind === 'chapter').length
  const sectionCount = items.filter((entry) => entry.kind === 'section').length

  const rowProps = {
    locked,
    numbering,
    focusItemId,
    onMove: move,
    onRemove: remove,
    onRename: rename,
  }

  return (
    <>
      <BuilderShell
        left={
          <>
            <BuilderRailHeader icon={<Library size={15} />} title={title} subtitle={subtitle} />
            <BuilderRailTabs>
              <BuilderRailTab
                active={rail === 'build'}
                onClick={() => setRail('build')}
                icon={<BookOpen size={14} />}
                label={tGenerated('m_0adae4a94c7be3')}
              />
              <BuilderRailTab
                active={rail === 'print'}
                onClick={() => setRail('print')}
                icon={<Printer size={14} />}
                label={tGenerated('m_124553ef26fbe5')}
              />
              <BuilderRailTab
                active={rail === 'settings'}
                onClick={() => setRail('settings')}
                label={tGenerated('m_151769a9fde954')}
              />
              <BuilderRailTab
                active={rail === 'activity'}
                onClick={() => setRail('activity')}
                label={tGenerated('m_14b78af1b2f95e')}
              />
            </BuilderRailTabs>
            <BuilderScroll className="p-3">
              <GeneratedValue
                value={
                  rail === 'build' ? (
                    <BuildPalette
                      locked={locked}
                      onAddDocuments={() => setAdding(true)}
                      onAddChapter={() => addHeading('chapter')}
                      onAddSection={() => addHeading('section')}
                    />
                  ) : rail === 'print' ? (
                    printSlot
                  ) : rail === 'settings' ? (
                    settingsSlot
                  ) : (
                    activitySlot
                  )
                }
              />
            </BuilderScroll>
          </>
        }
        right={
          <>
            <BuilderSurfaceHeader
              icon={<BookText size={15} />}
              title={<GeneratedText id="m_126ceee83986b6" />}
              actions={
                <>
                  <Badge variant="secondary">
                    <GeneratedValue
                      value={tGenerated('m_1118d1c0b18bf5', {
                        value0: chapterCount,
                        value1: sectionCount,
                        value2: documentCount,
                      })}
                    />
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rendering}
                    onClick={() => startRender(() => router.push(`/documents/books/${bookId}/pdf`))}
                  >
                    <GeneratedValue
                      value={
                        rendering ? (
                          <>
                            <Loader2 size={14} className="animate-spin" aria-hidden />
                            <GeneratedText id="m_11beb293de9d2d" />
                          </>
                        ) : (
                          <>
                            <FileDown size={14} /> <GeneratedText id="m_0aff97b409282d" />
                          </>
                        )
                      }
                    />
                  </Button>
                  <Button
                    size="sm"
                    variant={published ? 'outline' : 'default'}
                    onClick={togglePublished}
                  >
                    <GeneratedValue
                      value={
                        published ? (
                          <GeneratedText id="m_0d6976fc2d60c8" />
                        ) : (
                          <>
                            <Check size={14} /> <GeneratedText id="m_1d99c941e4c924" />
                          </>
                        )
                      }
                    />
                  </Button>
                </>
              }
            />
            <BuilderScroll className="space-y-3 lg:p-6">
              <GeneratedValue
                value={
                  locked ? (
                    <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                      <Lock size={14} className="mt-0.5 shrink-0" aria-hidden />
                      <GeneratedText id="m_1c2f5f21df4d47" />
                    </p>
                  ) : null
                }
              />
              <GeneratedValue
                value={
                  items.length === 0 ? (
                    <EmptyState
                      icon={<BookText size={24} />}
                      title={tGenerated('m_1454b9e28adc77')}
                      description={tGenerated('m_0820518548fbd0')}
                    />
                  ) : (
                    <div className="space-y-3">
                      <GeneratedValue
                        value={
                          rootNode ? (
                            <ChapterCard
                              key="__root__"
                              node={rootNode}
                              onReorderSections={(sections) =>
                                reorderBranch((chapters) =>
                                  chapters.map((node) =>
                                    node === rootNode ? { ...node, sections } : node,
                                  ),
                                )
                              }
                              onReorderDocuments={(documents) =>
                                reorderBranch((chapters) =>
                                  chapters.map((node) =>
                                    node === rootNode ? { ...node, documents } : node,
                                  ),
                                )
                              }
                              onReorderSectionDocuments={(section, documents) =>
                                reorderBranch((chapters) =>
                                  chapters.map((node) =>
                                    node === rootNode
                                      ? {
                                          ...node,
                                          sections: node.sections.map((candidate) =>
                                            candidate === section
                                              ? { ...candidate, documents }
                                              : candidate,
                                          ),
                                        }
                                      : node,
                                  ),
                                )
                              }
                              {...rowProps}
                            />
                          ) : null
                        }
                      />
                      <Reorder.Group
                        axis="y"
                        values={chapterNodes}
                        onReorder={(next) =>
                          reorderBranch(() => (rootNode ? [rootNode, ...next] : next))
                        }
                        as="div"
                        className="space-y-3"
                      >
                        <GeneratedValue
                          value={chapterNodes.map((chapter) => (
                            <ChapterCard
                              key={chapter.chapter!.itemId}
                              node={chapter}
                              onReorderSections={(sections) =>
                                reorderBranch((chapters) =>
                                  chapters.map((node) =>
                                    node === chapter ? { ...node, sections } : node,
                                  ),
                                )
                              }
                              onReorderDocuments={(documents) =>
                                reorderBranch((chapters) =>
                                  chapters.map((node) =>
                                    node === chapter ? { ...node, documents } : node,
                                  ),
                                )
                              }
                              onReorderSectionDocuments={(section, documents) =>
                                reorderBranch((chapters) =>
                                  chapters.map((node) =>
                                    node === chapter
                                      ? {
                                          ...node,
                                          sections: node.sections.map((candidate) =>
                                            candidate === section
                                              ? { ...candidate, documents }
                                              : candidate,
                                          ),
                                        }
                                      : node,
                                  ),
                                )
                              }
                              {...rowProps}
                            />
                          ))}
                        />
                      </Reorder.Group>
                    </div>
                  )
                }
              />
              <GeneratedValue
                value={
                  !locked && items.length > 0 ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => addHeading('chapter')}
                    >
                      <Plus size={14} /> <GeneratedText id="m_018443cebba5be" />
                    </Button>
                  ) : null
                }
              />
            </BuilderScroll>
          </>
        }
      />
      <AddDocumentsDrawer
        open={adding}
        onClose={() => setAdding(false)}
        excluded={documentIds}
        onAdd={addDocuments}
      />
    </>
  )
}

/**
 * The left-rail palette. Chapters and sections append a placeholder the user
 * renames in place; documents need a search, so they open a flyout.
 */
function BuildPalette({
  locked,
  onAddDocuments,
  onAddChapter,
  onAddSection,
}: {
  locked: boolean
  onAddDocuments: () => void
  onAddChapter: () => void
  onAddSection: () => void
}) {
  const tGenerated = useGeneratedTranslations()
  if (locked) {
    return (
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_1c2f5f21df4d47" />
      </p>
    )
  }
  return (
    <div className="space-y-3">
      <p className="px-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
        <GeneratedText id="m_0adae4a94c7be3" />
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        <GeneratedText id="m_0820518548fbd0" />
      </p>
      <PaletteTile
        icon={<FilePlus2 size={15} />}
        label={tGenerated('m_120b097f8a83a1')}
        description={tGenerated('m_16a13a44448b12')}
        onClick={onAddDocuments}
      />
      <PaletteTile
        icon={<BookOpen size={15} />}
        label={tGenerated('m_018443cebba5be')}
        description={tGenerated('m_18efbf72ab755d')}
        onClick={onAddChapter}
      />
      <PaletteTile
        icon={<Hash size={15} />}
        label={tGenerated('m_0cfd5e4e441158')}
        description={tGenerated('m_15b8a1044834c4')}
        onClick={onAddSection}
      />
    </div>
  )
}

function PaletteTile({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-teal-400 hover:bg-teal-50/50 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-teal-700 dark:hover:bg-teal-950/30"
    >
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <GeneratedValue value={icon} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
          <GeneratedValue value={label} />
        </span>
        <span className="block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
          <GeneratedValue value={description} />
        </span>
      </span>
    </button>
  )
}

type RowHandlers = {
  locked: boolean
  numbering: Map<string, number>
  /** Heading whose title should take focus — the one just added. */
  focusItemId: string | null
  onMove: (entry: BookEntry, direction: -1 | 1) => void
  onRemove: (entry: BookEntry) => void
  onRename: (entry: BookEntry, title: string) => void
}

function ChapterCard({
  node,
  onReorderSections,
  onReorderDocuments,
  onReorderSectionDocuments,
  ...handlers
}: RowHandlers & {
  node: BookChapterNode
  onReorderSections: (sections: BookSectionNode[]) => void
  onReorderDocuments: (documents: BookEntry[]) => void
  onReorderSectionDocuments: (section: BookSectionNode, documents: BookEntry[]) => void
}) {
  const controls = useDragControls()
  const { chapter } = node
  const body = (
    <div className="space-y-2 p-2">
      <GeneratedValue
        value={
          node.documents.length > 0 ? (
            <DocumentList documents={node.documents} onReorder={onReorderDocuments} {...handlers} />
          ) : node.sections.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
              <GeneratedText id="m_03bf2c39374f74" />
            </p>
          ) : null
        }
      />
      <Reorder.Group
        axis="y"
        values={node.sections}
        onReorder={onReorderSections}
        as="div"
        className="space-y-2"
      >
        <GeneratedValue
          value={node.sections.map((section) => (
            <SectionCard
              key={section.section.itemId}
              node={section}
              onReorderDocuments={(documents) => onReorderSectionDocuments(section, documents)}
              {...handlers}
            />
          ))}
        />
      </Reorder.Group>
    </div>
  )

  // The bucket before the first chapter has no heading to drag, so it renders
  // as a plain block rather than a card that pretends to be one.
  if (!chapter) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800">
        {body}
      </div>
    )
  }

  return (
    <Reorder.Item
      value={node}
      dragListener={false}
      dragControls={controls}
      as="div"
      className="overflow-hidden rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
    >
      <HeadingHeader
        entry={chapter}
        controls={controls}
        tone="chapter"
        count={node.documents.length + node.sections.reduce((n, s) => n + s.documents.length, 0)}
        {...handlers}
      />
      {body}
    </Reorder.Item>
  )
}

function SectionCard({
  node,
  onReorderDocuments,
  ...handlers
}: RowHandlers & {
  node: BookSectionNode
  onReorderDocuments: (documents: BookEntry[]) => void
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={node}
      dragListener={false}
      dragControls={controls}
      as="div"
      className="overflow-hidden rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40"
    >
      <HeadingHeader
        entry={node.section}
        controls={controls}
        tone="section"
        count={node.documents.length}
        {...handlers}
      />
      <div className="p-2">
        <GeneratedValue
          value={
            node.documents.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
                <GeneratedText id="m_03bf2c39374f74" />
              </p>
            ) : (
              <DocumentList
                documents={node.documents}
                onReorder={onReorderDocuments}
                {...handlers}
              />
            )
          }
        />
      </div>
    </Reorder.Item>
  )
}

function HeadingHeader({
  entry,
  controls,
  tone,
  count,
  locked,
  focusItemId,
  onMove,
  onRemove,
  onRename,
}: Omit<RowHandlers, 'numbering'> & {
  entry: BookEntry
  controls: ReturnType<typeof useDragControls>
  tone: 'chapter' | 'section'
  count: number
}) {
  const tGenerated = useGeneratedTranslations()
  const isChapter = tone === 'chapter'
  return (
    <header
      className={`flex items-center gap-2 border-b px-2 py-1.5 ${
        isChapter
          ? 'border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-800/50'
          : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      <GeneratedValue
        value={
          !locked ? (
            <button
              type="button"
              aria-label={tGenerated('m_1d3f0ff8d9276a', { value0: entry.title })}
              onPointerDown={(event) => controls.start(event)}
              className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600"
            >
              <GripVertical size={15} />
            </button>
          ) : null
        }
      />
      <GeneratedValue
        value={
          isChapter ? (
            <BookOpen size={14} className="shrink-0 text-slate-400" aria-hidden />
          ) : (
            <Hash size={13} className="shrink-0 text-slate-400" aria-hidden />
          )
        }
      />
      <GeneratedValue
        value={
          locked ? (
            <span
              className={`min-w-0 flex-1 truncate px-1.5 py-1 ${
                isChapter
                  ? 'text-sm font-semibold tracking-wide text-slate-900 uppercase dark:text-slate-100'
                  : 'text-xs font-semibold tracking-[0.1em] text-slate-600 uppercase dark:text-slate-300'
              }`}
            >
              <GeneratedValue value={entry.title} />
            </span>
          ) : (
            <input
              defaultValue={entry.title}
              maxLength={120}
              aria-label={tGenerated('m_1ba9ccc71c6bbd')}
              onBlur={(event) => onRename(entry, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  event.currentTarget.value = entry.title
                  event.currentTarget.blur()
                }
              }}
              className={`min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-slate-200 focus:border-slate-300 focus:bg-white focus:outline-none dark:hover:border-slate-700 dark:focus:bg-slate-950 ${
                isChapter
                  ? 'text-sm font-semibold tracking-wide text-slate-900 uppercase dark:text-slate-100'
                  : 'text-xs font-semibold tracking-[0.1em] text-slate-600 uppercase dark:text-slate-300'
              }`}
            />
          )
        }
      />
      <Badge variant="secondary">
        <GeneratedValue value={count} />
      </Badge>
      <GeneratedValue
        value={
          !locked ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <RowIconButton
                title={tGenerated('m_1ec1460770eaa0')}
                onClick={() => onMove(entry, -1)}
              >
                <ArrowUp size={13} />
              </RowIconButton>
              <RowIconButton
                title={tGenerated('m_14ab8cefda3cf9')}
                onClick={() => onMove(entry, 1)}
              >
                <ArrowDown size={13} />
              </RowIconButton>
              <RowIconButton title={tGenerated('m_11773f3c3f7558')} onClick={() => onRemove(entry)}>
                <Trash2 size={13} className="text-rose-500" />
              </RowIconButton>
            </div>
          ) : null
        }
      />
    </header>
  )
}

function DocumentList({
  documents,
  onReorder,
  locked,
  numbering,
  onMove,
  onRemove,
}: Omit<RowHandlers, 'onRename'> & {
  documents: BookEntry[]
  onReorder: (next: BookEntry[]) => void
}) {
  return (
    <Reorder.Group
      axis="y"
      values={documents}
      onReorder={onReorder}
      as="ul"
      className="divide-y divide-slate-100 dark:divide-slate-800"
    >
      <GeneratedValue
        value={documents.map((entry) => (
          <DocumentRow
            key={entry.itemId}
            entry={entry}
            number={numbering.get(entry.itemId) ?? null}
            locked={locked}
            onMove={onMove}
            onRemove={onRemove}
          />
        ))}
      />
    </Reorder.Group>
  )
}

function DocumentRow({
  entry,
  number,
  locked,
  onMove,
  onRemove,
}: {
  entry: BookEntry
  number: number | null
  locked: boolean
  onMove: (entry: BookEntry, direction: -1 | 1) => void
  onRemove: (entry: BookEntry) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={entry}
      dragListener={false}
      dragControls={controls}
      as="li"
      className="flex items-center justify-between gap-2 rounded bg-white px-1 py-2 transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60"
    >
      <GeneratedValue
        value={
          !locked ? (
            <button
              type="button"
              aria-label={tGenerated('m_0b04b904ce4f9a')}
              onPointerDown={(event) => controls.start(event)}
              className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing dark:text-slate-600 dark:hover:text-slate-400"
            >
              <GripVertical size={14} />
            </button>
          ) : null
        }
      />
      <span className="w-7 shrink-0 text-right font-mono text-xs text-slate-400 dark:text-slate-500">
        <GeneratedValue value={number ? `${number}.` : ''} />
      </span>
      <Link
        href={`/documents/${entry.documentId}`}
        className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900 hover:underline dark:text-slate-100"
      >
        <GeneratedValue value={entry.title} />
      </Link>
      <GeneratedValue
        value={
          entry.status && entry.status !== 'published' ? (
            <Badge variant="warning">
              <GeneratedValue value={entry.status} />
            </Badge>
          ) : null
        }
      />
      <GeneratedValue
        value={
          locked ? (
            entry.pinnedVersion ? (
              <Badge variant="secondary">
                <GeneratedText id="m_1c693e59d64fb2" />
                <GeneratedValue value={entry.pinnedVersion} />
              </Badge>
            ) : (
              <Badge variant="warning">
                <GeneratedText id="m_1b1d4d34556ccf" />
              </Badge>
            )
          ) : (
            <div className="flex shrink-0 items-center gap-0.5">
              <RowIconButton
                title={tGenerated('m_1ec1460770eaa0')}
                onClick={() => onMove(entry, -1)}
              >
                <ArrowUp size={13} />
              </RowIconButton>
              <RowIconButton
                title={tGenerated('m_14ab8cefda3cf9')}
                onClick={() => onMove(entry, 1)}
              >
                <ArrowDown size={13} />
              </RowIconButton>
              <RowIconButton title={tGenerated('m_0d64d4cdef1d99')} onClick={() => onRemove(entry)}>
                <Trash2 size={13} className="text-rose-500" />
              </RowIconButton>
            </div>
          )
        }
      />
    </Reorder.Item>
  )
}

function RowIconButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <button
      type="button"
      title={tGeneratedValue(title)}
      onClick={onClick}
      className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
    >
      <GeneratedValue value={children} />
    </button>
  )
}

/**
 * Staged multi-pick, because a manual is assembled from dozens of documents and
 * one flyout per document is the slowest thing anyone does here.
 */
function AddDocumentsDrawer({
  open,
  onClose,
  excluded,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  excluded: string[]
  onAdd: (documentIds: string[]) => void
}) {
  const tGenerated = useGeneratedTranslations()
  const [picked, setPicked] = React.useState<PickerOption[]>([])

  function close() {
    setPicked([])
    onClose()
  }

  return (
    <Drawer
      open={open}
      onClose={close}
      size="md"
      title={tGenerated('m_120b097f8a83a1')}
      description={tGenerated('m_16a13a44448b12')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            <GeneratedText id="m_112e2e8ecda428" />
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => {
              onAdd(picked.map((option) => option.value))
              setPicked([])
            }}
          >
            <Plus size={14} />
            <GeneratedValue value={tGenerated('m_08e7bf7e603f55', { value0: picked.length })} />
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <RemoteSearchSelect
          lookup="document-book-documents"
          value=""
          onChange={() => {}}
          onOptionChange={(option) => {
            if (!option) return
            setPicked((rows) =>
              rows.some((row) => row.value === option.value) ? rows : [...rows, option],
            )
          }}
          excludedValues={[...excluded, ...picked.map((row) => row.value)]}
          placeholder={tGenerated('m_06dbab14b14732')}
          searchPlaceholder={tGenerated('m_1b287b853289df')}
          sheetTitle={tGenerated('m_120b097f8a83a1')}
          clearable={false}
        />
        <GeneratedValue
          value={
            picked.length === 0 ? (
              <p className="text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_0fc00fdcea3d48" />
              </p>
            ) : (
              <ol className="divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                {picked.map((option, index) => (
                  <li key={option.value} className="flex items-center gap-2 px-2 py-2">
                    <span className="w-6 shrink-0 text-right font-mono text-xs text-slate-400 dark:text-slate-500">
                      <GeneratedValue value={index + 1} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <GeneratedValue value={option.label} />
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPicked((rows) => rows.filter((row) => row.value !== option.value))
                      }
                    >
                      <GeneratedText id="m_1a9d8d971b1edb" />
                    </Button>
                  </li>
                ))}
              </ol>
            )
          }
        />
      </div>
    </Drawer>
  )
}

/** How many entries a heading carries, for the delete confirmation. */
function ownedCount(entries: readonly BookEntry[], itemId: string): number {
  const index = entries.findIndex((entry) => entry.itemId === itemId)
  if (index < 0) return 0
  const kind = entries[index]!.kind
  let owned = 0
  for (let cursor = index + 1; cursor < entries.length; cursor++) {
    const next = entries[cursor]!.kind
    if (next === 'chapter') break
    if (kind === 'section' && next === 'section') break
    owned++
  }
  return owned
}
