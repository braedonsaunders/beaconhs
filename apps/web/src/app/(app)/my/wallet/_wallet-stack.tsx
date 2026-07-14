'use client'

// Apple-Wallet-style credential gallery.
//
// Each card embeds the REAL rendered credential design (front + back artboards
// produced server-side by `renderDesignDocumentHtml`), scaled to fit via an
// isolated iframe — so what's on screen is identical to the printed CR80 card.
// Tap a card to flip front↔back; a differentiating header (kind + title +
// status) makes the stack scannable, and each card downloads its print-ready
// pass. One column on phones, a wider multi-column gallery on desktop.

import Link from 'next/link'
import { Award, CreditCard, Download, GraduationCap, ShieldCheck } from 'lucide-react'
import { cn, EmptyState } from '@beaconhs/ui'
import { CredentialFlipCard } from '@/components/credential-flip-card'

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

export function WalletStack({
  cards,
  design,
  filtered = false,
}: {
  cards: WalletCard[]
  design: WalletDesign
  filtered?: boolean
}) {
  if (cards.length === 0) {
    return (
      <EmptyState
        icon={<CreditCard size={32} />}
        title={filtered ? 'No credentials match these filters' : 'No credentials yet'}
        description={
          filtered
            ? 'Clear the search or filters to see your other credentials.'
            : 'Completed training and granted skills appear here as wallet cards you can flip, carry, and download.'
        }
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <FlipCard key={card.id} card={card} design={design} />
      ))}
    </div>
  )
}

function FlipCard({ card, design }: { card: WalletCard; design: WalletDesign }) {
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

      <CredentialFlipCard
        frontHtml={card.frontHtml}
        backHtml={card.backHtml}
        widthIn={design.widthIn}
        heightIn={design.heightIn}
      />

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
