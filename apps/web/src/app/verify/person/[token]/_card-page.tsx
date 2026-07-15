import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// Shared layout for the public credential-card pages behind a badge transcript
// row — the rendered CR80 wallet card (flippable, pixel-identical to print)
// plus the credential's facts. Server component; data comes from the
// record/skill routes.

import Link from 'next/link'
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
        <h1 className="text-lg font-semibold text-red-700">
          <GeneratedText id="m_125b6e7b223e5b" />
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          <GeneratedText id="m_1e9f15eeda0d09" />
        </p>
        <Link href={backHref} className="mt-3 inline-block text-sm font-semibold text-teal-700">
          <GeneratedText id="m_1dd8e4c0284375" />
        </Link>
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
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-sm font-medium text-slate-300"
          >
            <ChevronLeft size={16} /> <GeneratedText id="m_1afc63325a11d7" />
          </Link>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg leading-snug font-bold">
                <GeneratedValue value={credentialName} />
              </h1>
              <div className="mt-0.5 text-sm text-slate-300">
                <GeneratedValue value={personName} />
              </div>
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
            <GeneratedText id="m_01c62d50d0cfac" />
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <GeneratedValue
              value={facts
                .filter((fact) => fact.value)
                .map((fact) => (
                  <div key={fact.label}>
                    <dt className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                      <GeneratedValue value={fact.label} />
                    </dt>
                    <dd className="mt-0.5 text-sm font-medium text-slate-800">
                      <GeneratedValue value={fact.value} />
                    </dd>
                  </div>
                ))}
            />
          </dl>
        </div>

        <GeneratedValue
          value={
            verifyHref ? (
              <Link
                href={verifyHref}
                className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
              >
                <ShieldCheck size={16} />
                <GeneratedText id="m_0f7d8d787f42d6" />
              </Link>
            ) : null
          }
        />
      </div>
    </main>
  )
}

export function factDay(value: string | null): string | null {
  return value ? formatDay(value) : null
}
