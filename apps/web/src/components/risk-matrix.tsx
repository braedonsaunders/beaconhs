'use client'

// Tenant-configurable risk model, shared across the Hazard Assessments module
// (and anywhere else that scores risk). The single source of truth is the
// tenant's saved `RiskMatrixConfig` — axis labels, per-cell score/label/colour —
// edited at /hazard-assessments/risk-matrix and injected here through
// <RiskMatrixProvider> at the app shell. Every component below reads the active
// matrix from context, so renaming an axis or recolouring a band in the editor
// flows straight through to the live picker, the score chips and the list.
//
// Authoring model: a cell's score is severity × likelihood (1-based), and a cell
// inherits the label + colour of the highest risk BAND whose threshold its score
// meets. That keeps the editor ergonomic (tune a handful of bands, not N×M
// cells) while the stored shape stays a flat per-cell map the renderers can read
// without recomputing anything.

import { Fragment, createContext, useContext, useMemo, useState } from 'react'
import { cn } from '@beaconhs/ui'
import type { RiskMatrixConfig } from '@beaconhs/db/schema'

export type { RiskMatrixConfig }
type RiskCell = { score: number; label: string; color: string }
type RiskMatrixSelection = {
  likelihood: number | null
  severity: number | null
  score: number | null
  label: string | null
}
/** A risk band: every cell scoring ≥ `minScore` (and below the next band) wears
 *  this label + colour. */
export type RiskBandDef = { label: string; color: string; minScore: number }

// Axis sizes the editor allows. The stored 1-based ratings are plain integers,
// so this only bounds the UI; resizing a populated matrix degrades gracefully
// (out-of-range historical ratings simply stop matching a cell).
export const MIN_AXIS = 3
export const MAX_AXIS = 6

// --- Default matrix --------------------------------------------------------
// Reproduces the platform's long-standing 5×5 AS/NZS-style matrix. Used whenever
// a tenant has no saved matrix (or a malformed one), so unconfigured tenants see
// exactly what they saw before this became editable.

const SEVERITY_LABELS = ['Negligible', 'Minor', 'Moderate', 'Major', 'Severe']
const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain']

const DEFAULT_BANDS: RiskBandDef[] = [
  { label: 'Low', color: '#10b981', minScore: 1 }, // emerald-500
  { label: 'Moderate', color: '#f59e0b', minScore: 5 }, // amber-500
  { label: 'High', color: '#f97316', minScore: 10 }, // orange-500
  { label: 'Critical', color: '#dc2626', minScore: 16 }, // red-600
]

/** The risk band a score falls into (highest band whose threshold it meets;
 *  the lowest band catches anything beneath the first threshold). */
function resolveBand(bands: RiskBandDef[], score: number): RiskBandDef {
  const sorted = [...bands].sort((a, b) => a.minScore - b.minScore)
  let chosen = sorted[0] ?? { label: '', color: '#94a3b8', minScore: 1 }
  for (const b of sorted) if (score >= b.minScore) chosen = b
  return chosen
}

/** Build a full per-cell matrix from axis labels + bands (score = sev × lik). */
export function buildMatrix(
  severityLabels: string[],
  likelihoodLabels: string[],
  bands: RiskBandDef[],
): RiskMatrixConfig {
  const severity = severityLabels.map((s, i) => s.trim() || `S${i + 1}`)
  const likelihood = likelihoodLabels.map((s, i) => s.trim() || `L${i + 1}`)
  const cells: Record<string, RiskCell> = {}
  for (let s = 0; s < severity.length; s++) {
    for (let l = 0; l < likelihood.length; l++) {
      const score = (s + 1) * (l + 1)
      const band = resolveBand(bands, score)
      cells[`${s}:${l}`] = { score, label: band.label, color: band.color }
    }
  }
  return { axes: { severity: { values: severity }, likelihood: { values: likelihood } }, cells }
}

/** Recover the editable band list from a stored matrix — one band per distinct
 *  (label, colour), keyed to the lowest score that wears it. Round-trips any
 *  band-by-score matrix, including legacy seeds. */
export function bandsFromMatrix(matrix: RiskMatrixConfig): RiskBandDef[] {
  const byKey = new Map<string, RiskBandDef>()
  for (const cell of Object.values(matrix.cells)) {
    const key = `${cell.label}|${cell.color}`
    const existing = byKey.get(key)
    if (!existing) byKey.set(key, { label: cell.label, color: cell.color, minScore: cell.score })
    else existing.minScore = Math.min(existing.minScore, cell.score)
  }
  const bands = [...byKey.values()].sort((a, b) => a.minScore - b.minScore)
  if (bands.length > 0 && bands[0]) bands[0].minScore = 1 // lowest band catches everything beneath it
  return bands.length > 0 ? bands : [...DEFAULT_BANDS]
}

