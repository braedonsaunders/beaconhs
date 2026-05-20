'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  GraduationCap,
  HardHat,
  ListChecks,
  Radio,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { AnimatedNumber } from './_counter'

// Icon refs need to live on the client side — RSCs can't serialise function
// components. Page passes a string key, we resolve here.
const KPI_ICONS: Record<string, LucideIcon> = {
  alert: AlertTriangle,
  calendar: CalendarClock,
  'clipboard-check': ClipboardCheck,
  clipboard: ClipboardList,
  grad: GraduationCap,
  'hard-hat': HardHat,
  'list-checks': ListChecks,
  radio: Radio,
  shield: ShieldCheck,
}

/**
 * Compact KPI tiles, scrollable on small screens. Used for the second tier
 * of metrics beneath the hero: Open CAs, Overdue CAs, Inspections, etc.
 *
 * The strip uses CSS `overflow-x-auto` rather than a JS carousel — content
 * fits in a 4–5 column grid on desktop and falls back to a horizontal swipe
 * on tablet/phone. The faint inner shadow on the right edge hints at more
 * content when overflow is hidden.
 */
export type KpiTileData = {
  key: string
  label: string
  value: number
  href: string
  iconKey: keyof typeof KPI_ICONS | string
  /**
   * Optional small caption beneath the number. Tone tints it.
   */
  caption?: string
  captionTone?: 'success' | 'warning' | 'destructive' | 'muted'
  /**
   * If true, the number is rendered with a danger accent (e.g. overdue counts).
   */
  emphasis?: 'normal' | 'warning' | 'danger'
}

export function KpiStrip({ tiles }: { tiles: KpiTileData[] }) {
  return (
    <div className="relative">
      <div className="app-scroll -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 pt-1">
        {tiles.map((tile, i) => (
          <motion.div
            key={tile.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.05 + i * 0.035,
              duration: 0.35,
              ease: [0.22, 1, 0.36, 1],
            }}
            whileHover={{ y: -2 }}
            className="min-w-[180px] flex-1 snap-start xl:min-w-[160px]"
          >
            <Tile tile={tile} delay={0.1 + i * 0.035} />
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function Tile({ tile, delay }: { tile: KpiTileData; delay: number }) {
  const Icon = KPI_ICONS[tile.iconKey] ?? ListChecks
  const captionTone = tile.captionTone ?? 'muted'
  const captionClass =
    captionTone === 'success'
      ? 'text-emerald-700'
      : captionTone === 'warning'
        ? 'text-amber-700'
        : captionTone === 'destructive'
          ? 'text-rose-700'
          : 'text-slate-500'

  const valueClass =
    tile.emphasis === 'danger'
      ? 'text-rose-700'
      : tile.emphasis === 'warning'
        ? 'text-amber-700'
        : 'text-slate-900'

  const iconRingClass =
    tile.emphasis === 'danger'
      ? 'bg-rose-50 text-rose-600 ring-rose-100'
      : tile.emphasis === 'warning'
        ? 'bg-amber-50 text-amber-600 ring-amber-100'
        : 'bg-slate-100 text-slate-600 ring-slate-100'

  return (
    <Link
      href={tile.href as any}
      className="group block h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-teal-200 hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {tile.label}
        </span>
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-inset ${iconRingClass}`}
        >
          <Icon size={14} />
        </span>
      </div>
      <div className={`mt-2 text-3xl font-semibold leading-none tabular-nums ${valueClass}`}>
        <AnimatedNumber
          value={tile.value}
          format={(v) => Math.round(v).toLocaleString()}
          delay={delay}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`text-[11px] ${captionClass}`}>{tile.caption ?? ' '}</span>
        <ChevronRight
          size={14}
          className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-600"
        />
      </div>
    </Link>
  )
}
