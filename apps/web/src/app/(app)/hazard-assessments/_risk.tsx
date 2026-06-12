'use client'

// Risk model shared across the Hazard Assessments module.
//
// Risk = Likelihood (1-5) × Severity (1-5), banded into four levels. The
// thresholds mirror the standard AS/NZS-style 5×5 matrix the legacy app's
// paper forms were based on:
//
//   1-4    Low        emerald
//   5-9    Moderate   amber
//   10-15  High       orange
//   16-25  Critical   red

import { useState } from 'react'
import { cn } from '@beaconhs/ui'

export const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain']
export const SEVERITY_LABELS = ['Negligible', 'Minor', 'Moderate', 'Major', 'Severe']

export type RiskBand = 'low' | 'moderate' | 'high' | 'critical'

export function riskScore(likelihood?: number | null, severity?: number | null): number | null {
  if (!likelihood || !severity) return null
  return likelihood * severity
}

export function riskBand(score: number): RiskBand {
  if (score >= 16) return 'critical'
  if (score >= 10) return 'high'
  if (score >= 5) return 'moderate'
  return 'low'
}

export const RISK_BAND_META: Record<
  RiskBand,
  { label: string; chip: string; cell: string; cellSelected: string }
> = {
  low: {
    label: 'Low',
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
    cell: 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900',
    cellSelected: 'bg-emerald-500 text-white',
  },
  moderate: {
    label: 'Moderate',
    chip: 'bg-amber-50 text-amber-700 ring-amber-600/20',
    cell: 'bg-amber-100 hover:bg-amber-200 text-amber-900',
    cellSelected: 'bg-amber-500 text-white',
  },
  high: {
    label: 'High',
    chip: 'bg-orange-50 text-orange-700 ring-orange-600/20',
    cell: 'bg-orange-100 hover:bg-orange-200 text-orange-900',
    cellSelected: 'bg-orange-500 text-white',
  },
  critical: {
    label: 'Critical',
    chip: 'bg-red-50 text-red-700 ring-red-600/20',
    cell: 'bg-red-100 hover:bg-red-200 text-red-900',
    cellSelected: 'bg-red-600 text-white',
  },
}

/** Chip for a pre-computed 1-25 score (e.g. an aggregated "worst risk"). */
export function RiskScoreChip({ score, prefix }: { score: number | null; prefix?: string }) {
  if (score == null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-500/10 ring-inset dark:bg-slate-800">
        {prefix ? `${prefix} · ` : ''}Not rated
      </span>
    )
  }
  const meta = RISK_BAND_META[riskBand(score)]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        meta.chip,
      )}
    >
      {prefix ? <span className="font-medium opacity-80">{prefix}</span> : null}
      {score} · {meta.label}
    </span>
  )
}

/**
 * Compact chip showing a computed risk score + band, e.g. "12 · High".
 * Renders a muted "Not rated" chip when either input is missing.
 */
export function RiskScoreBadge({
  likelihood,
  severity,
  prefix,
}: {
  likelihood?: number | null
  severity?: number | null
  prefix?: string
}) {
  const score = riskScore(likelihood, severity)
  if (score == null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-500/10 ring-inset dark:bg-slate-800">
        {prefix ? `${prefix} · ` : ''}Not rated
      </span>
    )
  }
  const meta = RISK_BAND_META[riskBand(score)]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        meta.chip,
      )}
    >
      {prefix ? <span className="font-medium opacity-80">{prefix}</span> : null}
      {score} · {meta.label}
    </span>
  )
}

/**
 * Pre-control → post-control residual indicator: two score chips joined by an
 * arrow. Shows at a glance whether the listed controls actually buy risk down.
 */