export const DEFAULT_RISK_MATRIX: RiskMatrixConfig = buildMatrix(
  SEVERITY_LABELS,
  LIKELIHOOD_LABELS,
  DEFAULT_BANDS,
)

// --- Lookups ---------------------------------------------------------------

/** The cell for a 1-based likelihood × severity pair, or null when unrated /
 *  out of range. */
function cellFor(
  matrix: RiskMatrixConfig,
  likelihood?: number | null,
  severity?: number | null,
): RiskCell | null {
  if (!likelihood || !severity) return null
  return matrix.cells[`${severity - 1}:${likelihood - 1}`] ?? null
}

/** Plain severity × likelihood product — the fallback score with no matrix. */
function riskScore(likelihood?: number | null, severity?: number | null): number | null {
  if (!likelihood || !severity) return null
  return likelihood * severity
}

/** Map a precomputed score (e.g. an aggregated "worst residual") onto a band by
 *  matching, then bracketing, the matrix's cell scores. */
function bandForScore(matrix: RiskMatrixConfig, score: number): RiskCell | null {
  const cells = Object.values(matrix.cells)
  if (cells.length === 0) return null
  const exact = cells.find((c) => c.score === score)
  if (exact) return exact
  const sorted = [...cells].sort((a, b) => a.score - b.score)
  let below: RiskCell | null = null
  for (const c of sorted) if (c.score <= score) below = c
  return below ?? sorted[sorted.length - 1] ?? null
}

/** Guard against malformed/empty saved configs — fall back to the default. */
function normalizeMatrix(matrix: RiskMatrixConfig | null | undefined): RiskMatrixConfig {
  if (
    !matrix ||
    !matrix.axes?.severity?.values?.length ||
    !matrix.axes?.likelihood?.values?.length ||
    !matrix.cells ||
    Object.keys(matrix.cells).length === 0
  ) {
    return DEFAULT_RISK_MATRIX
  }
  return matrix
}

// --- Context ---------------------------------------------------------------

const RiskMatrixContext = createContext<RiskMatrixConfig>(DEFAULT_RISK_MATRIX)

/** The tenant's active risk matrix (falls back to the default outside a provider). */
function useRiskMatrix(): RiskMatrixConfig {
  return useContext(RiskMatrixContext)
}

export function RiskMatrixProvider({
  matrix,
  children,
}: {
  matrix: RiskMatrixConfig | null | undefined
  children: React.ReactNode
}) {
  const value = useMemo(() => normalizeMatrix(matrix), [matrix])
  return <RiskMatrixContext.Provider value={value}>{children}</RiskMatrixContext.Provider>
}

// --- Colour helpers --------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim()
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  const n = Number.parseInt(h, 16)
  if (!Number.isFinite(n) || h.length !== 6) return { r: 148, g: 163, b: 184 } // slate-400
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/** Black or white text, whichever reads on the given background. */
function readableTextColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.62 ? '#0f172a' : '#ffffff'
}

// --- Chips -----------------------------------------------------------------

function NotRated({ prefix }: { prefix?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-500/10 ring-inset dark:bg-slate-800 dark:text-slate-400">
      {prefix ? `${prefix} · ` : ''}Not rated
    </span>
  )
}

function RiskChip({
  color,
  score,
  label,
  prefix,
}: {
  color: string
  score: number
  label: string
  prefix?: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 ring-1 ring-slate-500/10 ring-inset dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-100/10">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full ring-1 ring-black/10"
        style={{ background: color }}
      />
      {prefix ? <span className="opacity-70">{prefix}</span> : null}
      <span className="font-semibold tabular-nums">
        {score}
        {label ? ` · ${label}` : ''}
      </span>
    </span>
  )
}

/** Chip for a precomputed 1-based score (e.g. an aggregated "worst risk"). */
export function RiskScoreChip({ score, prefix }: { score: number | null; prefix?: string }) {
  const matrix = useRiskMatrix()
  if (score == null) return <NotRated prefix={prefix} />
  const cell = bandForScore(matrix, score)
  return (
    <RiskChip
      color={cell?.color ?? '#94a3b8'}
      score={score}
      label={cell?.label ?? ''}
      prefix={prefix}
    />
  )
}

/** Chip showing the score + band for a likelihood × severity pair. */
export function RiskScoreBadge({
  likelihood,
  severity,
  prefix,
}: {
  likelihood?: number | null
  severity?: number | null
  prefix?: string
}) {
  const matrix = useRiskMatrix()
  const cell = cellFor(matrix, likelihood, severity)
  if (!cell) return <NotRated prefix={prefix} />
  return <RiskChip color={cell.color} score={cell.score} label={cell.label} prefix={prefix} />
}

/** Pre-control → post-control residual indicator: two score chips + an arrow. */
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

// --- Grid ------------------------------------------------------------------

