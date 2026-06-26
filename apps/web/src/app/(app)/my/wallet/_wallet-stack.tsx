'use client'

// Apple-Wallet-style credential gallery.
//
// Each card embeds the REAL rendered credential design (front + back artboards
// produced server-side by `renderDesignDocumentHtml`), scaled to fit via an
// isolated iframe — so what's on screen is identical to the printed CR80 card.
// Tap a card to flip front↔back; a differentiating header (kind + title +
// status) makes the stack scannable, and each card downloads its print-ready
// pass. One column on phones, a wider multi-column gallery on desktop.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Award, CreditCard, Download, GraduationCap, RotateCw, ShieldCheck } from 'lucide-react'
import { cn, EmptyState } from '@beaconhs/ui'

export type WalletCard = {
  id: string
  kind: 'training' | 'skill'
  title: string
  status: 'valid' | 'expiring' | 'expired' | 'none'
  frontHtml: string
  backHtml: string
  pdfHref: string
  verifyHref: string | null
}

export type WalletDesign = {
  widthIn: number
  heightIn: number
}

const DPI = 96

const STATUS: Record<WalletCard['status'], { label: string; cls: string }> = {
  valid: {
    label: 'Valid',
    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  expiring: {
    label: 'Expiring soon',
    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  },
  expired: {
    label: 'Expired',
    cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  },
  none: {
    label: 'No expiry',
    cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
}

const KIND = {
  training: {
    label: 'Training',
    icon: GraduationCap,
    cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  },
  skill: {
    label: 'Skill',
    icon: Award,
    cls: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  },
} as const

export function WalletStack({ cards, design }: { cards: WalletCard[]; design: WalletDesign }) {
  if (cards.length === 0) {
    return (
      <EmptyState
        icon={<CreditCard size={32} />}
        title="No credentials yet"
        description="Completed training and granted skills appear here as wallet cards you can flip, carry, and download."
      />
    )
  }

  const naturalW = design.widthIn * DPI
  const naturalH = design.heightIn * DPI
  const ratio = design.widthIn / design.heightIn

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <FlipCard key={card.id} card={card} naturalW={naturalW} naturalH={naturalH} ratio={ratio} />
      ))}
    </div>
  )
}

function FlipCard({
  card,
  naturalW,
  naturalH,
  ratio,
}: {
  card: WalletCard
  naturalW: number
  naturalH: number
  ratio: number
}) {
  const [flipped, setFlipped] = useState(false)
  const status = STATUS[card.status]
  const kind = KIND[card.kind]

  return (
    <div className="flex flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
              kind.cls,
            )}
          >
            <kind.icon size={12} />
            {kind.label}
          </span>
          <span
            className="truncate text-sm font-medium text-slate-700 dark:text-slate-200"
            title={card.title}
          >
            {card.title}
          </span>
        </div>
        <span
          className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', status.cls)}
        >
          {status.label}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? 'Show card front' : 'Show card back'}
        className="group relative w-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        style={{ perspective: 1200 }}
      >
        <div
          className="relative w-full transition-transform duration-500 ease-out"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            aspectRatio: String(ratio),
          }}
        >
          <CardFace
            html={card.frontHtml}
            naturalW={naturalW}
            naturalH={naturalH}
            className="absolute inset-0"
            style={{ backfaceVisibility: 'hidden' }}
          />
          <CardFace
            html={card.backHtml}
            naturalW={naturalW}
            naturalH={naturalH}
            className="absolute inset-0"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          />
        </div>
        <span className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[10px] font-medium text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
          <RotateCw size={11} />
          Flip
        </span>
      </button>

      <div className="mt-3 flex items-center gap-2">
        <Link
          href={card.pdfHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 dark:bg-slate-100 dark:text-slate-900"
        >
          <Download size={15} />
          Download
        </Link>
        {card.verifyHref ? (
          <Link
            href={card.verifyHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <ShieldCheck size={15} />
            Verify
          </Link>
        ) : null}
      </div>
    </div>
  )
}

// Embed a single rendered artboard, scaled to its container width. The iframe
// isolates the design's CSS (units in inches/points) so it never collides with
// app styles; pointer-events are off so taps reach the flip button.
function CardFace({
  html,
  naturalW,
  naturalH,
  className,
  style,
}: {
  html: string
  naturalW: number
  naturalH: number
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (w: number) => {
      if (w) setScale(w / naturalW)
    }
    update(el.clientWidth)
    const ro = new ResizeObserver((entries) => update(entries[0]?.contentRect.width ?? 0))
    ro.observe(el)
    return () => ro.disconnect()
  }, [naturalW])

  return (
    <div
      ref={ref}
      className={cn(
        'overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/10',
        className,
      )}
      style={style}
    >
      <iframe
        title=""
        srcDoc={html}
        scrolling="no"
        sandbox=""
        tabIndex={-1}
        style={{
          width: naturalW,
          height: naturalH,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
