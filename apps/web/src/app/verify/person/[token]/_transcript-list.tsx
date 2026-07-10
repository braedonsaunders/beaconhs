'use client'

// Searchable, filterable transcript list for the public badge page. Filtering
// is instant and client-side — a gate check is a one-handed phone interaction,
// so no reloads, no URL round-trips. Every row opens the actual rendered
// wallet card for that credential.

import { useMemo, useState } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { formatDay, type Standing } from './_format'

export type TranscriptItem = {
  key: string
  kind: 'training' | 'skill'
  name: string
  code: string | null
  completedOn: string
  expiresOn: string | null
  standing: Standing
  href: string
}

const STANDING_STYLE: Record<Standing, { chip: string; label: string }> = {
  valid: { chip: 'bg-emerald-100 text-emerald-800', label: 'Valid' },
  expiring: { chip: 'bg-amber-100 text-amber-800', label: 'Expiring soon' },
  expired: { chip: 'bg-red-100 text-red-700', label: 'Expired' },
}

const FILTERS: { value: Standing | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'valid', label: 'Valid' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'expired', label: 'Expired' },
]

export function StandingChip({ standing }: { standing: Standing }) {
  const s = STANDING_STYLE[standing]
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.chip}`}
    >
      {s.label}
    </span>
  )
}

function ItemCard({ item }: { item: TranscriptItem }) {
  return (
    <a
      href={item.href}
      className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors active:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{item.name}</div>
          {item.code ? (
            <div className="mt-0.5 font-mono text-[11px] text-slate-400">{item.code}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StandingChip standing={item.standing} />
          <ChevronRight size={16} className="text-slate-300" />
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
        <span>
          {item.kind === 'skill' ? 'Granted' : 'Completed'}{' '}
          <span className="font-medium text-slate-700">{formatDay(item.completedOn)}</span>
        </span>
        <span>
          {item.expiresOn ? (
            <>
              Expires{' '}
              <span className="font-medium text-slate-700">{formatDay(item.expiresOn)}</span>
            </>
          ) : (
            'Does not expire'
          )}
        </span>
      </div>
    </a>
  )
}

function Section({ title, items }: { title: string; items: TranscriptItem[] }) {
  if (!items.length) return null
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      {items.map((item) => (
        <ItemCard key={item.key} item={item} />
      ))}
    </section>
  )
}

export function TranscriptList({ items }: { items: TranscriptItem[] }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Standing | 'all'>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      if (filter !== 'all' && item.standing !== filter) return false
      if (!q) return true
      return item.name.toLowerCase().includes(q) || (item.code ?? '').toLowerCase().includes(q)
    })
  }, [items, query, filter])

  const current = filtered.filter((i) => i.kind === 'training' && i.standing !== 'expired')
  const skills = filtered.filter((i) => i.kind === 'skill')
  const expired = filtered.filter((i) => i.kind === 'training' && i.standing === 'expired')

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search training and skills"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-3 pl-9 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
          />
        </div>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => {
            const count =
              f.value === 'all' ? items.length : items.filter((i) => i.standing === f.value).length
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`flex-1 rounded-full border px-2 py-1.5 text-xs font-semibold transition-colors ${
                  filter === f.value
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {f.label} <span className="opacity-60">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500 shadow-sm">
          No credentials match.
        </div>
      ) : (
        <>
          <Section title="Current training" items={current} />
          <Section title="Skills & qualifications" items={skills} />
          <Section title="Expired" items={expired} />
        </>
      )}
    </div>
  )
}
