'use client'

// Composes one entry's full editing surface: header (date · status · save state ·
// AI · submit), a full-width metadata/controls strip, AI summary, the rich
// editor, and photos. Owns autosave (debounced) and the per-entry mutations.
// Journals have no individual title — the date is the identifier.

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  Check,
  CloudUpload,
  FileText,
  Loader2,
  Mail,
  MoreHorizontal,
  NotebookPen,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@beaconhs/ui'
import { confirmDialog } from '@/lib/confirm'
import { deleteEntry, emailEntry, setEntryTags, submitEntry, updateEntry } from './_actions'
import { JournalEditor } from './_editor'
import { MetadataBar } from './_metadata-bar'
import { Photos } from './_photos'
import { formatDate, isToday, statusMeta, textToHtml } from './_format'
import type { EntryPatch, JournalEntryDetail, JournalOption, TagSuggestion } from './_types'

type SaveState = 'idle' | 'saving' | 'saved'

export function EditorPane({
  entry,
  sites,
  people,
  tagSuggestions,
  aiEnabled,
  onMutated,
  onDeleted,
  onLocalPatch,
  onBrowse,
}: {
  entry: JournalEntryDetail
  sites: JournalOption[]
  people: JournalOption[]
  tagSuggestions: TagSuggestion[]
  aiEnabled: boolean
  onMutated: () => void
  onDeleted: () => void
  onLocalPatch: (patch: Partial<JournalEntryDetail>) => void
  /** Open the entries drawer (mobile only — desktop shows the tree inline). */
  onBrowse: () => void
}) {
  const editable = !entry.locked
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [submitting, startSubmit] = useTransition()
  const [menuOpen, setMenuOpen] = useState(false)

  const pending = useRef<EntryPatch>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The editor emits one onChange as it hydrates a loaded entry; that's not a
  // user edit. We capture it as a baseline and skip it so opening an entry never
  // autosaves (which, for migrated entries whose HTML lived in body_text, would
  // otherwise overwrite body_text with empty and destroy the content).
  const bodyBaseline = useRef<string | null>(null)

  useEffect(() => {
    setSaveState('saved')
    pending.current = {}
    bodyBaseline.current = null
    if (timer.current) clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id])

  function flush(): Promise<void> {
    if (timer.current) clearTimeout(timer.current)
    const patch = pending.current
    pending.current = {}
    if (Object.keys(patch).length === 0) return Promise.resolve()
    setSaveState('saving')
    return updateEntry({ id: entry.id, patch }).then((r) => {
      setSaveState(r.ok ? 'saved' : 'idle')
      if (!r.ok && 'error' in r) toast.error(r.error)
    })
  }

  function queue(patch: EntryPatch, delay = 700) {
    Object.assign(pending.current, patch)
    setSaveState('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, delay)
  }

  function onMeta(
    patch: Parameters<typeof MetadataBar>[0]['onPatch'] extends (p: infer P) => void ? P : never,
  ) {
    onLocalPatch(patch as Partial<JournalEntryDetail>)
    queue(patch, 250)
  }

  function onTags(tags: string[]) {
    onLocalPatch({ tags })
    setEntryTags({ id: entry.id, tags }).then(() => onMutated())
  }

  function onBody(html: string) {
    // Skip the editor's first emission after an entry loads (hydration echo);
    // only genuine subsequent edits autosave.
    if (bodyBaseline.current === null) {
      bodyBaseline.current = html
      return
    }
    if (html === bodyBaseline.current) return
    bodyBaseline.current = html
    queue({ bodyHtml: html })
  }

  function submit() {
    startSubmit(async () => {
      // Persist the last debounced edits BEFORE submitting — the on-submit
      // flows / recap email / AI read the body from the DB.
      await flush()
      const r = await submitEntry(entry.id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      onLocalPatch({ status: 'submitted' })
      toast.success('Journal submitted.')
      onMutated()
    })
  }

  function emailRecap() {
    setMenuOpen(false)
    startSubmit(async () => {
      const r = await emailEntry(entry.id)
      if (!r.ok) toast.error(r.error)
      else toast.success(`Emailed ${r.sent} recipient${r.sent === 1 ? '' : 's'}.`)
    })
  }

  async function del() {
    setMenuOpen(false)
    if (
      !(await confirmDialog({
        message: 'Delete this journal entry? This cannot be undone.',
        tone: 'danger',
      }))
    )
      return
    startSubmit(async () => {
      const r = await deleteEntry(entry.id)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Entry deleted.')
      onDeleted()
    })
  }

  const status = statusMeta(entry.status)

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-3 py-2.5 sm:gap-3 sm:px-6 dark:border-slate-800">
        {/* Mobile: open the entries drawer (replaces the old separate top bar). */}
        <button
          type="button"
          onClick={onBrowse}
          aria-label="Browse journals"
          className="-ml-1 grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-500 hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <NotebookPen size={18} />
        </button>
        <AuthorAvatar name={entry.authorName} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
              {entry.authorName ?? 'Unassigned'}
            </h1>
            <span
              className={cn(
                'rounded-full px-2 py-px text-[10px] font-medium ring-1 ring-inset',
                status.className,
              )}
            >
              {status.label}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            <span className="font-medium whitespace-nowrap text-slate-600 dark:text-slate-300">
              {isToday(entry.entryDate) ? 'Today' : formatDate(entry.entryDate)}
            </span>
            <span className="hidden font-mono sm:inline">· {entry.reference}</span>
            <SaveBadge state={saveState} />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {entry.status === 'draft' ? (
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-700 px-3 text-xs font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-60"
            >
              {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              Submit
            </button>
          ) : null}

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
              className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <MoreHorizontal size={15} />
            </button>
            {menuOpen ? (
              <div className="absolute top-9 right-0 z-30 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                <a
                  href={`/journals/${entry.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                >
                  <FileText size={14} /> PDF
                </a>
                <button
                  type="button"
                  onClick={emailRecap}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/60"
                >
                  <Mail size={14} /> Email recap
                </button>
                <button
                  type="button"
                  onClick={del}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/15"
                >
                  <Trash2 size={14} /> Delete entry
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
        {/* Full-width controls */}
        <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-4 sm:px-6 dark:border-slate-800 dark:bg-slate-800/40">
          <MetadataBar
            entry={entry}
            sites={sites}
            people={people}
            tagSuggestions={tagSuggestions}
            editable={editable}
            onPatch={onMeta}
            onTagsChange={onTags}
          />
        </div>

        {/* AI summary — full width */}
        {entry.summary ? (
          <div className="border-b border-slate-100 px-4 py-3 sm:px-6 dark:border-slate-800">
            <div className="flex gap-2 rounded-lg border border-teal-100 bg-teal-50/50 p-3 text-sm text-slate-600 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-slate-300">
              <Sparkles size={15} className="mt-0.5 shrink-0 text-teal-600" />
              <p className="leading-relaxed">{entry.summary}</p>
            </div>
          </div>
        ) : null}

        {/* Editor — internally centered for readable line length */}
        <JournalEditor
          key={entry.id}
          // Migrated entries stored their HTML in bodyText (bodyHtml empty), so
          // fall back to it; otherwise the editor renders blank.
          initialHtml={entry.bodyHtml || textToHtml(entry.bodyText)}
          editable={editable}
          aiEnabled={aiEnabled}
          onChange={(html) => onBody(html)}
        />

        {/* Photos */}
        <div className="mx-auto max-w-3xl px-4 pb-12 sm:px-6">
          <Photos
            entryId={entry.id}
            photos={entry.photos}
            editable={editable}
            aiEnabled={aiEnabled}
            onChange={onMutated}
          />
        </div>
      </div>
    </div>
  )
}

const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-pink-500',
]

/** Initials avatar for the journal's author (who the entry belongs to). */
function AuthorAvatar({ name }: { name: string | null }) {
  const label = name?.trim() || 'Unassigned'
  const parts = label.split(/\s+/)
  const init =
    (
      (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')
    ).toUpperCase() || '?'
  let h = 0
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0
  const color = name ? AVATAR_COLORS[h % AVATAR_COLORS.length] : 'bg-slate-300 dark:bg-slate-600'
  return (
    <span
      title={label}
      className={cn(
        'grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold text-white',
        color,
      )}
    >
      {init}
    </span>
  )
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'saving')
    return (
      <span className="inline-flex items-center gap-1 text-amber-600">
        <CloudUpload size={11} /> Saving…
      </span>
    )
  if (state === 'saved')
    return (
      <span className="inline-flex items-center gap-1 text-teal-600">
        <Check size={11} /> Saved
      </span>
    )
  return null
}
