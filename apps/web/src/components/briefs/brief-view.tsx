// Renders a brief run's structured result: notice, headline, computed figures,
// summary, sections with citation links to the source records, what changed,
// follow-ups, and the cited sources. Presentational only — safe on the server
// (run archive, studio preview) and inside client widgets (Insights, dashboard).

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Badge, cn } from '@beaconhs/ui'
import type { BriefEvidence, BriefResult } from '@beaconhs/db/schema'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'

function Citations({ refs, evidence }: { refs: string[]; evidence: BriefEvidence }) {
  if (refs.length === 0) return null
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {refs.map((ref) => {
        const record = evidence.records.find((r) => r.ref === ref)
        return record ? (
          <Link
            key={ref}
            href={record.path as never}
            title={record.title}
            className="rounded bg-teal-50 px-1 text-[10px] font-semibold text-teal-700 hover:bg-teal-100 dark:bg-teal-950/50 dark:text-teal-300"
          >
            {ref}
          </Link>
        ) : (
          <span key={ref} className="text-[10px] text-slate-400">
            {ref}
          </span>
        )
      })}
    </span>
  )
}

const PRIORITY_VARIANT = { high: 'destructive', medium: 'warning', low: 'secondary' } as const

export function BriefView({
  result,
  evidence,
  compact = false,
}: {
  result: BriefResult
  evidence: BriefEvidence
  /** Widget mode: headline, figures, and the first bullets of each section. */
  compact?: boolean
}) {
  const figures = evidence.facts.filter((f) => !f.items).slice(0, compact ? 3 : 6)
  const breakdowns = evidence.facts.filter((f) => f.items && f.items.length > 0)
  const cited = new Set([
    ...result.sections.flatMap((s) => s.bullets.flatMap((b) => b.citations)),
    ...result.followUps.flatMap((f) => f.citations),
  ])
  const sources = evidence.records.filter((r) => cited.has(r.ref))
  return (
    <div className={cn('space-y-4', compact && 'space-y-3 text-sm')}>
      {result.notice ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <GeneratedValue value={result.notice} />
        </div>
      ) : null}
      <p
        className={cn(
          'font-semibold text-slate-900 dark:text-slate-100',
          compact ? 'text-sm' : 'text-lg leading-snug',
        )}
      >
        <GeneratedValue value={result.headline} />
      </p>
      {figures.length > 0 ? (
        <dl
          className={cn(
            'grid gap-2',
            compact ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
          )}
        >
          {figures.map((fact) => (
            <div
              key={fact.key}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60"
            >
              <dt className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                <GeneratedValue value={fact.label} />
              </dt>
              <dd className="text-lg font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {result.summary ? (
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
          <GeneratedValue value={result.summary} />
        </p>
      ) : null}
      {!compact && breakdowns.length > 0 ? (
        <div className="space-y-2">
          {breakdowns.map((fact) => (
            <div key={fact.key}>
              <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
                <GeneratedValue value={fact.label} />
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(fact.items ?? []).slice(0, 30).map((item) => (
                  <span
                    key={item.label}
                    className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {item.label}
                    {item.value ? <strong className="ml-1">{item.value}</strong> : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {result.sections
        .filter((section) => section.bullets.length > 0)
        .map((section) => (
          <section key={section.key}>
            <h3
              className={cn(
                'border-b-2 border-teal-600 pb-1 font-semibold text-slate-900 dark:text-slate-100',
                compact ? 'mb-1 text-xs' : 'mb-2 text-sm',
              )}
            >
              <GeneratedValue value={section.title} />
            </h3>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
              {section.bullets.slice(0, compact ? 2 : undefined).map((bullet, index) => (
                <li key={index}>
                  <GeneratedValue value={bullet.text} />
                  {compact ? null : <Citations refs={bullet.citations} evidence={evidence} />}
                </li>
              ))}
            </ul>
          </section>
        ))}
      {!compact && result.changes.length > 0 ? (
        <section>
          <h3 className="mb-2 border-b-2 border-teal-600 pb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedText id="m_03d0dfd579b83a" />
          </h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700 dark:text-slate-300">
            {result.changes.map((change, index) => (
              <li key={index}>
                <GeneratedValue value={change} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!compact && result.followUps.length > 0 ? (
        <section>
          <h3 className="mb-2 border-b-2 border-teal-600 pb-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedText id="m_0305640429b3d3" />
          </h3>
          <ul className="space-y-2">
            {result.followUps.map((followUp, index) => (
              <li
                key={index}
                className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300"
              >
                <Badge
                  variant={PRIORITY_VARIANT[followUp.priority]}
                  className="shrink-0 capitalize"
                >
                  <GeneratedValue value={followUp.priority} />
                </Badge>
                <span>
                  <GeneratedValue value={followUp.action} />
                  {followUp.owner ? (
                    <span className="text-slate-500">
                      {' — '}
                      <GeneratedValue value={followUp.owner} />
                    </span>
                  ) : null}
                  <Citations refs={followUp.citations} evidence={evidence} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!compact && sources.length > 0 ? (
        <details className="rounded-lg border border-slate-200 dark:border-slate-800">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            <GeneratedText id="m_045517bacabddf" /> ({sources.length})
          </summary>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {sources.map((record) => (
              <li key={record.ref} className="flex gap-3 px-3 py-2 text-xs">
                <span className="w-8 shrink-0 font-semibold text-teal-700 dark:text-teal-300">
                  {record.ref}
                </span>
                <span className="min-w-0">
                  <Link
                    href={record.path as never}
                    className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                  >
                    <GeneratedValue value={record.title} />
                  </Link>
                  <span className="block text-slate-500">
                    <GeneratedValue
                      value={[record.date, record.author, record.department, record.site]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {compact ? null : (
        <p className="text-xs text-slate-400">
          <GeneratedText id="m_0f40cb1c0853a7" />
        </p>
      )}
    </div>
  )
}