export function RiskDelta({
  preLikelihood,
  preSeverity,
  postLikelihood,
  postSeverity,
}: {
  preLikelihood?: number | null
  preSeverity?: number | null
  postLikelihood?: number | null
  postSeverity?: number | null
}) {
  const pre = riskScore(preLikelihood, preSeverity)
  const post = riskScore(postLikelihood, postSeverity)
  if (pre == null && post == null) return <RiskScoreBadge />
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <RiskScoreBadge likelihood={preLikelihood} severity={preSeverity} prefix="Initial" />
      <span aria-hidden className="text-slate-400">
        →
      </span>
      <RiskScoreBadge likelihood={postLikelihood} severity={postSeverity} prefix="Residual" />
    </span>
  )
}

/**
 * Interactive 5×5 risk-matrix picker. Renders the full color-banded grid
 * (severity →, likelihood ↑) and exposes the chosen pair through hidden
 * inputs so it can sit inside a plain <form action={…}>.
 */
export function RiskMatrixField({
  label,
  likelihoodName,
  severityName,
  defaultLikelihood,
  defaultSeverity,
  disabled,
  onChange,
}: {
  label: string
  likelihoodName: string
  severityName: string
  defaultLikelihood?: number | null
  defaultSeverity?: number | null
  disabled?: boolean
  /** Lifts the chosen pair for drawer bodies that build FormData manually. */
  onChange?: (next: { likelihood: number | null; severity: number | null }) => void
}) {
  const [likelihood, setLikelihood] = useState<number | null>(defaultLikelihood ?? null)
  const [severity, setSeverity] = useState<number | null>(defaultSeverity ?? null)
  const score = riskScore(likelihood, severity)

  function setPair(l: number | null, s: number | null) {
    setLikelihood(l)
    setSeverity(s)
    onChange?.({ likelihood: l, severity: s })
  }

  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <div className="flex items-center justify-between gap-2">
        <legend className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {label}
        </legend>
        <RiskScoreBadge likelihood={likelihood} severity={severity} />
      </div>
      <input type="hidden" name={likelihoodName} value={likelihood ?? ''} />
      <input type="hidden" name={severityName} value={severity ?? ''} />
      <div className="overflow-x-auto">
        <div className="inline-grid w-full grid-cols-[auto_repeat(5,minmax(2.5rem,1fr))] gap-0.5 text-center">
          {/* Header row: severity 1..5 */}
          <div />
          {SEVERITY_LABELS.map((s, i) => (
            <div key={s} title={s} className="px-1 pb-0.5 text-[10px] font-medium text-slate-500">
              S{i + 1}
            </div>
          ))}
          {/* Body rows: likelihood 5 (top) … 1 (bottom) */}
          {[5, 4, 3, 2, 1].map((l) => (
            <div key={l} className="contents">
              <div
                title={LIKELIHOOD_LABELS[l - 1]}
                className="flex items-center justify-end pr-1.5 text-[10px] font-medium text-slate-500"
              >
                L{l}
              </div>
              {[1, 2, 3, 4, 5].map((s) => {
                const cellScore = l * s
                const meta = RISK_BAND_META[riskBand(cellScore)]
                const selected = likelihood === l && severity === s
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    title={`${LIKELIHOOD_LABELS[l - 1]} × ${SEVERITY_LABELS[s - 1]} = ${cellScore}`}
                    aria-pressed={selected}
                    onClick={() => {
                      if (selected) setPair(null, null)
                      else setPair(l, s)
                    }}
                    className={cn(
                      // 44px touch targets on phones (HIG), compact on desktop
                      'h-11 rounded-sm text-xs font-semibold transition-colors sm:h-8 sm:text-[11px]',
                      selected ? meta.cellSelected : meta.cell,
                      selected && 'ring-2 ring-slate-900/60 ring-inset',
                      disabled && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    {cellScore}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-slate-500">
        {likelihood && severity ? (
          <>
            {LIKELIHOOD_LABELS[likelihood - 1]} likelihood × {SEVERITY_LABELS[severity - 1]}{' '}
            severity. Select the cell again to clear.
          </>
        ) : (
          'Select the cell where likelihood meets severity.'
        )}
      </p>
    </fieldset>
  )
}