/**
 * The colour-banded matrix grid: severity → across the top (S1…Sn), likelihood ↑
 * down the left (Ln at top, L1 at bottom). Shared by the interactive picker
 * (`RiskMatrixField`) and the editor preview so they can never drift apart.
 */
export function RiskMatrixGrid({
  matrix,
  selected,
  onSelect,
  disabled,
  className,
}: {
  matrix: RiskMatrixConfig
  /** 1-based current selection, when interactive. */
  selected?: { likelihood: number | null; severity: number | null }
  /** Omit for a read-only preview. */
  onSelect?: (likelihood: number, severity: number) => void
  disabled?: boolean
  className?: string
}) {
  const sev = matrix.axes.severity.values
  const lik = matrix.axes.likelihood.values
  const interactive = Boolean(onSelect)
  // Likelihood rows render high → low so the most likely sits at the top.
  const rows = lik.map((_, i) => i).reverse()

  return (
    <div className={cn('overflow-x-auto', className)}>
      <div
        className="inline-grid w-full gap-0.5 text-center"
        style={{ gridTemplateColumns: `auto repeat(${sev.length}, minmax(2.25rem, 1fr))` }}
      >
        {/* Header row: severity S1…Sn */}
        <div />
        {sev.map((label, i) => (
          <div
            key={`sev-${i}`}
            title={label}
            className="truncate px-1 pb-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400"
          >
            S{i + 1}
          </div>
        ))}
        {/* Body rows */}
        {rows.map((li) => (
          <Fragment key={`row-${li}`}>
            <div
              title={lik[li]}
              className="flex items-center justify-end pr-1.5 text-[10px] font-medium text-slate-500 dark:text-slate-400"
            >
              L{li + 1}
            </div>
            {sev.map((_, si) => {
              const cell = matrix.cells[`${si}:${li}`]
              const color = cell?.color ?? '#94a3b8'
              const isSelected = selected?.severity === si + 1 && selected?.likelihood === li + 1
              const shared =
                'flex h-11 items-center justify-center rounded-sm text-xs font-semibold transition sm:h-9 sm:text-[11px]'
              const style = { background: color, color: readableTextColor(color) }
              const title = `${lik[li]} × ${sev[si]} = ${cell?.score ?? ''}${cell?.label ? ` · ${cell.label}` : ''}`

              if (!interactive) {
                return (
                  <div key={`c-${si}-${li}`} title={title} className={shared} style={style}>
                    {cell?.score ?? ''}
                  </div>
                )
              }
              return (
                <button
                  key={`c-${si}-${li}`}
                  type="button"
                  disabled={disabled}
                  title={title}
                  aria-pressed={isSelected}
                  onClick={() => onSelect?.(li + 1, si + 1)}
                  className={cn(
                    shared,
                    'hover:brightness-110 active:brightness-95',
                    isSelected && 'font-bold ring-2 ring-slate-900 ring-inset dark:ring-white',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                  style={style}
                >
                  {cell?.score ?? ''}
                </button>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

// --- Interactive field -----------------------------------------------------

/**
 * Interactive risk-matrix picker driven by the tenant's matrix. Exposes the
 * chosen 1-based likelihood/severity pair through hidden inputs so it drops into
 * a plain <form action={…}>.
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
  onChange?: (next: RiskMatrixSelection) => void
}) {
  const matrix = useRiskMatrix()
  const [likelihood, setLikelihood] = useState<number | null>(defaultLikelihood ?? null)
  const [severity, setSeverity] = useState<number | null>(defaultSeverity ?? null)
  const sevLabel = severity ? matrix.axes.severity.values[severity - 1] : null
  const likLabel = likelihood ? matrix.axes.likelihood.values[likelihood - 1] : null

  function setPair(l: number | null, s: number | null) {
    setLikelihood(l)
    setSeverity(s)
    const cell = cellFor(matrix, l, s)
    onChange?.({
      likelihood: l,
      severity: s,
      score: cell?.score ?? null,
      label: cell?.label ?? null,
    })
  }

  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <div className="flex items-center justify-between gap-2">
        <legend className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          {label}
        </legend>
        <RiskScoreBadge likelihood={likelihood} severity={severity} />
      </div>
      <input type="hidden" name={likelihoodName} value={likelihood ?? ''} />
      <input type="hidden" name={severityName} value={severity ?? ''} />
      <RiskMatrixGrid
        matrix={matrix}
        selected={{ likelihood, severity }}
        disabled={disabled}
        onSelect={(l, s) => {
          if (likelihood === l && severity === s) setPair(null, null)
          else setPair(l, s)
        }}
      />
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {likLabel && sevLabel ? (
          <>
            {likLabel} likelihood × {sevLabel} severity. Select the cell again to clear.
          </>
        ) : (
          'Select the cell where likelihood meets severity.'
        )}
      </p>
    </fieldset>
  )
}
