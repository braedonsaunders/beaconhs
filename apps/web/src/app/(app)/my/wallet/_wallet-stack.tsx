'use client'

// Apple-Wallet-style credential stack.
//
// Cards overlap into a tappable stack styled with the tenant's wallet design
// tokens (primary / accent / paper / typeface). Tapping a card expands it in
// place to reveal the holder photo, dates, a scan-to-verify QR, and links to
// the print-ready PDF. Touch-first: no hover is required to operate it.

import { useState } from 'react'
import Link from 'next/link'
import { CreditCard, Download, ShieldCheck } from 'lucide-react'
import { EmptyState } from '@beaconhs/ui'

export type WalletCard = {
  id: string
  kind: 'training' | 'skill'
  title: string
  code: string | null
  authority: string | null
  issuedLabel: string
  issuedOn: string
  expiresOn: string | null
  status: 'valid' | 'expiring' | 'expired' | 'none'
  pdfHref: string
  verifyHref: string | null
  qrDataUrl: string | null
}

export type WalletDesign = {
  primary: string
  accent: string
  paper: string
  typeface: 'classic' | 'modern' | 'technical'
  showPhoto: boolean
  showSeal: boolean
  showQr: boolean
  tenantName: string
  tenantLogoUrl: string | null
  holderName: string
  employeeNo: string | null
  jobTitle: string | null
  photoUrl: string | null
}

// ---- tiny color helpers (no DOM, mirror the PDF theme math) --------------
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return [Number.isNaN(r) ? 24 : r, Number.isNaN(g) ? 56 : g, Number.isNaN(b) ? 95 : b]
}
function toHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}
function shade(hex: string, amt: number): string {
  const [r, g, b] = parseHex(hex)
  return toHex(r * (1 - amt), g * (1 - amt), b * (1 - amt))
}
function tint(hex: string, amt: number): string {
  const [r, g, b] = parseHex(hex)
  return toHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt)
}
function initialsOf(name: string, max = 2): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, max)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('') || '—'
  )
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS: Record<WalletCard['status'], { label: string; dot: string }> = {
  expired: { label: 'Expired', dot: '#ef4444' },
  expiring: { label: 'Expiring soon', dot: '#f59e0b' },
  valid: { label: 'Valid', dot: '#10b981' },
  none: { label: 'No expiry', dot: '#cbd5e1' },
}

function fontStack(typeface: WalletDesign['typeface']): string {
  if (typeface === 'technical') return "ui-monospace, 'SF Mono', Menlo, monospace"
  if (typeface === 'classic') return "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
  return "'Archivo', ui-sans-serif, system-ui, sans-serif"
}

export function WalletStack({ cards, design }: { cards: WalletCard[]; design: WalletDesign }) {
  const [openId, setOpenId] = useState<string | null>(cards[0]?.id ?? null)

  if (cards.length === 0) {
    return (
      <EmptyState
        icon={<CreditCard size={32} />}
        title="No credentials yet"
        description="Completed training and granted skills appear here as wallet cards you can carry and download."
      />
    )
  }

  return (
    <div className="mx-auto w-full max-w-md" style={{ fontFamily: fontStack(design.typeface) }}>
      <div className="flex flex-col">
        {cards.map((card, i) => (
          <WalletCardView
            key={card.id}
            card={card}
            design={design}
            index={i}
            open={openId === card.id}
            onToggle={() => setOpenId((cur) => (cur === card.id ? null : card.id))}
          />
        ))}
      </div>
    </div>
  )
}

