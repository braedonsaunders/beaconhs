'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// "Start an inspection" flyout body. A type is the one thing required up front
// (criteria materialise from it), so this is the pre-create step: pick a type
// and we drop you straight onto the record, where the rest — date, site,
// foreman, notes — is captured inline. Tap a card to start.

import { useState, useTransition } from 'react'
import { Input, cn } from '@beaconhs/ui'
import { ClipboardCheck, Loader2, Search } from 'lucide-react'

export type NewInspectionType = {
  id: string
  name: string
  description: string | null
  criteriaCount: number
  requiresCustomerSignature: boolean
}

function Chip({ label, tone }: { label: string; tone?: 'sky' }) {
  const tones = {
    sky: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950/40 dark:text-sky-300',
    default:
      'bg-slate-50 text-slate-600 ring-slate-500/10 dark:bg-slate-800/50 dark:text-slate-400',
  }
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
        tones[tone ?? 'default'],
      )}
    >
      <GeneratedValue value={label} />
    </span>
  )
}

export function NewInspectionDrawer({
  types,
  startAction,
}: {
  types: NewInspectionType[]
  startAction: (formData: FormData) => Promise<void>
}) {
  const tGenerated = useGeneratedTranslations()
  const [query, setQuery] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const filtered = query.trim()
    ? types.filter((t) => {
        const q = query.toLowerCase()
        return t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)
      })
    : types

  function startInspection(typeId: string) {
    if (pending) return
    setPendingId(typeId)
    const fd = new FormData()
    fd.set('typeId', typeId)
    start(async () => {
      await startAction(fd)
    })
  }

  return (
    <div className="space-y-3">
      <GeneratedValue
        value={
          types.length > 6 ? (
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tGenerated('m_061693dcc701ec')}
                className="pl-9"
              />
            </div>
          ) : null
        }
      />

      <GeneratedValue
        value={
          filtered.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
              <GeneratedValue
                value={
                  types.length === 0 ? (
                    <GeneratedText id="m_0fc202e78b9a36" />
                  ) : (
                    <GeneratedText id="m_0868004961d682" />
                  )
                }
              />
            </p>
          ) : (
            <ul className="space-y-2">
              <GeneratedValue
                value={filtered.map((t) => {
                  const isPending = pendingId === t.id
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => startInspection(t.id)}
                        className={cn(
                          'group flex w-full items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition-all hover:border-teal-400 hover:shadow-sm disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-700',
                          isPending && 'border-teal-500 ring-2 ring-teal-500/30',
                        )}
                      >
                        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                          <GeneratedValue
                            value={
                              isPending ? (
                                <Loader2 size={16} className="animate-spin" />
                              ) : (
                                <ClipboardCheck size={16} />
                              )
                            }
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-slate-900 dark:text-slate-100">
                            <GeneratedValue value={t.name} />
                          </span>
                          <GeneratedValue
                            value={
                              t.description ? (
                                <span className="mt-0.5 line-clamp-2 block text-xs text-slate-500 dark:text-slate-400">
                                  <GeneratedValue value={t.description} />
                                </span>
                              ) : null
                            }
                          />
                          <span className="mt-1.5 flex flex-wrap items-center gap-1">
                            <Chip
                              label={tGenerated('m_1be183b75969a0', {
                                value0: t.criteriaCount,
                                value1: t.criteriaCount === 1 ? '' : 's',
                              })}
                            />
                            <GeneratedValue
                              value={
                                t.requiresCustomerSignature ? (
                                  <Chip label={tGenerated('m_0c0bc02db58371')} tone="sky" />
                                ) : null
                              }
                            />
                          </span>
                        </span>
                        <span className="self-center text-xs font-medium text-teal-700 opacity-0 transition-opacity group-hover:opacity-100 dark:text-teal-400">
                          <GeneratedValue
                            value={
                              isPending ? (
                                <GeneratedText id="m_160f03bb73b218" />
                              ) : (
                                <GeneratedText id="m_0de51911bb80e2" />
                              )
                            }
                          />
                        </span>
                      </button>
                    </li>
                  )
                })}
              />
            </ul>
          )
        }
      />
    </div>
  )
}
