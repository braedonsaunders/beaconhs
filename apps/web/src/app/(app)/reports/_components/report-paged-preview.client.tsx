'use client'

// True print preview for a report document. Paginates the server-rendered
// document body into real page boxes with Paged.js — @page size, margins, and
// running footer page numbers — so what you see here is exactly what the
// exported / scheduled PDF prints (Puppeteer consumes the same layout CSS).

import { useEffect, useRef, useState } from 'react'
import { cn } from '@beaconhs/ui'

export function ReportPagedPreview({
  bodyHtml,
  pageCss,
  caption,
  className,
}: {
  /** Fully rendered document body (renderReportDocumentBodyHtml output). */
  bodyHtml: string
  /** @page CSS (buildReportPageCss with marginBoxes for live page numbers). */
  pageCss: string
  /** Optional note appended to the page-count line (e.g. a row-cap notice). */
  caption?: string | null
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

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
      // pagination never settles.
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (cancelled) return
      try {
        // NOTE: keep this import dynamic. pagedjs is pnpm-patched to load its
        // prebuilt ESM bundle (patches/pagedjs@0.4.3.patch) — a static import
        // regresses the Turbopack CJS-interop crash.
        const { Previewer } = await import('pagedjs')
        if (cancelled) return
        const previewer = new Previewer()
        const result = await previewer.preview(`<style>${pageCss}</style>${bodyHtml}`, [], el)
        if (!cancelled) setPages((result as { total?: number })?.total ?? null)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
      if (el) el.innerHTML = ''
    }
  }, [bodyHtml, pageCss])

  return (
    <div
      className={cn(
        'app-scroll h-full overflow-auto bg-slate-200 p-4 sm:p-6 dark:bg-slate-950',
        className,
      )}
    >
      {/* Paper is always white — printed output has no dark mode. */}
      <style>{`
        .bhs-paged-host .pagedjs_page { background:#fff; box-shadow:0 1px 10px rgba(0,0,0,.25); margin:0 auto 24px; }
      `}</style>
      {err ? (
        <p className="mb-3 text-center text-sm text-red-600 dark:text-red-400">
          Preview error: {err}
        </p>
      ) : pages != null ? (
        <p className="mb-3 text-center text-xs font-medium text-slate-600 dark:text-slate-300">
          {pages} page{pages === 1 ? '' : 's'}
          {caption ? (
            <span className="font-normal text-slate-500 dark:text-slate-400"> · {caption}</span>
          ) : null}
        </p>
      ) : (
        <p className="mb-3 text-center text-xs text-slate-500 dark:text-slate-400">Paginating…</p>
      )}
      <div ref={ref} className="bhs-paged-host" />
    </div>
  )
}
