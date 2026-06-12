'use client'

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
  positive: 'bg-teal-100 text-teal-800 ring-teal-600/20',
  steady: 'bg-teal-50 text-teal-700 ring-teal-600/15',
  mixed: 'bg-amber-100 text-amber-800 ring-amber-600/20',
  concerned: 'bg-orange-100 text-orange-800 ring-orange-600/20',
  negative: 'bg-rose-100 text-rose-800 ring-rose-600/20',
}
const SEV_TONE: Record<string, string> = {
  high: 'bg-rose-100 text-rose-700 ring-rose-600/20',
  medium: 'bg-amber-100 text-amber-700 ring-amber-600/20',
  low: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

export function JournalAnalysisWidget({ aiEnabled }: { aiEnabled: boolean }) {
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
      toast.error('AI isn’t configured. Add an API key under Admin → AI.')
      return
    }
    start(async () => {
      const r = await runJournalAnalysis(d)
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setResult({ analysis: r.analysis, entryCount: r.entryCount, days: r.days })
    })
  }

  const a = result?.analysis

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-gradient-to-r from-teal-50/70 to-white px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          <Sparkles size={15} className="text-teal-600" /> AI journal analysis
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex overflow-hidden rounded-md border border-slate-200">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => run(p.days)}
                disabled={pending}
                className={cn(
                  'px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60',
                  days === p.days
                    ? 'bg-teal-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => run(days)}
            disabled={pending}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-teal-600 px-2.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {pending ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {a ? 'Re-run' : 'Analyse'}
          </button>
        </div>
      </div>

      {/* body */}
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {pending ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
            <Loader2 size={15} className="animate-spin" /> Reading the journals…
          </div>
        ) : !aiEnabled ? (
          <Empty>
            AI is not configured.{' '}
            <Link href={'/admin/ai' as never} className="font-medium text-teal-700 underline">
              Configure a provider
            </Link>{' '}
            to surface sentiment, issues and recommended actions.
          </Empty>
        ) : !a ? (
          <Empty>
            Analyse recent field journals to surface <strong>sentiment</strong>,{' '}
            <strong>recurring issues</strong> and <strong>recommended corrective actions</strong>{' '}
            with suggested owners.
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
                title={a.sentiment.rationale}
              >
                {a.sentiment.label}
              </span>
              <p className="text-sm leading-relaxed text-slate-600">{a.summary}</p>
            </div>

            {/* themes */}
            {a.themes.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {a.themes.map((t, i) => (
                  <span
                    key={`${t.label}-${i}`}
                    className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800 ring-1 ring-teal-600/15 ring-inset"
                  >
                    {t.label}
                    <span className="rounded-full bg-white/70 px-1 text-[10px] tabular-nums">
                      {t.count}
                    </span>
                  </span>
                ))}
              </div>
            ) : null}

            {/* surfaced issues */}
            {a.issues.length > 0 ? (
              <Section
                icon={<AlertTriangle size={13} className="text-amber-500" />}
                title="Surfaced issues"
              >
                <ul className="space-y-1.5">
                  {a.issues.map((it, i) => (
                    <li key={i} className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset',
                            SEV_TONE[it.severity],
                          )}
                        >
                          {it.severity}
                        </span>
                        <span className="text-xs font-semibold text-slate-800">{it.title}</span>
                        {it.site ? (
                          <span className="ml-auto shrink-0 text-[10px] text-slate-400">
                            {it.site}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{it.detail}</p>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {/* recommended corrective actions */}
            {a.actions.length > 0 ? (
              <Section
                icon={<ClipboardCheck size={13} className="text-teal-600" />}
                title="Recommended corrective actions"
              >
                <ul className="space-y-1.5">
                  {a.actions.map((ac, i) => (
                    <li key={i} className="rounded-lg border border-teal-100 bg-teal-50/40 p-2">
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            'mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ring-1 ring-inset',
                            SEV_TONE[ac.priority],
                          )}
                        >
                          {ac.priority}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-800">{ac.action}</p>
                          <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                            {ac.rationale}
                          </p>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className="text-[10px] tracking-wide text-slate-400 uppercase">
                              Owner
                            </span>
                            <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200 ring-inset">
                              {ac.owner}
                            </span>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <Link
                  href={'/corrective-actions' as never}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:underline"
                >
                  Open Corrective Actions →
                </Link>
              </Section>
            ) : null}

            <p className="pt-1 text-[10px] text-slate-400">
              Based on {result?.entryCount} entries · last {result?.days} days · AI-generated,
              review before acting.
            </p>
          </div>
        )}
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
        {icon} {title}
      </div>
      {children}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs leading-relaxed text-slate-400">
      <p className="max-w-xs">{children}</p>
    </div>
  )
}
