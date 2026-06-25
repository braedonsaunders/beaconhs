'use client'

// The auto-generated folder tree — the headline rediscovery surface. Groups
// entries by Date / Site / Topic / Person (rebuilt from data, never foldered by
// hand), with quick filters, On-This-Day memories, and the activity heatmap.

import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, ChevronRight, Plus, Search, Sparkles, X } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import {
  GROUP_BY_OPTIONS,
  type GroupBy,
  type JournalFilters,
  type TreeNode,
  type WorkspaceData,
} from './_types'
import { Heatmap } from './_heatmap'

function pathTo(nodes: TreeNode[], id: string | null, acc: string[] = []): string[] | null {
  if (!id) return null
  for (const n of nodes) {
    if (n.entryId === id) return acc
    if (n.children) {
      const found = pathTo(n.children, id, [...acc, n.key])
      if (found) return found
    }
  }
  return null
}

function seedExpanded(tree: TreeNode[], selectedId: string | null): Set<string> {
  const set = new Set<string>()
  // Expand the most-recent top branch and its first child (e.g. this year → this month).
  const first = tree[0]
  if (first?.children) {
    set.add(first.key)
    if (first.children[0]?.children) set.add(first.children[0].key)
  }
  const path = pathTo(tree, selectedId)
  if (path) path.forEach((k) => set.add(k))
  return set
}

