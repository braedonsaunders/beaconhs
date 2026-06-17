'use client'

// Dual-list member picker. Left column = candidate people, right column =
// currently-selected members. Search filters both lists, arrow buttons move
// selected entries, and Save submits the final right-column IDs back to the
// server action.
//
// This is the canonical UX from the legacy
// resources/views/pages/people/groups/view.blade.php transferred to React.

import { useMemo, useState, useTransition } from 'react'
import { ChevronRight, ChevronLeft, ChevronsRight, ChevronsLeft, Search } from 'lucide-react'
import { Button, Input, Label } from '@beaconhs/ui'

export type Candidate = {
  id: string
  firstName: string
  lastName: string
  employeeNo: string | null
}

export function MemberPicker({
  entityId,
  entityIdField,
  candidates,
  initialMemberIds,
  action,
  emptyMembersLabel = 'No members',
}: {
  entityId: string
  entityIdField: 'groupId' | 'titleId'
  candidates: Candidate[]
  initialMemberIds: string[]
  action: (formData: FormData) => Promise<void>
  emptyMembersLabel?: string
}) {
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(
    () => new Set(initialMemberIds),
  )
  const [leftHighlights, setLeftHighlights] = useState<Set<string>>(new Set())
  const [rightHighlights, setRightHighlights] = useState<Set<string>>(new Set())
  const [leftQuery, setLeftQuery] = useState('')
  const [rightQuery, setRightQuery] = useState('')
  const [pending, startTransition] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const candidatesById = useMemo(() => {
    const m = new Map<string, Candidate>()
    for (const c of candidates) m.set(c.id, c)
    return m
  }, [candidates])

  const left = useMemo(
    () =>
      candidates
        .filter((c) => !selectedMembers.has(c.id))
        .filter((c) => matches(c, leftQuery))
        .sort(compareByName),
    [candidates, selectedMembers, leftQuery],
  )

  const right = useMemo(
    () =>
      Array.from(selectedMembers)
        .map((id) => candidatesById.get(id))
        .filter((c): c is Candidate => Boolean(c))
        .filter((c) => matches(c, rightQuery))
        .sort(compareByName),
    [selectedMembers, candidatesById, rightQuery],
  )

  function moveSelected(ids: Set<string>, dir: 'right' | 'left'): void {
    setSelectedMembers((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (dir === 'right') next.add(id)
        else next.delete(id)
      }
      return next
    })
    if (dir === 'right') setLeftHighlights(new Set())
    else setRightHighlights(new Set())
  }

  function moveAll(dir: 'right' | 'left'): void {
    if (dir === 'right') {
      setSelectedMembers((prev) => {
        const next = new Set(prev)
        for (const c of left) next.add(c.id)
        return next
      })
      setLeftHighlights(new Set())
    } else {
      setSelectedMembers((prev) => {
        const next = new Set(prev)
        for (const c of right) next.delete(c.id)
        return next
      })
      setRightHighlights(new Set())
    }
  }

  function save(): void {
    const fd = new FormData()
    fd.set(entityIdField, entityId)
    for (const id of selectedMembers) fd.append('personIds', id)
    startTransition(async () => {
      await action(fd)
      setSavedAt(Date.now())
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_56px_1fr]">
        <ListColumn
          label={`People (${left.length})`}
          query={leftQuery}
          onQueryChange={setLeftQuery}
          items={left}
          highlighted={leftHighlights}
          onToggle={(id, e) => toggleHighlight(setLeftHighlights, leftHighlights, left, id, e)}
        />
        <div className="flex flex-col items-center justify-center gap-2 self-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => moveAll('right')}
            aria-label="Move all right"
            title="Move all right"
          >
            <ChevronsRight size={14} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => moveSelected(leftHighlights, 'right')}
            aria-label="Move selected right"
            title="Move selected right"
            disabled={leftHighlights.size === 0}
          >
            <ChevronRight size={14} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => moveSelected(rightHighlights, 'left')}
            aria-label="Move selected left"
            title="Move selected left"
            disabled={rightHighlights.size === 0}
          >
            <ChevronLeft size={14} />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => moveAll('left')}
            aria-label="Move all left"
            title="Move all left"
          >
            <ChevronsLeft size={14} />
          </Button>
        </div>
        <ListColumn
          label={`Members (${right.length})`}
          query={rightQuery}
          onQueryChange={setRightQuery}
          items={right}
          highlighted={rightHighlights}
          onToggle={(id, e) => toggleHighlight(setRightHighlights, rightHighlights, right, id, e)}
          emptyLabel={emptyMembersLabel}
        />
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-3">
        {savedAt ? (
          <span className="text-xs text-emerald-700">Saved {formatRelative(savedAt)}</span>
        ) : null}
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : `Save (${selectedMembers.size} members)`}
        </Button>
      </div>
    </div>
  )
}

function ListColumn({
  label,
  query,
  onQueryChange,
  items,
  highlighted,
  onToggle,
  emptyLabel = 'No matching entries',
}: {
  label: string
  query: string
  onQueryChange: (v: string) => void
  items: Candidate[]
  highlighted: Set<string>
  onToggle: (id: string, ev: React.MouseEvent) => void
  emptyLabel?: string
}) {
  return (
    <div className="flex h-[420px] flex-col rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-2">
        <Label className="text-[11px] tracking-wide text-slate-500 uppercase">{label}</Label>
        <div className="relative mt-1">
          <Search
            size={12}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-slate-400"
          />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Filter…"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1 text-xs">
        {items.length === 0 ? (
          <div className="p-3 text-center text-slate-400">{emptyLabel}</div>
        ) : (
          <ul>
            {items.map((c) => {
              const isOn = highlighted.has(c.id)
              return (
                <li
                  key={c.id}
                  onClick={(e) => onToggle(c.id, e)}
                  className={`cursor-pointer rounded px-2 py-1 ${
                    isOn ? 'bg-teal-100 text-teal-900' : 'hover:bg-slate-50'
                  }`}
                >
                  <span className="font-medium">
                    {c.lastName}, {c.firstName}
                  </span>
                  {c.employeeNo ? (
                    <span className="ml-1 text-slate-400">· {c.employeeNo}</span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function matches(c: Candidate, q: string): boolean {
  if (!q) return true
  const t = q.toLowerCase()
  return (
    c.firstName.toLowerCase().includes(t) ||
    c.lastName.toLowerCase().includes(t) ||
    (c.employeeNo?.toLowerCase().includes(t) ?? false)
  )
}

function compareByName(a: Candidate, b: Candidate): number {
  const ln = a.lastName.localeCompare(b.lastName)
  if (ln !== 0) return ln
  return a.firstName.localeCompare(b.firstName)
}

function toggleHighlight(
  setHigh: (updater: (prev: Set<string>) => Set<string>) => void,
  current: Set<string>,
  visible: Candidate[],
  id: string,
  ev: React.MouseEvent,
): void {
  if (ev.shiftKey && current.size > 0) {
    // Range select
    const lastId = Array.from(current).pop()!
    const visibleIds = visible.map((v) => v.id)
    const a = visibleIds.indexOf(lastId)
    const b = visibleIds.indexOf(id)
    if (a >= 0 && b >= 0) {
      const [start, end] = a < b ? [a, b] : [b, a]
      setHigh(() => new Set(visibleIds.slice(start, end + 1)))
      return
    }
  }
  if (ev.metaKey || ev.ctrlKey) {
    setHigh((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    return
  }
  setHigh(() => new Set([id]))
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 5000) return 'now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  return `${Math.floor(diff / 60_000)}m ago`
}
