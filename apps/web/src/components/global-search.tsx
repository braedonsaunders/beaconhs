'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  BookOpen,
  ListChecks,
  Loader2,
  Radiation,
  Search,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { Input } from '@beaconhs/ui'
import { cn } from '@beaconhs/ui'
import type { SearchGroup, SearchResponse, SearchResultItem } from '@/app/api/search/route'
import { useHydrated } from '@/lib/use-hydrated'

type EntityType = SearchGroup['type']

const ENTITY_META: Record<
  EntityType,
  { label: string; icon: typeof Search; viewAllHref: (q: string) => string }
> = {
  incidents: {
    label: 'Incidents',
    icon: AlertTriangle,
    viewAllHref: (q) => `/incidents?q=${encodeURIComponent(q)}`,
  },
  corrective_actions: {
    label: 'Corrective Actions',
    icon: ListChecks,
    viewAllHref: (q) => `/corrective-actions?q=${encodeURIComponent(q)}`,
  },
  people: {
    label: 'People',
    icon: Users,
    viewAllHref: (q) => `/people?q=${encodeURIComponent(q)}`,
  },
  equipment: {
    label: 'Equipment',
    icon: Wrench,
    viewAllHref: (q) => `/equipment?q=${encodeURIComponent(q)}`,
  },
  documents: {
    label: 'Documents',
    icon: BookOpen,
    viewAllHref: (q) => `/documents?q=${encodeURIComponent(q)}`,
  },
  hazid_assessments: {
    label: 'Hazard Assessments',
    icon: Radiation,
    viewAllHref: (q) => `/hazard-assessments?q=${encodeURIComponent(q)}`,
  },
}

const PER_GROUP_LIMIT = 5

// A `FlatRow` is one keyboard-navigable position inside the dropdown — either
// an item link, or a "view all" link. The list is flattened so up/down arrows
// can cross group boundaries naturally.
type FlatRow =
  | { kind: 'item'; group: EntityType; item: SearchResultItem }
  | { kind: 'viewAll'; group: EntityType; total: number }

function flatten(groups: SearchGroup[]): FlatRow[] {
  const out: FlatRow[] = []
  for (const g of groups) {
    for (const it of g.items) out.push({ kind: 'item', group: g.type, item: it })
    if (g.total > g.items.length && g.items.length >= PER_GROUP_LIMIT) {
      out.push({ kind: 'viewAll', group: g.type, total: g.total })
    }
  }
  return out
}

