'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { GeneratedText } from '@/i18n/generated'

// The "AI journal analysis" Insights widget. Reads recent field journals on
// demand and surfaces sentiment, recurring themes, the issues raised, and
// recommended corrective actions routed to an owner. Degrades gracefully when
// AI is unconfigured.

import { useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, ClipboardCheck, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@beaconhs/ui'
import type { JournalAnalysis } from '@beaconhs/ai'
import { runJournalAnalysis } from './_ai-actions'

const PERIODS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
]

const SENTIMENT_TONE: Record<string, string> = {
  positive: 'bg-teal-100 text-teal-800 ring-teal-600/20 dark:bg-teal-500/15 dark:text-teal-300',
  steady: 'bg-teal-50 text-teal-700 ring-teal-600/15 dark:bg-teal-500/10 dark:text-teal-300',
  mixed: 'bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300',
  concerned:
    'bg-orange-100 text-orange-800 ring-orange-600/20 dark:bg-orange-500/15 dark:text-orange-300',
  negative: 'bg-rose-100 text-rose-800 ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-300',
}
const SEV_TONE: Record<string, string> = {
  high: 'bg-rose-100 text-rose-700 ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-300',
  medium: 'bg-amber-100 text-amber-700 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300',
  low: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-700 dark:text-slate-300',
}

