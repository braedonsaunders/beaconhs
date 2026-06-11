'use client'

// Slim header band that sits above the grid. It carries the greeting,
// tenant summary, live-as-of pill, role tag, and the Customise CTA.
//
// We keep this small (no big tile area) because the grid below now does
// the heavy lifting that the old dark Hero used to do. The header is the
// emotional throughline — who you are, what tenant, when.

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Settings2, Sparkles } from 'lucide-react'

export function DashboardHeader({
  greeting,
  tenantSummary,
  asOf,
  roleLabel,
  isCustomised,
}: {
  greeting: string
  tenantSummary: string
  asOf: string
  roleLabel: string
  isCustomised: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl border border-slate-200/60 bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 text-white shadow-[0_20px_60px_-20px_rgba(15,23,42,0.45)] dark:border-slate-800/60"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse at top right, black 0%, transparent 70%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 h-56 w-56 rounded-full bg-teal-400/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 -left-32 h-56 w-56 rounded-full bg-sky-500/10 blur-3xl"
      />

      <div className="relative flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-400/15 px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em] text-teal-200 uppercase ring-1 ring-teal-300/30 ring-inset">
              <Sparkles size={10} />
              Safety command center
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium tracking-[0.14em] text-slate-200 uppercase ring-1 ring-white/10 ring-inset">
              {roleLabel} view
            </span>
            {isCustomised ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-amber-200 uppercase ring-1 ring-amber-300/30 ring-inset">
                Customised
              </span>
            ) : null}
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-white sm:text-[26px]">{greeting}</h1>
          <p className="mt-1 text-sm text-slate-300">{tenantSummary}</p>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-slate-200 backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Live
          </span>
          <span className="text-[11px] text-slate-400">As of {asOf}</span>
          <Link
            href="/dashboard/customize"
            className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-100 backdrop-blur transition hover:border-teal-300/60 hover:bg-white/10 hover:text-white"
          >
            <Settings2 size={13} />
            Customise
          </Link>
        </div>
      </div>
    </motion.div>
  )
}