export function GlobalSearch() {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [groups, setGroups] = useState<SearchGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [portalRect, setPortalRect] = useState<{ top: number; left: number; width: number } | null>(
    null,
  )
  const mounted = useHydrated()

  // Track the input position so the portal'd dropdown sits directly under
  // it. Re-measure on resize + scroll (the latter for any container that
  // might scroll the input out of view).
  useEffect(() => {
    if (!open) return
    function measure() {
      const el = inputRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPortalRect({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, value])

  const flat = useMemo(() => flatten(groups), [groups])

  // Global "/" hotkey to focus the search. Skipped when the user is already
  // typing in an input/textarea so we don't hijack regular typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close the dropdown when the user clicks outside the search container.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  // Debounced fetch. We abort any in-flight request when the user keeps
  // typing so the UI never flashes stale results.
  const runSearch = useCallback(async (q: string) => {
    setActiveIndex(0)
    if (q.trim().length < 2) {
      setGroups([])
      setLoading(false)
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: ctrl.signal,
        cache: 'no-store',
      })
      if (ctrl.signal.aborted) return
      if (!res.ok) {
        setGroups([])
        return
      }
      const body = (await res.json()) as SearchResponse
      if (!ctrl.signal.aborted) setGroups(body.groups ?? [])
    } catch {
      if (!ctrl.signal.aborted) setGroups([])
    } finally {
      // An aborted request must not touch loading/results — its replacement
      // is still in flight and owns the spinner.
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void runSearch(value)
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value, runSearch])

  function navigateToRow(row: FlatRow) {
    setOpen(false)
    setValue('')
    if (row.kind === 'item') router.push(row.item.href as any)
    else router.push(ENTITY_META[row.group].viewAllHref(value) as any)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      // Re-open on first arrow keypress after clicking outside.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') setOpen(true)
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (flat.length === 0) return
      setActiveIndex((i) => (i + 1) % flat.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (flat.length === 0) return
      setActiveIndex((i) => (i - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter') {
      if (flat.length === 0) {
        // Nothing to navigate to — submit a "global incidents search" as a
        // sensible default so the user isn't trapped if results are still
        // loading.
        if (value.trim().length >= 2) {
          setOpen(false)
          router.push(`/incidents?q=${encodeURIComponent(value)}` as any)
        }
        return
      }
      e.preventDefault()
      const row = flat[activeIndex]
      if (row) navigateToRow(row)
    } else if (e.key === 'Escape') {
      if (value) setValue('')
      else setOpen(false)
      inputRef.current?.blur()
    }
  }

  const showDropdown = open && value.trim().length >= 2

  let flatIndex = 0

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-2.5 left-2.5 text-slate-400 dark:text-slate-500"
          size={16}
        />
        <Input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          aria-label="Search incidents, people, equipment, and more"
          placeholder="Search…  (press /)"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="pr-9 pl-9"
        />
        {loading ? (
          <Loader2
            className="absolute top-2.5 right-2.5 animate-spin text-slate-400 dark:text-slate-500"
            size={16}
          />
        ) : value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setValue('')
              inputRef.current?.focus()
            }}
            className="absolute top-2.5 right-2.5 text-slate-400 hover:text-slate-600 dark:text-slate-500"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      {showDropdown && mounted && portalRect && typeof document !== 'undefined'
        ? createPortal(
            <div
              id="global-search-results"
              role="listbox"
              className="fixed z-40 max-h-[70vh] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900"
              style={{
                top: portalRect.top,
                left: portalRect.left,
                width: Math.max(portalRect.width, 448),
              }}
            >
              {flat.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  {loading ? 'Searching…' : `No results for "${value}"`}
                </div>
              ) : (
                <div className="py-1">
                  {groups.map((group) => {
                    const meta = ENTITY_META[group.type]
                    const Icon = meta.icon
                    return (
                      <div key={group.type} className="py-1">
                        <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold tracking-wider text-slate-500 uppercase dark:text-slate-400">
                          <Icon size={11} className="text-slate-400 dark:text-slate-500" />
                          <span>{meta.label}</span>
                          <span className="ml-auto text-slate-400 dark:text-slate-500">
                            {group.total}
                          </span>
                        </div>
                        {group.items.map((it) => {
                          const idx = flatIndex++
                          const active = idx === activeIndex
                          return (
                            <Link
                              key={`${group.type}-${it.id}`}
                              href={it.href as any}
                              onMouseEnter={() => setActiveIndex(idx)}
                              onClick={() => {
                                setOpen(false)
                                setValue('')
                              }}
                              role="option"
                              aria-selected={active}
                              className={cn(
                                'flex items-start gap-2 px-3 py-1.5 text-sm',
                                active
                                  ? 'bg-teal-50 text-teal-900 dark:bg-teal-950/50 dark:text-teal-300'
                                  : 'text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/60',
                              )}
                            >
                              <Icon
                                size={14}
                                className={cn(
                                  'mt-0.5 shrink-0',
                                  active ? 'text-teal-600' : 'text-slate-400 dark:text-slate-500',
                                )}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate">{it.label}</div>
                                {it.sublabel ? (
                                  <div
                                    className={cn(
                                      'truncate text-xs',
                                      active
                                        ? 'text-teal-700 dark:text-teal-300'
                                        : 'text-slate-500 dark:text-slate-400',
                                    )}
                                  >
                                    {it.sublabel}
                                  </div>
                                ) : null}
                              </div>
                            </Link>
                          )
                        })}
                        {group.total > group.items.length && group.items.length >= PER_GROUP_LIMIT
                          ? (() => {
                              const idx = flatIndex++
                              const active = idx === activeIndex
                              return (
                                <Link
                                  href={meta.viewAllHref(value) as any}
                                  onMouseEnter={() => setActiveIndex(idx)}
                                  onClick={() => {
                                    setOpen(false)
                                    setValue('')
                                  }}
                                  role="option"
                                  aria-selected={active}
                                  className={cn(
                                    'flex items-center gap-2 px-3 py-1.5 text-xs',
                                    active
                                      ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300'
                                      : 'text-teal-700 hover:bg-slate-50 dark:text-teal-300 dark:hover:bg-slate-800/60',
                                  )}
                                >
                                  <span className="ml-5">
                                    View all {meta.label.toLowerCase()} matching “{value}”
                                    <span className="ml-1 text-slate-400 dark:text-slate-500">
                                      ({group.total})
                                    </span>
                                  </span>
                                </Link>
                              )
                            })()
                          : null}
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono dark:border-slate-800 dark:bg-slate-900">
                  ↑↓
                </kbd>
                <span className="mx-1">navigate</span>
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono dark:border-slate-800 dark:bg-slate-900">
                  ↵
                </kbd>
                <span className="mx-1">open</span>
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1 font-mono dark:border-slate-800 dark:bg-slate-900">
                  esc
                </kbd>
                <span className="mx-1">close</span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
