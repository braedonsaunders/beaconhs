'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// "Start a hazard assessment" flyout body. The type is the one thing required
// up front — it decides which sections appear and seeds PPE, questions, default
// hazards, and site-default tasks — so this is the pre-create step: pick a type
// and we drop you straight onto the assessment, where the rest (site, project,
// supervisor, job scope, location) is captured inline. Tap a card to start.

import { useState, useTransition } from 'react'
import { Input, cn } from '@beaconhs/ui'
import { Loader2, Search, ShieldAlert } from 'lucide-react'

export type NewAssessmentType = {
  id: string
  name: string
  description: string | null
  style: 'task_based' | 'hazard_based'
  hasPPE: boolean
  hasQuestions: boolean
}

function Chip({ label }: { label: string }) {
  return (
    <span className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-500/10 ring-inset dark:bg-slate-800/50 dark:text-slate-400">
      <GeneratedValue value={label} />
    </span>
  )
}

export function NewAssessmentDrawer({
  types,
  startAction,
}: {
  types: NewAssessmentType[]
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

  function startAssessment(typeId: string) {
    if (pending) return
    setPendingId(typeId)
    const fd = new FormData()
    fd.set('assessmentTypeId', typeId)
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
                placeholder={tGenerated('m_0ce3985d801819')}
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
                    <GeneratedText id="m_0023b6b978b1cb" />
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
                  const seeds = [
                    t.style === 'hazard_based' ? 'Hazard-based' : 'Task-based',
                    t.hasPPE ? 'PPE' : null,
                    t.hasQuestions ? 'Questions' : null,
                  ].filter(Boolean) as string[]
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => startAssessment(t.id)}
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
                                <ShieldAlert size={16} />
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
                          <GeneratedValue
                            value={
                              seeds.length > 0 ? (
                                <span className="mt-1.5 flex flex-wrap items-center gap-1">
                                  <GeneratedValue
                                    value={seeds.map((s) => (
                                      <Chip key={s} label={s} />
                                    ))}
                                  />
                                </span>
                              ) : null
                            }
                          />
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
