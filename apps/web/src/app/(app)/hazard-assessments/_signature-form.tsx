'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Input, Popover } from '@beaconhs/ui'
import { Search, Users, UserRound, HardHat, LoaderCircle } from 'lucide-react'
import { isPickerOptionsResponse, type PickerOption } from '@/lib/picker-options'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

export function CrewSearch({
  assessmentId,
  onAdd,
  pendingValues,
}: {
  assessmentId: string
  onAdd: (option: PickerOption) => void
  pendingValues: readonly string[]
}) {
  const t = useGeneratedValueTranslations()
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<PickerOption[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const pendingKey = pendingValues.join('|')
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          lookup: 'hazard-assessment-crew-candidates',
          contextId: assessmentId,
          q: query,
        })
        const response = await fetch(`/api/picker-options?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('Could not load crew')
        const result: unknown = await response.json()
        if (!isPickerOptionsResponse(result)) throw new Error('Could not load crew')
        if (controller.signal.aborted) return
        setOptions(result.options)
        setHasMore(result.hasMore)
        setError(false)
      } catch {
        if (!controller.signal.aborted) {
          setError(true)
          setOptions([])
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 150)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [assessmentId, query, open, pendingKey])
  const choices = options.filter((o) => !pendingValues.includes(o.value))
  if (query.trim())
    choices.push({ value: `external:${query.trim()}`, label: query.trim(), hint: 'Visitor' })
  function choose(option: PickerOption) {
    onAdd(option)
    setQuery('')
    setOptions([])
    setHighlight(0)
    setLoading(true)
    input.current?.focus()
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      matchTriggerWidth
      trigger={
        <div
          className="relative min-w-0"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
          }}
        >
          <Search
            size={16}
            className="pointer-events-none absolute top-3.5 left-3 text-slate-400"
          />
          <Input
            ref={input}
            role="combobox"
            aria-label={t('Add crew')}
            placeholder={t('Add crew')}
            aria-expanded={open}
            aria-controls={id}
            aria-autocomplete="list"
            aria-activedescendant={open && choices[highlight] ? `${id}-${highlight}` : undefined}
            autoComplete="off"
            className="h-11 pl-9"
            value={query}
            onFocus={() => {
              setOpen(true)
              setLoading(true)
            }}
            onChange={(e) => {
              setQuery(e.target.value.slice(0, 100))
              setOpen(true)
              setOptions([])
              setLoading(true)
              setHighlight(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setOpen(true)
                setHighlight((i) => Math.min(i + 1, choices.length - 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlight((i) => Math.max(0, i - 1))
              }
              if (e.key === 'Enter' && open && choices[highlight]) {
                e.preventDefault()
                choose(choices[highlight]!)
              }
            }}
          />
        </div>
      }
    >
      <div className="max-h-64 overflow-y-auto">
        <ul id={id} role="listbox" aria-label={t('Add crew')}>
          {choices.map((option, index) => {
            const Icon =
              option.value.startsWith('person:') || option.value.startsWith('external:')
                ? UserRound
                : option.value.startsWith('group:')
                  ? Users
                  : HardHat
            return (
              <li
                key={option.value}
                role="option"
                id={`${id}-${index}`}
                aria-selected={index === highlight}
              >
                <button
                  type="button"
                  className={`flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${index === highlight ? 'bg-slate-50 dark:bg-slate-800' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <Icon size={16} className="shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {!option.value.startsWith('person:') ? (
                    <span className="shrink-0 text-xs text-slate-500">
                      <GeneratedValue value={option.hint} />
                    </span>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
        {loading ? (
          <div role="status" className="flex justify-center p-3">
            <LoaderCircle size={16} className="animate-spin" aria-label={t('Loading…')} />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="p-3 text-sm text-red-600">
            <GeneratedValue value="Could not load crew. Type again to retry." />
          </p>
        ) : null}
        {!loading && !error && !choices.length ? (
          <p className="p-3 text-sm text-slate-500">
            <GeneratedValue value="No matching people, groups or crews." />
          </p>
        ) : null}
        {hasMore && !loading ? (
          <p className="px-3 py-2 text-xs text-slate-500">
            <GeneratedValue value="More results exist. Refine your search." />
          </p>
        ) : null}
      </div>
    </Popover>
  )
}
