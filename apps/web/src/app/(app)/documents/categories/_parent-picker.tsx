'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { Check, ChevronDown, Loader2, Search } from 'lucide-react'
import { Input, Popover, cn } from '@beaconhs/ui'
import { searchCategoryParents, type CategoryParentOption } from './_actions'

export function CategoryParentPicker({
  current,
  initialOptions,
  excludeId,
  form,
  id,
  ariaLabel = 'Parent category',
}: {
  current: CategoryParentOption | null
  initialOptions: CategoryParentOption[]
  excludeId?: string
  form?: string
  id?: string
  ariaLabel?: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState(initialOptions)
  const [selected, setSelected] = useState<CategoryParentOption | null>(current)
  const [loadError, setLoadError] = useState(false)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    let active = true
    const handle = window.setTimeout(() => {
      startTransition(async () => {
        try {
          const found = await searchCategoryParents(query, excludeId)
          if (active) {
            setOptions(found)
            setLoadError(false)
          }
        } catch {
          if (active) setLoadError(true)
        }
      })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(handle)
    }
  }, [excludeId, open, query])

  const visibleOptions = useMemo(() => {
    const merged = selected && selected.id !== excludeId ? [selected, ...options] : options
    return merged.filter(
      (option, index) =>
        option.id !== excludeId &&
        merged.findIndex((candidate) => candidate.id === option.id) === index,
    )
  }, [excludeId, options, selected])

  function choose(option: CategoryParentOption | null) {
    setSelected(option)
    setOpen(false)
    setQuery('')
  }

  return (
    <>
      <input type="hidden" name="parentId" value={selected?.id ?? ''} form={form} />
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] p-2"
        trigger={
          <button
            id={id}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={tGeneratedValue(ariaLabel)}
            onClick={() => setOpen((value) => !value)}
            className="flex h-9 w-full min-w-40 items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-left text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <span className={cn('truncate', !selected && 'text-slate-500 dark:text-slate-400')}>
              <GeneratedValue value={selected?.name ?? <GeneratedText id="m_11b75c428eea23" />} />
            </span>
            <ChevronDown size={14} className="shrink-0 text-slate-400" />
          </button>
        }
      >
        <div className="relative mb-2">
          <Search
            size={15}
            className="pointer-events-none absolute top-2.5 left-2.5 text-slate-400"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tGenerated('m_036733dd6a8590')}
            aria-label={tGenerated('m_13c4235756f043')}
            className="h-9 pr-8 pl-8"
            autoFocus
          />
          <GeneratedValue
            value={
              pending ? (
                <Loader2
                  size={14}
                  className="absolute top-2.5 right-2.5 animate-spin text-slate-400"
                />
              ) : null
            }
          />
        </div>
        <div
          role="listbox"
          aria-label={tGeneratedValue(ariaLabel)}
          className="max-h-64 overflow-auto"
        >
          <button
            type="button"
            role="option"
            aria-selected={!selected}
            onClick={() => choose(null)}
            className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Check size={14} className={cn(selected && 'text-transparent')} />
            <GeneratedText id="m_11b75c428eea23" />
          </button>
          <GeneratedValue
            value={visibleOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={selected?.id === option.id}
                onClick={() => choose(option)}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Check size={14} className={cn(selected?.id !== option.id && 'text-transparent')} />
                <span className="truncate">
                  <GeneratedValue value={option.name} />
                </span>
              </button>
            ))}
          />
          <GeneratedValue
            value={
              !pending && visibleOptions.length === 0 ? (
                <p className="px-2 py-5 text-center text-sm text-slate-500">
                  <GeneratedText id="m_10a03d3101e449" />
                </p>
              ) : null
            }
          />
          <GeneratedValue
            value={
              loadError ? (
                <p className="px-2 py-3 text-sm text-red-600 dark:text-red-400">
                  <GeneratedText id="m_1a336c9e730c25" />
                </p>
              ) : null
            }
          />
        </div>
        <p className="mt-2 border-t border-slate-100 px-2 pt-2 text-xs text-slate-500 dark:border-slate-800">
          <GeneratedText id="m_1e648693380935" />
        </p>
      </Popover>
    </>
  )
}
