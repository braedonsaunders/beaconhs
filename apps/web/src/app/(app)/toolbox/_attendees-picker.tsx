'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Badge, Input } from '@beaconhs/ui'

export type PickerPerson = {
  id: string
  firstName: string
  lastName: string
  jobTitle: string | null
}

/**
 * Multi-pick people for attendees. Renders hidden inputs named
 * `attendeePersonIds[]` so the parent <form> picks them up.
 */
export function AttendeesPicker({
  available,
  defaultSelectedIds = [],
  inputName = 'attendeePersonIds',
}: {
  available: PickerPerson[]
  defaultSelectedIds?: string[]
  inputName?: string
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelectedIds))
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return available
    return available.filter((p) =>
      `${p.lastName} ${p.firstName} ${p.jobTitle ?? ''}`.toLowerCase().includes(q),
    )
  }, [available, query])

  const selectedList = useMemo(
    () => available.filter((p) => selected.has(p.id)),
    [available, selected],
  )

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-3">
      {selectedList.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedList.map((p) => (
            <Badge
              key={p.id}
              variant="secondary"
              className="flex cursor-pointer items-center gap-1.5 pr-1"
              onClick={() => toggle(p.id)}
            >
              {p.firstName} {p.lastName}
              <X size={10} className="opacity-60" />
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No attendees selected yet.</p>
      )}

      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people…"
          className="pl-8"
        />
      </div>

      <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            No matching people.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {filtered.map((p) => {
              const isPicked = selected.has(p.id)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                      isPicked
                        ? 'bg-teal-50 text-teal-900'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">
                        {p.lastName}, {p.firstName}
                      </div>
                      {p.jobTitle ? (
                        <div className="text-xs text-slate-500">{p.jobTitle}</div>
                      ) : null}
                    </div>
                    {isPicked ? (
                      <span className="text-xs font-semibold text-teal-700">Selected</span>
                    ) : (
                      <span className="text-xs text-slate-400">Add</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {Array.from(selected).map((id) => (
        <input key={id} type="hidden" name={inputName} value={id} />
      ))}
    </div>
  )
}