export function SidebarTree({
  data,
  groupBy,
  filters,
  selectedId,
  loading,
  authorMode = false,
  onGroupByChange,
  onFiltersChange,
  onSelect,
  onNewEntry,
  onPickDate,
}: {
  data: WorkspaceData
  groupBy: GroupBy
  filters: JournalFilters
  selectedId: string | null
  loading?: boolean
  /** Records "Open full entry" flyout: browsing another author — hide create. */
  authorMode?: boolean
  onGroupByChange: (g: GroupBy) => void
  onFiltersChange: (f: Partial<JournalFilters>) => void
  onSelect: (entryId: string) => void
  onNewEntry: () => void
  onPickDate: (dateISO: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => seedExpanded(data.tree, selectedId))
  const [q, setQ] = useState(filters.q ?? '')
  const firstKey = data.tree[0]?.key

  // Reseed expansion when the grouping (and thus tree shape) changes.
  useEffect(() => {
    setExpanded(seedExpanded(data.tree, selectedId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy, firstKey])

  // Always reveal the path to the selected entry.
  useEffect(() => {
    const path = pathTo(data.tree, selectedId)
    if (path) setExpanded((prev) => new Set([...prev, ...path]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Debounce search → filters.
  const qRef = useRef(q)
  qRef.current = q
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.q ?? '') !== qRef.current) onFiltersChange({ q: qRef.current || undefined })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // The workspace is self-scoped, so "All" already means all of the user's own
  // journals — a separate "Mine" chip would be redundant.
  const activeQuick = filters.status === 'draft' ? 'drafts' : 'all'

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="space-y-2.5 border-b border-slate-200 px-3 pt-3 pb-3 dark:border-slate-800">
        {authorMode ? null : (
          <button
            type="button"
            onClick={onNewEntry}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-teal-800"
          >
            <Plus size={16} /> New entry
          </button>
        )}

        <div className="relative">
          <Search
            size={14}
            className="absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search journals…"
            className="h-8 w-full rounded-md border border-slate-300 bg-white pr-7 pl-8 text-sm transition-shadow outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          {q ? (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300"
            >
              <X size={13} />
            </button>
          ) : null}
        </div>

        {/* Quick filters */}
        <div className="flex flex-wrap gap-1">
          <Chip
            active={activeQuick === 'all'}
            onClick={() => onFiltersChange({ mine: undefined, status: undefined })}
          >
            All {data.counts.total ? <Count>{data.counts.total}</Count> : null}
          </Chip>
          <Chip
            active={activeQuick === 'drafts'}
            onClick={() => onFiltersChange({ status: 'draft', mine: undefined })}
          >
            Drafts {data.counts.drafts ? <Count>{data.counts.drafts}</Count> : null}
          </Chip>
        </div>

        {/* Group by */}
        <div className="flex items-center gap-0.5 rounded-md bg-slate-100 p-0.5 dark:bg-slate-800">
          {GROUP_BY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onGroupByChange(opt.value)}
              className={cn(
                'flex-1 rounded px-1.5 py-1 text-xs font-medium transition-colors',
                groupBy === opt.value
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scroll body: on-this-day + tree */}
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {data.onThisDay.length > 0 ? (
          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2 dark:border-amber-500/25 dark:bg-amber-500/10">
            <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300">
              <CalendarClock size={12} /> On this day
            </div>
            {data.onThisDay.slice(0, 3).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelect(m.id)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-amber-900 hover:bg-amber-100/70 dark:text-amber-200 dark:hover:bg-amber-500/15"
              >
                <span className="shrink-0 rounded bg-amber-200/70 px-1 text-[10px] font-medium dark:bg-amber-500/25">
                  {m.yearsAgo}y
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{m.authorName ?? m.title ?? 'Journal'}</span>
                  {m.snippet ? (
                    <span className="text-amber-700/80 dark:text-amber-300/80"> — {m.snippet}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-1.5 px-2 py-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-6 animate-pulse rounded bg-slate-100 dark:bg-slate-800"
                style={{ width: `${90 - i * 8}%` }}
              />
            ))}
          </div>
        ) : data.tree.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-slate-400 dark:text-slate-500">
            {authorMode ? (
              'No journals for this person.'
            ) : (
              <>
                No entries. Use{' '}
                <span className="font-medium text-slate-600 dark:text-slate-300">New entry</span> to
                start today’s journal.
              </>
            )}
          </div>
        ) : (
          <div className="space-y-px">
            {data.tree.map((node) => (
              <TreeRow
                key={node.key}
                node={node}
                depth={0}
                expanded={expanded}
                selectedId={selectedId}
                onToggle={toggle}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>

      {/* Heatmap footer */}
      <div className="border-t border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase dark:text-slate-500">
          <Sparkles size={11} /> Activity
        </div>
        <Heatmap data={data.heatmap} onPick={onPickDate} />
      </div>

      {/* Admin (Records / Tags / Compliance) lives in the Journals → Manage hub,
          reached from the workspace's top sub-nav — not crammed in here. */}
    </div>
  )
}

function TreeRow({
  node,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  selectedId: string | null
  onToggle: (key: string) => void
  onSelect: (id: string) => void
}) {
  const isBranch = !!node.children && node.children.length > 0
  const isOpen = expanded.has(node.key)
  const isLeaf = !!node.entryId
  const selected = isLeaf && node.entryId === selectedId
  const pad = 6 + depth * 12

  if (isLeaf) {
    return (
      <button
        type="button"
        onClick={() => onSelect(node.entryId!)}
        style={{ paddingLeft: pad }}
        className={cn(
          'group flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-sm transition-colors',
          selected
            ? 'bg-teal-50 text-teal-900 dark:bg-teal-500/15 dark:text-teal-200'
            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
        )}
      >
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            node.draft
              ? 'border border-slate-400 bg-white dark:border-slate-500 dark:bg-slate-900'
              : 'bg-teal-500',
          )}
        />
        <span className="truncate">{node.label}</span>
      </button>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => onToggle(node.key)}
        style={{ paddingLeft: pad }}
        className="flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <ChevronRight
          size={14}
          className={cn(
            'shrink-0 text-slate-400 transition-transform dark:text-slate-500',
            isOpen && 'rotate-90',
          )}
        />
        <span className="truncate">{node.label}</span>
        <span className="ml-auto shrink-0 text-[11px] text-slate-400 tabular-nums dark:text-slate-500">
          {node.count}
        </span>
      </button>
      {isBranch && isOpen ? (
        <div className="space-y-px">
          {node.children!.map((child) => (
            <TreeRow
              key={child.key}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Chip({
  active,
  danger,
  onClick,
  children,
}: {
  active: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
        active
          ? danger
            ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
            : 'bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-200'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
      )}
    >
      {children}
    </button>
  )
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-black/5 px-1 text-[10px] tabular-nums dark:bg-white/10">
      {children}
    </span>
  )
}
