'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

// Paged.js page preview for a PDF document template. Renders the builder's HTML
// filled with a REAL record's data (the most recent record of the template's
// subject, via loadPdfPreviewData → adapter.loadValues()); falls back to
// [placeholder] tokens when the tenant has no such record. Then paginates into
// real page boxes with @page size/margins + running header/footer + page numbers
// — a true print/PDF preview (Puppeteer prints the same @page CSS).

import { useEffect, useRef, useState } from 'react'
import { expandRepeatMarkers, renderTemplate } from '@beaconhs/email-render'
import { pdfPageCssContent } from '@/lib/pdf-page-content'
import { loadPdfPreviewData } from './_actions'

type MergeField = { key: string; label?: string }
type Collection = { key: string; label: string; fields: { key: string; label: string }[] }
type PaperSize = 'letter' | 'a4' | 'legal'
type Orientation = 'portrait' | 'landscape'

// Paged.js resolves size keywords case-SENSITIVELY ("letter"/"legal"
// lowercase, "A4" uppercase); Chromium print is case-insensitive, so these
// spellings work for both the preview and the printed PDF.
const SIZE_KEY: Record<PaperSize, string> = { letter: 'letter', a4: 'A4', legal: 'legal' }

function buildSample(
  mergeFields: MergeField[],
  collections: Collection[],
): Record<string, unknown> {
  const v: Record<string, unknown> = {}
  for (const f of mergeFields) v[f.key] = `[${f.key}]`
  for (const c of collections) {
    v[c.key] = [0, 1, 2].map(() => Object.fromEntries(c.fields.map((f) => [f.key, `[${f.key}]`])))
  }
  return v
}

function buildPageCss(
  paperSize: PaperSize,
  orientation: Orientation,
  marginMm: number,
  header: string,
  footer: string,
  sample: Record<string, unknown>,
): string {
  return `
    @page {
      size: ${SIZE_KEY[paperSize] ?? 'Letter'} ${orientation};
      margin: ${marginMm}mm;
      @top-center { content: ${pdfPageCssContent(header, sample)}; font-size: 9px; color: #64748b; }
      @bottom-center { content: ${pdfPageCssContent(footer, sample)}; font-size: 9px; color: #94a3b8; }
    }
    body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #0f172a; font-size: 13px; }
    /* Defensive: keep tables + long tokens (URLs) inside the page box. */
    table { max-width: 100%; border-collapse: collapse; }
    td, th { overflow-wrap: anywhere; word-break: break-word; }
    img { max-width: 100%; height: auto; }
  `
}

export default function PagedPreview({
  templateId,
  html,
  mergeFields,
  collections,
  paperSize,
  orientation,
  marginMm,
  headerHtml,
  footerHtml,
}: {
  templateId: string
  html: string
  mergeFields: MergeField[]
  collections: Collection[]
  paperSize: PaperSize
  orientation: Orientation
  marginMm: number
  headerHtml: string
  footerHtml: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // Real record values for the subject (null until loaded / when none exist).
  const [realData, setRealData] = useState<Record<string, unknown> | null>(null)
  const [sampleRef, setSampleRef] = useState<string | null>(null)

  // Fetch a real sample record once per template — independent of paper-size
  // tweaks so the (cheap) repaginate effect below doesn't re-query the DB.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await loadPdfPreviewData(templateId)
        if (cancelled) return
        setRealData(data.values)
        setSampleRef(data.sampleRef)
      } catch {
        if (!cancelled) {
          setRealData(null)
          setSampleRef(null)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [templateId])

  useEffect(() => {
    let cancelled = false
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    setPages(null)
    setErr(null)
    void (async () => {
      // React StrictMode (dev) runs this effect twice back-to-back. Yield once
      // so the superseded run observes `cancelled` (set by its cleanup) and
      // bails BEFORE invoking pagedjs — otherwise two Previewers race on the
      // same host node, each laying out into DOM the other has wiped, and the
      // pagination never settles ("Paginating…" forever).
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (cancelled) return
      try {
        // NOTE: pagedjs's published `exports.import`/`default` point at its raw
        // ESM source, which makes Turbopack bundle its CJS dependency tree
        // (event-emitter → es5-ext) itself — that interop breaks at runtime
        // (`contains.call is not a function`). A pnpm patch (see
        // patches/pagedjs@0.4.3.patch) repoints those conditions at the
        // pre-built, self-contained ESM bundle (dist/paged.esm.js), so this
        // plain import loads cleanly in the browser.
        const { Previewer } = await import('pagedjs')
        if (cancelled) return
        // Real record data when available; else [placeholder] tokens.
        const sample = realData ?? buildSample(mergeFields, collections)
        const rendered = renderTemplate(expandRepeatMarkers(html), sample, { escapeHtml: true })
        const css = buildPageCss(paperSize, orientation, marginMm, headerHtml, footerHtml, sample)
        const previewer = new Previewer()
        // CSS must go through the stylesheets argument — Paged.js's Polisher
        // only processes CSS passed there (an inline <style> in the flowed
        // content is never parsed, so the @page size/margins/margin-boxes
        // would be silently ignored and every preview would render as
        // portrait Letter with 1in margins).
        const stylesheet = Object.fromEntries([[window.location.href, css]])
        const result = await previewer.preview(rendered, [stylesheet], el)
        if (!cancelled) setPages((result as { total?: number })?.total ?? null)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
      if (el) el.innerHTML = ''
    }
  }, [
    html,
    paperSize,
    orientation,
    marginMm,
    headerHtml,
    footerHtml,
    mergeFields,
    collections,
    realData,
  ])

  return (
    <div className="h-full overflow-auto bg-slate-300 p-6 dark:bg-slate-800">
      <style>{`
        .paged-host .pagedjs_page { background:#fff; box-shadow:0 1px 10px rgba(0,0,0,.25); margin:0 auto 24px; }
      `}</style>
      <GeneratedValue
        value={
          err ? (
            <p className="mb-3 text-center text-sm text-red-600">
              <GeneratedText id="m_113ec1672ca48f" /> <GeneratedValue value={err} />
            </p>
          ) : pages != null ? (
            <p className="mb-3 text-center text-xs font-medium text-slate-600 dark:text-slate-300">
              <GeneratedValue value={pages} /> <GeneratedText id="m_095a79b2a25706" />
              <GeneratedValue
                value={pages === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />}
              />{' '}
              ·<GeneratedValue value={' '} />
              <GeneratedValue
                value={
                  sampleRef ? (
                    <GeneratedText id="m_15e62b473d2485" values={{ value0: sampleRef }} />
                  ) : (
                    <GeneratedText id="m_15f8afe7019723" />
                  )
                }
              />
            </p>
          ) : (
            <p className="mb-3 text-center text-xs text-slate-500">
              <GeneratedText id="m_0d7c240956c1d3" />
            </p>
          )
        }
      />
      <div ref={ref} className="paged-host" />
    </div>
  )
}
