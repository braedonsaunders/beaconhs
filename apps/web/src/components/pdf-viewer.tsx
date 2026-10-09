'use client'

import { GeneratedText, useGeneratedTranslations, GeneratedValue } from '@/i18n/generated'

// App-themed PDF viewer (pdf.js) — replaces browser-native <iframe> PDF
// rendering so the chrome follows the app's light/dark theme instead of the
// browser's grey viewer. Pages render lazily (IntersectionObserver) onto
// devicePixelRatio-aware canvases; the toolbar carries page position and zoom.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Minus, Plus } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'

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
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  width: number
}) {
  const holderRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [renderError, setRenderError] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)
  const [aspect, setAspect] = useState(11 / 8.5) // letter portrait until measured

  // Prefetch nearby pages without counting them as the page being read.
  useEffect(() => {
    const el = holderRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShouldRender(true)
          }
        }
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!shouldRender || width <= 0) return
    let cancelled = false
    let task: RenderTask | undefined
    setRenderError(false)
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
      task = page.render({ canvasContext: ctx, viewport })
      try {
        await task.promise
      } catch {
        if (!cancelled) setRenderError(true)
      }
    })().catch(() => {
      if (!cancelled) setRenderError(true)
    })
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [shouldRender, width, doc, pageNumber])

  return (
    <div
      ref={holderRef}
      data-page={pageNumber}
      className="mx-auto bg-white shadow-md ring-1 ring-slate-900/10 dark:ring-white/10"
      style={{ width, height: shouldRender ? undefined : width * aspect }}
    >
      {renderError ? (
        <p role="status" className="p-4 text-xs text-slate-600">
          <GeneratedText id="m_0a54816ad70979" />
        </p>
      ) : null}
      <canvas ref={canvasRef} className="block" />
    </div>
  )
}

export function PdfViewer({
  url,
  className,
  thumbnail = false,
}: {
  url: string
  className?: string
  thumbnail?: boolean
}) {
  const tGenerated = useGeneratedTranslations()
  const [resource, setResource] = useState<{
    url: string
    doc: PDFDocumentProxy | null
    error: string | null
  }>({ url, doc: null, error: null })
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const [baseWidth, setBaseWidth] = useState(0)

  useEffect(() => {
    let cancelled = false
    let loading: PDFDocumentLoadingTask | undefined
    void (async () => {
      try {
        const pdfjs = await loadPdfjs()
        if (cancelled) return
        loading = pdfjs.getDocument({ url })
        const loaded = await loading.promise
        if (!cancelled) {
          setResource({ url, doc: loaded, error: null })
          setCurrentPage(1)
        }
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
      void loading?.destroy()
    }
  }, [url])

  const doc = resource.url === url ? resource.doc : null
  const error = resource.url === url ? resource.error : null

  // Page width tracks the container (minus padding), scaled by zoom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () =>
      setBaseWidth(Math.max(80, Math.min(el.clientWidth - (thumbnail ? 0 : 48), 900)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [thumbnail])

  const updateCurrentPage = useCallback(() => {
    const viewport = scrollRef.current
    const pages = pagesRef.current
    if (!viewport || !pages) return
    const bounds = viewport.getBoundingClientRect()
    let visiblePage = 1
    let mostVisible = 0
    for (const page of pages.querySelectorAll<HTMLDivElement>('[data-page]')) {
      const rect = page.getBoundingClientRect()
      const visible = Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top)
      if (visible > mostVisible) {
        mostVisible = visible
        visiblePage = Number(page.dataset.page)
      }
    }
    if (mostVisible > 0) setCurrentPage(visiblePage)
  }, [])

  // Recalculate after lazy pages render, zoom changes, or the pane resizes.
  useEffect(() => {
    const pages = pagesRef.current
    if (!pages) return
    const observer = new ResizeObserver(updateCurrentPage)
    observer.observe(pages)
    return () => observer.disconnect()
  }, [doc, updateCurrentPage])

  const width = Math.round(baseWidth * zoom)

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {!thumbnail ? (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          <span className="tabular-nums">
            <GeneratedValue
              value={
                doc ? (
                  <GeneratedText
                    id="m_082902b0a0cd79"
                    values={{ value0: currentPage, value1: doc.numPages }}
                  />
                ) : (
                  <GeneratedText id="m_0e65697ec32c03" />
                )
              }
            />
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label={tGenerated('m_00a262469a10eb')}
              className="grid h-6 w-6 place-items-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] ?? z)}
            >
              <Minus size={12} />
            </button>
            <span className="w-10 text-center tabular-nums">
              <GeneratedValue value={Math.round(zoom * 100)} />%
            </span>
            <button
              type="button"
              aria-label={tGenerated('m_12713157ff4ed0')}
              className="grid h-6 w-6 place-items-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() =>
                setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] ?? z)
              }
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
      ) : null}
      <div
        ref={scrollRef}
        onScroll={updateCurrentPage}
        className={cn(
          'app-scroll min-h-0 flex-1 bg-slate-100 dark:bg-slate-950',
          thumbnail ? 'overflow-hidden' : 'overflow-auto',
        )}
      >
        <GeneratedValue
          value={
            error ? (
              <div className="flex h-full items-center justify-center p-6 text-sm text-rose-600 dark:text-rose-400">
                <GeneratedValue value={error} />
              </div>
            ) : !doc ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 size={20} className="animate-spin text-slate-400" />
              </div>
            ) : (
              <div ref={pagesRef} className={thumbnail ? '' : 'space-y-4 px-6 py-6'}>
                <GeneratedValue
                  value={Array.from({ length: thumbnail ? 1 : doc.numPages }, (_, i) => (
                    <PdfPage key={i + 1} doc={doc} pageNumber={i + 1} width={width} />
                  ))}
                />
              </div>
            )
          }
        />
      </div>
    </div>
  )
}
