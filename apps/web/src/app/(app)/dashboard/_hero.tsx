'use client'

import Link from 'next/link'
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  FileCheck,
  GraduationCap,
  Minus,
  ShieldAlert,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { AnimatedNumber } from './_counter'
import { Sparkline } from './_sparkline'

/**
 * The full-width hero band at the top of the dashboard. Four tiles, each one
 * a "vital sign": TRIR, DART, training compliance, document compliance.
 *
 * The hero is the dashboard's emotional anchor. It deliberately fills the
 * width and uses a dark gradient so the rest of the page reads as supporting
 * material. Each tile:
 *   - shows the big number (count-up animated)
 *   - shows the period delta vs the prior 12 months, with a tinted arrow
 *   - shows a 12-month sparkline so the user can see the shape of the trend
 *
 * The delta tint follows the metric's polarity: TRIR/DART falling is good
 * (incident rates dropping), training/document compliance rising is good.
 */
export type HeroTileData = {
  key: string
  label: string
  href: string
  icon: 'shield' | 'activity' | 'graduation' | 'file-check'
  value: number | null
  prevValue: number | null
  /** How to format the big number — string key, resolved client-side
   * because RSCs can't serialise function references. */
  formatKey: 'fixed2' | 'integer' | 'percent'
  /** Optional suffix appended to the big number (e.g. "%"). */
  suffix?: string
  /** Tiny sub-line, e.g. "12 recordable · ~24k hrs". */
  caption: string
  /** 12-month trend, oldest -> newest. */
  trend: ReadonlyArray<number | null>
  /** When true, rising values are *bad* (e.g. incident rates). */
  invertedDelta: boolean
  /** Tooltip on the label. */
  tooltip?: string
}

export function Hero({
  tiles,
  asOf,
  greeting,
  tenantSummary,
}: {
  tiles: HeroTileData[]
  asOf: string
  greeting: string
  tenantSummary: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 text-white shadow-[0_30px_80px_-25px_rgba(15,23,42,0.45)]">
      {/* decorative grid + glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage:
            'radial-gradient(ellipse at top right, black 0%, transparent 70%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full bg-teal-400/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 bottom-0 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl"
      />

      <div className="relative p-6 sm:p-8">
        {/* top row: greeting + meta */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-teal-300/80">
              Safety command center
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-white sm:text-[28px]">
              {greeting}
            </h1>
            <p className="mt-1 text-sm text-slate-300">{tenantSummary}</p>
          </div>
          <div className="flex flex-col items-end gap-1 text-right text-xs text-slate-300/80">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 font-medium text-slate-200 backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Live · last 12 months
            </span>
            <span className="text-[11px] text-slate-400">As of {asOf}</span>
          </div>
        </div>

        {/* tile grid */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((tile, i) => (
            <HeroTile key={tile.key} tile={tile} delay={0.1 + i * 0.07} />
          ))}
        </div>
      </div>
    </div>
  )
}

function HeroTile({ tile, delay }: { tile: HeroTileData; delay: number }) {
  const Icon = iconFor(tile.icon)
  const hasValue = tile.value !== null && Number.isFinite(tile.value)
  // Compute the delta and decide tone.
  const delta =
    tile.value !== null && tile.prevValue !== null && Number.isFinite(tile.prevValue)
      ? tile.value - tile.prevValue
      : null
  const deltaDir: 'up' | 'down' | 'flat' =
    delta === null || Math.abs(delta) < 0.005
      ? 'flat'
      : delta > 0
        ? 'up'
        : 'down'
  const good =
    deltaDir === 'flat'
      ? null
      : tile.invertedDelta
        ? deltaDir === 'down'
        : deltaDir === 'up'
  const deltaTone =
    good === null
      ? 'text-slate-300/80 bg-white/10 border-white/15'
      : good
        ? 'text-emerald-200 bg-emerald-400/15 border-emerald-300/30'
        : 'text-rose-200 bg-rose-400/15 border-rose-300/30'
  const DeltaIcon =
    deltaDir === 'up' ? ArrowUpRight : deltaDir === 'down' ? ArrowDownRight : Minus
  const sparkColor = good === false ? '#fda4af' : good === true ? '#5eead4' : '#cbd5e1'

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
    >
      <Link
        href={tile.href as any}
        title={tile.tooltip}
        className="group relative block overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors hover:border-white/25 hover:bg-white/[0.07]"
      >
        {/* corner accent */}
        <div
          aria-hidden
          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-teal-200/90 ring-1 ring-inset ring-white/10"
        >
          <Icon size={14} />
        </div>

        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-300/80">
          {tile.label}
        </p>

        <div className="mt-1 flex items-baseline gap-1 text-white">
          {hasValue ? (
            <>
              <AnimatedNumber
                value={tile.value!}
                format={formatFor(tile.formatKey)}
                delay={delay + 0.1}
                className="text-[42px] font-semibold leading-none tabular-nums"
              />
              {tile.suffix ? (
                <span className="text-2xl font-semibold text-slate-300">
                  {tile.suffix}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-[42px] font-semibold leading-none tabular-nums text-slate-500">
              —
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${deltaTone}`}
          >
            <DeltaIcon size={11} />
            {delta === null
              ? '— vs prior'
              : `${delta > 0 ? '+' : ''}${formatFor(tile.formatKey)(Math.abs(delta))} vs prior`}
          </span>
          <div className="text-teal-200/80">
            <Sparkline
              data={tile.trend}
              width={92}
              height={26}
              stroke={sparkColor}
              ariaLabel={`${tile.label} 12-month trend`}
              showArea
            />
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
          <span className="truncate">{tile.caption}</span>
          <ArrowRight
            size={12}
            className="shrink-0 translate-x-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-200"
          />
        </div>
      </Link>
    </motion.div>
  )
}

function iconFor(name: HeroTileData['icon']) {
  switch (name) {
    case 'shield':
      return ShieldAlert
    case 'activity':
      return Activity
    case 'graduation':
      return GraduationCap
    case 'file-check':
      return FileCheck
  }
}

function formatFor(key: HeroTileData['formatKey']) {
  switch (key) {
    case 'fixed2':
      return (v: number) => v.toFixed(2)
    case 'percent':
      return (v: number) => `${Math.round(v)}`
    case 'integer':
    default:
      return (v: number) => Math.round(v).toString()
  }
}
