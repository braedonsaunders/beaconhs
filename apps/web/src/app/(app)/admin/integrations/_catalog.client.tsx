'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useGeneratedTranslations } from '@/i18n/generated'

// The "Browse integrations" catalog — a searchable, filterable grid that scales
// to any number of integrations (instead of an ever-growing sidebar list). Each
// card adds its integration via the createConnection server action.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpRight,
  Building2,
  Check,
  Database,
  FileSpreadsheet,
  Plug,
  Plus,
  PlugZap,
  Search,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { Button, Input, cn } from '@beaconhs/ui'
import { DirectionPill } from './_pills'
import { createConnection } from './_actions'

export type CatalogItem = {
  key: string
  addValue: string // 'database' (inbound) | 'outbound:training-sql-export'
  name: string
  description: string
  dir: 'in' | 'out'
  iconKey: string
  detail: string
  added: boolean
  addedHref?: string
}

const ICONS: Record<string, LucideIcon> = {
  database: Database,
  'building-2': Building2,
  'file-spreadsheet': FileSpreadsheet,
  'plug-zap': PlugZap,
  upload: Upload,
}

type Filter = 'all' | 'in' | 'out'

export function IntegrationCatalog({ items }: { items: CatalogItem[] }) {
  const tGenerated = useGeneratedTranslations()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return items.filter(
      (i) =>
        (filter === 'all' || i.dir === filter) &&
        (term === '' || `${i.name} ${i.description} ${i.detail}`.toLowerCase().includes(term)),
    )
  }, [items, q, filter])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search
            size={15}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tGenerated('m_1a00545fb31f8a')}
            className="pl-8"
            aria-label={tGenerated('m_0347ea10372c49')}
          />
        </div>
        <Segmented value={filter} onChange={setFilter} />
      </div>

      <GeneratedValue
        value={
          filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <GeneratedText id="m_110b0c5bd18b0c" />
              <GeneratedValue value={q.trim() ? ` “${q.trim()}”` : ''} />.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <GeneratedValue
                value={filtered.map((item) => (
                  <CatalogCard key={item.key} item={item} />
                ))}
              />
            </div>
          )
        }
      />
    </div>
  )
}

function Segmented({ value, onChange }: { value: Filter; onChange: (v: Filter) => void }) {
  const opts: [Filter, string][] = [
    ['all', 'All'],
    ['in', 'Sync in'],
    ['out', 'Push out'],
  ]
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-sm dark:border-slate-800 dark:bg-slate-800/40">
      <GeneratedValue
        value={opts.map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              'rounded-md px-3 py-1 font-medium transition',
              value === v
                ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
            )}
          >
            <GeneratedValue value={label} />
          </button>
        ))}
      />
    </div>
  )
}

function CatalogCard({ item }: { item: CatalogItem }) {
  const Icon = ICONS[item.iconKey] ?? Plug
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-50 text-slate-500 ring-1 ring-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedValue value={item.name} />
          </p>
          <div className="mt-0.5">
            <DirectionPill dir={item.dir} />
          </div>
        </div>
      </div>
      <p className="mt-2.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
        <GeneratedValue value={item.description} />
      </p>
      <p className="mt-auto pt-2 text-[11px] text-slate-400 dark:text-slate-500">
        <GeneratedValue value={item.detail} />
      </p>
      <div className="mt-3 flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
        <GeneratedValue
          value={
            item.added && item.addedHref ? (
              <Link
                href={item.addedHref}
                className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300"
              >
                <Check size={14} /> <GeneratedText id="m_0f6d53fa6dd14f" />{' '}
                <ArrowUpRight size={13} />
              </Link>
            ) : (
              <form action={createConnection}>
                <input type="hidden" name="connectorKey" value={item.addValue} />
                <Button type="submit" size="sm" variant="outline">
                  <Plus size={14} /> <GeneratedText id="m_16c8592e5020a4" />
                </Button>
              </form>
            )
          }
        />
      </div>
    </div>
  )
}
