// Shared layout for the public credential-card pages behind a badge transcript
// row — the rendered CR80 wallet card (flippable, pixel-identical to print)
// plus the credential's facts. Server component; data comes from the
// record/skill routes.

import { ChevronLeft, ShieldCheck } from 'lucide-react'
import QRCode from 'qrcode'
import { CredentialFlipCard } from '@/components/credential-flip-card'
import { formatDay, type Standing } from './_format'
import { StandingChip } from './_transcript-list'

export async function verifyQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 6,
    color: { dark: '#0f172a', light: '#ffffff' },
  })
}

export function PublicCardNotFound({ backHref }: { backHref: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-red-700">Credential not found</h1>
        <p className="mt-1 text-sm text-slate-600">
          This credential does not exist on the badge holder&apos;s record.
        </p>
        <a href={backHref} className="mt-3 inline-block text-sm font-semibold text-teal-700">
          Back to the live record
        </a>
      </div>
    </main>
  )
}

export function PublicCardPage({
  backHref,
  personName,
  credentialName,
  standing,
  frontHtml,
  backHtml,
  widthIn,
  heightIn,
  facts,
  verifyHref,
}: {
  backHref: string
  personName: string
  credentialName: string
  standing: Standing
  frontHtml: string
  backHtml: string
  widthIn: number
  heightIn: number
  facts: { label: string; value: string | null }[]
  verifyHref: string | null
}) {
  return (
    <main className="min-h-screen bg-slate-100 pb-10">
      <header className="bg-slate-900 px-4 pt-6 pb-12 text-white">
        <div className="mx-auto max-w-md">
          <a
            href={backHref}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-300"
          >
            <ChevronLeft size={16} /> Live training record
          </a>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg leading-snug font-bold">{credentialName}</h1>
              <div className="mt-0.5 text-sm text-slate-300">{personName}</div>
            </div>
            <StandingChip standing={standing} />
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-7 max-w-md space-y-5 px-4">
        <div>
          <CredentialFlipCard
            frontHtml={frontHtml}
            backHtml={backHtml}
            widthIn={widthIn}
            heightIn={heightIn}
          />
          <p className="mt-2 text-center text-[11px] text-slate-400">
            Tap the card to flip it. This is the card exactly as printed.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {facts
              .filter((fact) => fact.value)
              .map((fact) => (
                <div key={fact.label}>
                  <dt className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                    {fact.label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-slate-800">{fact.value}</dd>
                </div>
              ))}
          </dl>
        </div>

        {verifyHref ? (
          <a
            href={verifyHref}
            className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
          >
            <ShieldCheck size={16} />
            Verify this certificate
          </a>
        ) : null}
      </div>
    </main>
  )
}

export function factDay(value: string | null): string | null {
  return value ? formatDay(value) : null
}