export function JournalAnalysisWidget({ aiEnabled }: { aiEnabled: boolean }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [days, setDays] = useState(30)
  const [result, setResult] = useState<{
    analysis: JournalAnalysis
    entryCount: number
    days: number
  } | null>(null)
  const [pending, start] = useTransition()

  function run(d: number) {
    setDays(d)
    if (!aiEnabled) {
      toast.error(tGenerated('m_00e97569b011f9'))
      return
    }
    start(async () => {
      const r = await runJournalAnalysis(d)
      if (!r.ok) {
        toast.error(tGeneratedValue(r.error))
        return
      }
      setResult({ analysis: r.analysis, entryCount: r.entryCount, days: r.days })
    })
  }

  const a = result?.analysis

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-teal-50/70 to-white px-3 py-2 dark:border-slate-800 dark:from-teal-500/5 dark:to-slate-900">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Sparkles size={15} className="text-teal-600 dark:text-teal-400" />{' '}
          <GeneratedText id="m_18f07617cdda62" />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
            <GeneratedValue
              value={PERIODS.map((p) => (
                <button
                  key={p.days}
                  type="button"
                  onClick={() => run(p.days)}
                  disabled={pending}
                  className={cn(
                    'px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60',
                    days === p.days
                      ? 'bg-teal-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
                  )}
                >
                  <GeneratedValue value={p.label} />
                </button>
              ))}
            />
          </div>
          <button
            type="button"
            onClick={() => run(days)}
            disabled={pending}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-teal-600 px-2.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            <GeneratedValue
              value={
                pending ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />
              }
            />
            <GeneratedValue
              value={
                a ? (
                  <GeneratedText id="m_1e21782483902a" />
                ) : (
                  <GeneratedText id="m_13184d6f3629b6" />
                )
              }
            />
          </button>
        </div>
      </div>

      {/* body */}
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
        <GeneratedValue
          value={
            pending ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
                <Loader2 size={15} className="animate-spin" />{' '}
                <GeneratedText id="m_151bdf2a7987a9" />
              </div>
            ) : !aiEnabled ? (
              <Empty>
                <GeneratedText id="m_1970319e53aa16" />
                <GeneratedValue value={' '} />
                <Link href={'/admin/ai' as never} className="font-medium text-teal-700 underline">
                  <GeneratedText id="m_07604a360d0e6f" />
                </Link>
                <GeneratedValue value={' '} />
                <GeneratedText id="m_1ea7b304608f38" />
              </Empty>
            ) : !a ? (
              <Empty>
                <GeneratedText id="m_04ad20f8a203c6" />{' '}
                <strong>
                  <GeneratedText id="m_01aeb389580f99" />
                </strong>
                ,<GeneratedValue value={' '} />
                <strong>
                  <GeneratedText id="m_1e46b62631fc9c" />
                </strong>{' '}
                <GeneratedText id="m_0237e52728336d" />{' '}
                <strong>
                  <GeneratedText id="m_123d9ac5d211b3" />
                </strong>
                <GeneratedValue value={' '} />
                <GeneratedText id="m_040218a3214039" />
              </Empty>
            ) : (
              <div className="space-y-3">
                {/* sentiment + summary */}
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ring-1 ring-inset',
                      SENTIMENT_TONE[a.sentiment.label] ?? SENTIMENT_TONE.mixed,
                    )}
                    title={tGeneratedValue(a.sentiment.rationale)}
                  >
                    <GeneratedValue value={a.sentiment.label} />
                  </span>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    <GeneratedValue value={a.summary} />
                  </p>
                </div>

                {/* themes */}
                <GeneratedValue
                  value={
                    a.themes.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        <GeneratedValue
                          value={a.themes.map((t, i) => (
                            <span
                              key={`${t.label}-${i}`}
                              className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800 ring-1 ring-teal-600/15 ring-inset"
                            >
                              <GeneratedValue value={t.label} />
                              <span className="rounded-full bg-white/70 px-1 text-[10px] tabular-nums">
                                <GeneratedValue value={t.count} />
                              </span>
                            </span>
                          ))}
                        />
                      </div>
                    ) : null
                  }
                />

                {/* surfaced issues */}
                <GeneratedValue
                  value={
                    a.issues.length > 0 ? (
                      <Section
                        icon={<AlertTriangle size={13} className="text-amber-500" />}
                        title={tGenerated('m_1f3cc724fe4aa5')}
                      >
                        <ul className="space-y-1.5">
                          <GeneratedValue
                            value={a.issues.map((it, i) => (
                              <li
                                key={i}
                                className="rounded-lg border border-slate-100 bg-slate-50/50 p-2 dark:border-slate-800 dark:bg-slate-800/40"
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset',
                                      SEV_TONE[it.severity],
                                    )}
                                  >
                                    <GeneratedValue value={it.severity} />
                                  </span>
                                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                    <GeneratedValue value={it.title} />
                                  </span>
                                  <GeneratedValue
                                    value={
                                      it.site ? (
                                        <span className="ml-auto shrink-0 text-[10px] text-slate-400">
                                          {it.site}
                                        </span>
                                      ) : null
                                    }
                                  />
                                </div>
                                <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                                  <GeneratedValue value={it.detail} />
                                </p>
                              </li>
                            ))}
                          />
                        </ul>
                      </Section>
                    ) : null
                  }
                />

                {/* recommended corrective actions */}
                <GeneratedValue
                  value={
                    a.actions.length > 0 ? (
                      <Section
                        icon={<ClipboardCheck size={13} className="text-teal-600" />}
                        title={tGenerated('m_0badb533a3927f')}
                      >
                        <ul className="space-y-1.5">
                          <GeneratedValue
                            value={a.actions.map((ac, i) => (
                              <li
                                key={i}
                                className="rounded-lg border border-teal-100 bg-teal-50/40 p-2 dark:border-teal-500/20 dark:bg-teal-500/5"
                              >
                                <div className="flex items-start gap-2">
                                  <span
                                    className={cn(
                                      'mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset',
                                      SEV_TONE[ac.priority],
                                    )}
                                  >
                                    <GeneratedValue value={ac.priority} />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                      <GeneratedValue value={ac.action} />
                                    </p>
                                    <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                                      <GeneratedValue value={ac.rationale} />
                                    </p>
                                    <div className="mt-1 flex items-center gap-1.5">
                                      <span className="text-[10px] tracking-wide text-slate-400 uppercase">
                                        <GeneratedText id="m_09e0cae12d3f44" />
                                      </span>
                                      <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200 ring-inset">
                                        <GeneratedValue value={ac.owner} />
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </li>
                            ))}
                          />
                        </ul>
                        <Link
                          href={'/corrective-actions' as never}
                          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:underline"
                        >
                          <GeneratedText id="m_15a21ef796eba8" />
                        </Link>
                      </Section>
                    ) : null
                  }
                />

                <p className="pt-1 text-[10px] text-slate-400">
                  <GeneratedText id="m_087e1d02654a6e" />{' '}
                  <GeneratedValue value={result?.entryCount} />{' '}
                  <GeneratedText id="m_13fa230451e20c" /> <GeneratedValue value={result?.days} />{' '}
                  <GeneratedText id="m_07dbd8251e8a8b" />
                </p>
              </div>
            )
          }
        />
      </div>
    </div>
  )
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        <GeneratedValue value={icon} /> <GeneratedValue value={title} />
      </div>
      <GeneratedValue value={children} />
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs leading-relaxed text-slate-400">
      <p className="max-w-xs">
        <GeneratedValue value={children} />
      </p>
    </div>
  )
}
