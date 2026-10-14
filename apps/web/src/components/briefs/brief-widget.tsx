'use client'

// An AI brief as a dashboard widget: the brief's latest delivered run, in the
// compact view, with a link to the full brief.

import Link from 'next/link'
import { ArrowUpRight, Sparkles } from 'lucide-react'
import type { BriefEvidence, BriefResult } from '@beaconhs/db/schema'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { BriefView } from './brief-view'

export type BriefWidgetData = {
  id: string
  name: string
  run: {
    id: string
    windowLabel: string
    departmentName: string | null
    result: BriefResult
    evidence: BriefEvidence
  } | null
}

export function BriefWidget({ data }: { data: BriefWidgetData }) {
  const href = data.run
    ? `/reports/briefs/${data.id}/runs/${data.run.id}`
    : `/reports/briefs/${data.id}`
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            <Sparkles size={13} className="shrink-0 text-teal-600" />
            <GeneratedValue value={data.name} />
          </p>
          {data.run ? (
            <p className="truncate text-xs text-slate-500">
              <GeneratedValue
                value={`${data.run.windowLabel}${data.run.departmentName ? ` · ${data.run.departmentName}` : ''}`}
              />
            </p>
          ) : null}
        </div>
        <Link
          href={href as never}
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-teal-700 hover:underline dark:text-teal-300"
        >
          <GeneratedText id="m_107ab58c3c38bc" /> <ArrowUpRight size={12} />
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {data.run ? (
          <BriefView result={data.run.result} evidence={data.run.evidence} compact />
        ) : (
          <p className="text-sm text-slate-500">
            <GeneratedText id="m_15a86f72caaa76" />
          </p>
        )}
      </div>
    </div>
  )
}
