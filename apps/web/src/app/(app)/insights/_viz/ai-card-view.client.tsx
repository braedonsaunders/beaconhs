'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// Renders an AI card: the stored instruction + an on-demand "Analyse" button
// that runs the card's BHQL dataset through the tenant model and shows the
// structured result. On-demand (not on every dashboard load) so LLM cost is
// paid only when asked.

import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { runInsightAiCard, type InsightAiResult } from '../_ai-actions'

const TONE: Record<string, string> = {
  positive: 'border-green-400 bg-green-50/50 dark:border-green-500/40 dark:bg-green-500/5',
  neutral: 'border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40',
  watch: 'border-amber-400 bg-amber-50/50 dark:border-amber-500/40 dark:bg-amber-500/5',
  negative: 'border-rose-400 bg-rose-50/50 dark:border-rose-500/40 dark:bg-rose-500/5',
}

export function AiCardView({ cardId, prompt }: { cardId: string; prompt?: string | null }) {
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<InsightAiResult | null>(null)

  async function run() {
    setLoading(true)
    try {
      setRes(await runInsightAiCard(cardId))
    } catch {
      setRes({ ok: false, error: 'Something went wrong running the analysis.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs text-slate-500 dark:text-slate-400">
          <GeneratedValue value={prompt?.trim() || <GeneratedText id="m_15d9c181a62904" />} />
        </p>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="no-drag inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-teal-700 disabled:opacity-60"
        >
          <GeneratedValue
            value={
              loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />
            }
          />
          <GeneratedValue
            value={
              loading ? (
                <GeneratedText id="m_0207380a3d39ec" />
              ) : res ? (
                <GeneratedText id="m_0881757ac515d3" />
              ) : (
                <GeneratedText id="m_13184d6f3629b6" />
              )
            }
          />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <GeneratedValue
          value={
            !res && !loading ? (
              <div className="grid h-full place-items-center text-center text-xs text-slate-400 dark:text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles size={13} /> <GeneratedText id="m_0468821d2ecbc1" />
                </span>
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            res && !res.ok ? (
              <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/5 dark:text-amber-400">
                <GeneratedValue value={res.error} />
              </div>
            ) : null
          }
        />

        <GeneratedValue
          value={
            res && res.ok ? (
              <div className="space-y-2.5">
                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                  <GeneratedValue value={res.analysis.summary} />
                </p>
                <ul className="space-y-1.5">
                  <GeneratedValue
                    value={res.analysis.points.map((p, i) => (
                      <li
                        key={i}
                        className={`rounded-lg border-l-2 px-3 py-2 ${TONE[p.tone] ?? TONE.neutral}`}
                      >
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                          <GeneratedValue value={p.title} />
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-300">
                          <GeneratedValue value={p.detail} />
                        </div>
                      </li>
                    ))}
                  />
                </ul>
                <p className="pt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  <GeneratedText id="m_19cc31ccb3f179" />{' '}
                  <GeneratedValue value={res.rowCount.toLocaleString()} />{' '}
                  <GeneratedText id="m_028ec4c46538e4" />
                </p>
              </div>
            ) : null
          }
        />
      </div>
    </div>
  )
}