function WalletCardView({
  card,
  design,
  index,
  open,
  onToggle,
}: {
  card: WalletCard
  design: WalletDesign
  index: number
  open: boolean
  onToggle: () => void
}) {
  const primaryDark = shade(design.primary, 0.42)
  const status = STATUS[card.status]
  const tag = card.kind === 'skill' ? 'Skill Credential' : 'Training Credential'

  return (
    <article
      className="relative rounded-2xl shadow-lg ring-1 ring-black/5 transition-[transform,box-shadow] duration-300"
      style={{
        background: design.paper,
        marginTop: index === 0 ? 0 : -14,
        zIndex: open ? 100 : index + 1,
        transform: open ? 'translateY(0)' : undefined,
      }}
    >
      {/* ---- band (the always-visible peek + toggle) ---- */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-t-2xl px-4 py-3 text-left"
        style={{
          background: `linear-gradient(118deg, ${design.primary} 0%, ${primaryDark} 82%)`,
          borderBottom: `2px solid ${design.accent}`,
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="truncate text-[10px] font-bold tracking-[0.16em] text-white/80 uppercase"
              title={design.tenantName}
            >
              {design.tenantName}
            </span>
            <span className="text-[8px] font-semibold tracking-[0.22em] text-white/45 uppercase">
              {tag}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[15px] font-bold text-white" title={card.title}>
            {card.title}
          </div>
        </div>
        {design.tenantLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={design.tenantLogoUrl}
            alt=""
            className="max-h-6 max-w-[72px] rounded bg-white/95 object-contain px-1.5 py-1"
          />
        ) : null}
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur"
          title={status.label}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.dot }} />
          {status.label}
        </span>
      </button>

      {/* ---- expandable detail body ---- */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="flex gap-4 px-4 pt-4">
            {design.showPhoto ? (
              <div
                className="h-[88px] w-[70px] shrink-0 overflow-hidden rounded-md shadow ring-2 ring-white"
                style={{
                  background: `linear-gradient(135deg, ${tint(design.primary, 0.2)}, ${primaryDark})`,
                }}
              >
                {design.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={design.photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-white/90">
                    {initialsOf(design.holderName)}
                  </div>
                )}
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-extrabold text-slate-900">
                {design.holderName}
              </div>
              {design.employeeNo ? (
                <div className="mt-0.5 text-[11px] font-semibold tracking-wide text-slate-500">
                  NO. {design.employeeNo}
                </div>
              ) : null}
              {design.jobTitle ? (
                <div className="truncate text-xs text-slate-500">{design.jobTitle}</div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {card.code ? (
                  <span
                    className="rounded border px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ color: primaryDark, borderColor: tint(design.primary, 0.5) }}
                  >
                    {card.code}
                  </span>
                ) : null}
                {card.authority ? (
                  <span className="truncate text-[11px] text-slate-500">{card.authority}</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-3 flex gap-6 px-4">
            <div>
              <div
                className="text-[10px] font-bold tracking-[0.16em] uppercase"
                style={{ color: design.accent }}
              >
                {card.issuedLabel}
              </div>
              <div className="text-sm font-bold text-slate-900">{fmtDate(card.issuedOn)}</div>
            </div>
            <div>
              <div
                className="text-[10px] font-bold tracking-[0.16em] uppercase"
                style={{ color: design.accent }}
              >
                Expires
              </div>
              <div className="text-sm font-bold text-slate-900">{fmtDate(card.expiresOn)}</div>
            </div>
          </div>

          {design.showQr ? (
            <div className="mt-3 flex items-center gap-3 px-4">
              {card.qrDataUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.qrDataUrl}
                    alt="Verification QR"
                    className="h-16 w-16 rounded bg-white p-1 ring-1 ring-slate-200"
                  />
                  <div className="text-[11px] leading-snug text-slate-500">
                    <div className="font-semibold text-slate-700">Scan to verify</div>
                    Anyone can confirm this credential is genuine.
                  </div>
                </>
              ) : (
                <div className="text-[11px] leading-snug text-slate-500">
                  Download the card to generate its verifiable QR code.
                </div>
              )}
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-2 px-4 pb-4">
            <Link
              href={card.pdfHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: design.primary }}
            >
              <Download size={15} />
              Download card
            </Link>
            {card.verifyHref ? (
              <Link
                href={card.verifyHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
              >
                <ShieldCheck size={15} />
                Verify
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}
