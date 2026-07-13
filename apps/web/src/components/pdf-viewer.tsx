'use client'

// App-themed PDF viewer (pdf.js) — replaces browser-native <iframe> PDF
// rendering so the chrome follows the app's light/dark theme instead of the
// browser's grey viewer. Pages render lazily (IntersectionObserver) onto
// devicePixelRatio-aware canvases; the toolbar carries page position and zoom.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Minus, Plus } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import type { PDFDocumentProxy } from 'pdfjs-dist'

const ZOOMS = [0.75, 1, 1.25, 1.5, 2]

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  return pdfjs
}

function PdfPage({
  doc,
  pageNumber,
  width,
  onVisible,
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  width: number
  onVisible: (page: number) => void
}) {
  const holderRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [shouldRender, setShouldRender] = useState(false)
  const [aspect, setAspect] = useState(11 / 8.5) // letter portrait until measured

  // Render only when (nearly) in view; report visibility for the page counter.
  useEffect(() => {
    const el = holderRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShouldRender(true)
            onVisible(pageNumber)
          }
        }
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [pageNumber, onVisible])

  useEffect(() => {
    if (!shouldRender || width <= 0) return
    let cancelled = false
    void (async () => {
      const page = await doc.getPage(pageNumber)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      setAspect(base.height / base.width)
      const scale = width / base.width
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const viewport = page.getViewport({ scale: scale * dpr })
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${width}px`
      canvas.style.height = `${width * (base.height / base.width)}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      await page.render({ canvasContext: ctx, viewport }).promise
    })()
    return () => {
      cancelled = true
    }
  }, [shouldRender, width, doc, pageNumber])

  return (
    <div
      ref={holderRef}
      data-page={pageNumber}
      className="mx-auto bg-white shadow-md ring-1 ring-slate-900/10 dark:ring-white/10"
      style={{ width, height: shouldRender ? undefined : width * aspect }}
    >
      <canvas ref={canvasRef} className="block" />
    </div>
  )
}

export function PdfViewer({ url, className }: { url: string; className?: string }) {
  const [resource, setResource] = useState<{
    url: string
    doc: PDFDocumentProxy | null
    error: string | null
  }>({ url, doc: null, error: null })
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [baseWidth, setBaseWidth] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const pdfjs = await loadPdfjs()
        const loaded = await pdfjs.getDocument({ url }).promise
        if (!cancelled) setResource({ url, doc: loaded, error: null })
      } catch (err) {
        if (!cancelled) {
          setResource({
            url,
            doc: null,
            error: err instanceof Error ? err.message : 'Could not load the PDF',
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url])

  const doc = resource.url === url ? resource.doc : null
  const error = resource.url === url ? resource.error : null

  // Page width tracks the container (minus padding), scaled by zoom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setBaseWidth(Math.max(280, Math.min(el.clientWidth - 48, 900)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onVisible = useCallback((page: number) => {
    setCurrentPage((prev) => (prev === page ? prev : page))
  }, [])

  const width = Math.round(baseWidth * zoom)

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <span className="tabular-nums">
          {doc ? `Page ${currentPage} of ${doc.numPages}` : 'Loading…'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Zoom out"
            className="grid h-6 w-6 place-items-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] ?? z)}
          >
            <Minus size={12} />
          </button>
          <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            className="grid h-6 w-6 place-items-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() =>
              setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] ?? z)
            }
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="app-scroll min-h-0 flex-1 overflow-auto bg-slate-100 dark:bg-slate-950"
      >
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-rose-600 dark:text-rose-400">
            {error}
          </div>
        ) : !doc ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-4 px-6 py-6">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage
                key={i + 1}
                doc={doc}
                pageNumber={i + 1}
                width={width}
                onVisible={onVisible}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
