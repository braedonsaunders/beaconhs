'use client'

// World-class tag editor: an editable chip set with a typeahead. It surfaces the
// tenant's existing tags (frequency-ordered) so the taxonomy stays tidy, offers
// an inline "create" affordance for brand-new tags, and is fully keyboard
// driven — ↑/↓ to navigate, ↵ or comma to add, ⌫ to remove the last chip. Chips
// animate in/out, and pasting a comma/newline list adds many at once.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CornerDownLeft, Plus, X } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { tagSwatch } from './_tag-colors'
import type { TagSuggestion } from './_types'

const MAX_SUGGESTIONS = 8

export function TagEditor({
  tags,
  suggestions,
  editable,
  onChange,
  emptyHint = 'Add a tag…',
}: {
  tags: string[]
  suggestions: TagSuggestion[]
  editable: boolean
  onChange: (tags: string[]) => void
  /** Placeholder shown when there are no tags yet. */
  emptyHint?: string
}) {
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listId = useId()

  const query = input.trim().toLowerCase()

  const colorByName = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const s of suggestions) m.set(s.name, s.color)
    return m
  }, [suggestions])

  // Existing tags not yet applied, filtered by what's typed. Server order is
  // most-used-first, so the most relevant suggestions surface at the top.
  const matches = useMemo(() => {
    const taken = new Set(tags)
    return suggestions
      .filter((s) => !taken.has(s.name) && (query === '' || s.name.includes(query)))
      .slice(0, MAX_SUGGESTIONS)
  }, [suggestions, tags, query])

  // Only offer "create" when the typed value isn't already a chip or a match.
  const matchNames = matches.map((m) => m.name)
  const canCreate = query !== '' && !tags.includes(query) && !matchNames.includes(query)
  const options = canCreate ? [...matchNames, query] : matchNames
  const hasMenu = open && editable && options.length > 0

  // Keep the active option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (highlight < 0) return
    document.getElementById(`${listId}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, listId])

  function commit(raw: string) {
    const t = raw.trim().toLowerCase()
    if (!t) return
    if (!tags.includes(t)) onChange([...tags, t])
    setInput('')
    setHighlight(-1)
  }

  function remove(tag: string) {
    onChange(tags.filter((t) => t !== tag))
    inputRef.current?.focus()
  }

  function onChangeInput(v: string) {
    setInput(v)
    setOpen(true)
    setHighlight(v.trim() ? 0 : -1)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setHighlight((h) => (options.length ? (h + 1) % options.length : -1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => (options.length ? (h <= 0 ? options.length - 1 : h - 1) : -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlight >= 0 && options[highlight]) commit(options[highlight])
      else if (query) commit(query)
    } else if (e.key === ',' || (e.key === 'Tab' && query)) {
      // Comma always commits; Tab commits only when there's text (else focus moves on).
      e.preventDefault()
      commit(highlight >= 0 && options[highlight] ? options[highlight] : query)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      setHighlight(-1)
    } else if (e.key === 'Backspace' && input === '' && tags.length) {
      e.preventDefault()
      remove(tags[tags.length - 1]!)
    }
  }

  // Pasting "a, b, c" (commas or newlines) adds them all at once.
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    if (!/[,\n]/.test(text)) return
    e.preventDefault()
    const parts = text
      .split(/[,\n]/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean)
    if (!parts.length) return
    const next = [...tags]
    for (const p of parts) if (!next.includes(p)) next.push(p)
    onChange(next)
    setInput('')
  }

  return (
    <div className="relative">
      <div
        onMouseDown={(e) => {
          // Clicking blank space within the box focuses the input.
          if (e.target === e.currentTarget) {
            e.preventDefault()
            inputRef.current?.focus()
            setOpen(true)
          }
        }}
        className={cn(
          'flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-xl border px-2 py-1.5 shadow-sm transition',
          editable
            ? 'cursor-text border-slate-300 bg-white focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/25'
            : 'border-slate-200 bg-slate-50/60',
        )}
      >
        <AnimatePresence initial={false}>
          {tags.map((t) => {
            const sw = tagSwatch(colorByName.get(t) ?? null)
            return (
              <motion.span
                key={t}
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full py-1 pl-2.5 pr-1 text-xs font-medium ring-1 ring-inset',
                  sw.chip,
                )}
              >
                <span className="max-w-[14rem] truncate">{t}</span>
                {editable ? (
                  <button
                    type="button"
                    aria-label={`Remove ${t}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => remove(t)}
                    className={cn(
                      'grid h-4 w-4 place-items-center rounded-full opacity-60 transition hover:opacity-100',
                      sw.remove,
                    )}
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </motion.span>
            )
          })}
        </AnimatePresence>

        {editable ? (
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => onChangeInput(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onFocus={() => {
              if (blurTimer.current) clearTimeout(blurTimer.current)
              setOpen(true)
            }}
            onBlur={() => {
              blurTimer.current = setTimeout(() => {
                if (query) commit(query)
                setOpen(false)
                setHighlight(-1)
              }, 120)
            }}
            placeholder={tags.length ? 'Add a tag…' : emptyHint}
            role="combobox"
            aria-expanded={hasMenu}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={highlight >= 0 ? `${listId}-opt-${highlight}` : undefined}
            // border-0 / focus:ring-0: this input is intentionally chromeless — the
            // rounded container is the visible frame. Without these it inherits the
            // @tailwindcss/forms base border (1px, square) and its own focus ring.
            className="h-7 min-w-[9rem] flex-1 border-0 bg-transparent p-0 px-1 text-sm text-slate-800 outline-none focus:ring-0 placeholder:text-slate-400"
          />
        ) : tags.length === 0 ? (
          <span className="px-1 text-sm text-slate-400">No tags</span>
        ) : null}
      </div>

      <AnimatePresence>
        {hasMenu ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-full z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <ul id={listId} role="listbox" className="max-h-60 overflow-auto p-1">
              {matches.map((m, i) => (
                <Option
                  key={m.name}
                  id={`${listId}-opt-${i}`}
                  active={i === highlight}
                  onHover={() => setHighlight(i)}
                  onPick={() => commit(m.name)}
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', tagSwatch(m.color).dot)} />
                  <span className="min-w-0 flex-1 truncate">{renderMatch(m.name, query)}</span>
                </Option>
              ))}
              {canCreate ? (
                <Option
                  id={`${listId}-opt-${matches.length}`}
                  active={highlight === matches.length}
                  onHover={() => setHighlight(matches.length)}
                  onPick={() => commit(query)}
                >
                  <Plus size={13} className="shrink-0 text-teal-600" />
                  <span className="min-w-0 flex-1 truncate text-slate-600">
                    Create <span className="font-semibold text-teal-700">{query}</span>
                  </span>
                </Option>
              ) : null}
            </ul>
            <div className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
              <CornerDownLeft size={11} /> to add
              <span className="text-slate-300">·</span>
              <span className="font-medium text-slate-400">↑↓</span> to navigate
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function Option({
  id,
  active,
  onHover,
  onPick,
  children,
}: {
  id: string
  active: boolean
  onHover: () => void
  onPick: () => void
  children: React.ReactNode
}) {
  return (
    <li id={id} role="option" aria-selected={active}>
      <button
        type="button"
        tabIndex={-1}
        onMouseEnter={onHover}
        // mousedown (not click) so the input doesn't blur before the pick lands.
        onMouseDown={(e) => {
          e.preventDefault()
          onPick()
        }}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
          active ? 'bg-teal-50 text-teal-900' : 'text-slate-700 hover:bg-slate-50',
        )}
      >
        {children}
      </button>
    </li>
  )
}

/** Bold the typed substring within a suggestion label. */
function renderMatch(label: string, query: string) {
  if (!query) return label
  const idx = label.indexOf(query)
  if (idx === -1) return label
  return (
    <>
      {label.slice(0, idx)}
      <span className="font-semibold text-slate-900">{label.slice(idx, idx + query.length)}</span>
      {label.slice(idx + query.length)}
    </>
  )
}
