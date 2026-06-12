'use client'

import { useState } from 'react'
import { Input } from '@beaconhs/ui'

// Multi-pick checkbox list backed by a hidden comma-separated text input
// the parent form can read. Used for hazard sets, type-PPE multi-add, etc.
export function MultiPicker({
  name,
  options,
  defaultSelected = [],
  placeholder = 'Search…',
}: {
  name: string
  options: { value: string; label: string; sublabel?: string }[]
  defaultSelected?: string[]
  placeholder?: string
}) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<string[]>(defaultSelected)

  const filtered = options.filter((o) =>
    filter.trim().length === 0
      ? true
      : o.label.toLowerCase().includes(filter.toLowerCase()) ||
        (o.sublabel ?? '').toLowerCase().includes(filter.toLowerCase()),
  )

  function toggle(v: string) {
    setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]))
  }

  return (
    <div className="space-y-2">
      <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={placeholder} />
      <input type="hidden" name={name} value={selected.join(',')} />
      <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-slate-500">No matches.</p>
        ) : (
          filtered.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50 dark:bg-slate-800/50"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 dark:border-slate-700"
              />
              <div className="min-w-0">
                <div className="truncate">{o.label}</div>
                {o.sublabel ? (
                  <div className="truncate text-xs text-slate-500">{o.sublabel}</div>
                ) : null}
              </div>
            </label>
          ))
        )}
      </div>
      <div className="text-xs text-slate-500">{selected.length} selected</div>
    </div>
  )
}
