'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// App-themed PDF viewer (pdf.js) — replaces browser-native <iframe> PDF
// rendering so the chrome follows the app's light/dark theme instead of the
// browser's grey viewer. Pages render lazily (IntersectionObserver) onto
// devicePixelRatio-aware canvases; the toolbar carries page position and zoom.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Loader2, Minus, Plus, Maximize, Minimize, RotateCcw } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { createPortal } from 'react-dom'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 5

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
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(8_000_000 / (width * width * (base.height / base.width))),
      )
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
  const t = useGeneratedValueTranslations()
  const [fullscreen, setFullscreen] = useState(false)
  const [resource, setResource] = useState<{
    url: string
    doc: PDFDocumentProxy | null
    error: string | null
  }>({ url, doc: null, error: null })
  const [zoom, setZoom] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const fullscreenButton = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const [baseWidth, setBaseWidth] = useState(0)
  const pendingAnchor = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const geometry = useRef({ baseWidth: 0, zoom: 1 })
  const changeZoom = useCallback((next: number, point?: { x: number; y: number }) => {
    const el = scrollRef.current
    const old = geometry.current
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next))
    if (el && old.baseWidth > 0) {
      const left = point?.x ?? el.clientWidth / 2,
        top = point?.y ?? el.clientHeight / 2
      pendingAnchor.current = {
        x: (el.scrollLeft + left) / (old.baseWidth * old.zoom),
        y: (el.scrollTop + top) / (old.baseWidth * old.zoom),
        left,
        top,
      }
    }
    setZoom(clamped)
  }, [])
  const toggleFullscreen = useCallback(() => {
    const el = scrollRef.current,
      old = geometry.current
    if (el && old.baseWidth > 0)
      pendingAnchor.current = {
        x: el.scrollLeft / (old.baseWidth * old.zoom),
        y: el.scrollTop / (old.baseWidth * old.zoom),
        left: 0,
        top: 0,
      }
    setFullscreen((value) => !value)
  }, [])
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current,
      el = scrollRef.current
    if (anchor && el) {
      el.scrollLeft = anchor.x * baseWidth * zoom - anchor.left
      el.scrollTop = anchor.y * baseWidth * zoom - anchor.top
      pendingAnchor.current = null
    }
    geometry.current = { baseWidth, zoom }
  }, [baseWidth, zoom, fullscreen])
  useEffect(() => {
    if (!fullscreen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    fullscreenButton.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        toggleFullscreen()
        requestAnimationFrame(() => fullscreenButton.current?.focus())
      }
      if (event.key === 'Tab') {
        const buttons = fullscreenButton.current
          ?.closest('[data-pdf-viewer]')
          ?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
        if (!buttons?.length) return
        const first = buttons[0]!,
          last = buttons[buttons.length - 1]!
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', escape)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', escape)
    }
  }, [fullscreen, toggleFullscreen])
  useEffect(() => {
    const el = scrollRef.current
    if (!el || thumbnail) return
    let pinch: { distance: number; zoom: number } | null = null
    const distance = (event: TouchEvent) =>
      Math.hypot(
        event.touches[0]!.clientX - event.touches[1]!.clientX,
        event.touches[0]!.clientY - event.touches[1]!.clientY,
      )
    const start = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        event.preventDefault()
        pinch = { distance: distance(event), zoom: geometry.current.zoom }
      }
    }
    const move = (event: TouchEvent) => {
      if (!pinch || event.touches.length !== 2) return
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      changeZoom((pinch.zoom * distance(event)) / pinch.distance, {
        x: (event.touches[0]!.clientX + event.touches[1]!.clientX) / 2 - rect.left,
        y: (event.touches[0]!.clientY + event.touches[1]!.clientY) / 2 - rect.top,
      })
    }
    const end = () => {
      pinch = null
    }
    el.addEventListener('touchstart', start, { passive: false })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [changeZoom, thumbnail, fullscreen])

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
    const measure = () => {
      const next = Math.max(80, Math.min(el.clientWidth - (thumbnail ? 0 : 16), 1200))
      const old = geometry.current
      if (old.baseWidth > 0 && next !== old.baseWidth)
        pendingAnchor.current = {
          x: el.scrollLeft / (old.baseWidth * old.zoom),
          y: el.scrollTop / (old.baseWidth * old.zoom),
          left: 0,
          top: 0,
        }
      setBaseWidth(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [thumbnail, fullscreen])

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
  }, [doc, updateCurrentPage, fullscreen])

  const width = Math.round(baseWidth * zoom)

  const viewer = (
    <div
      data-pdf-viewer
      role={fullscreen ? 'dialog' : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? t('PDF document') : undefined}
      className={cn(
        'flex min-h-0 flex-col',
        className,
        fullscreen && 'fixed inset-0 z-[100] h-dvh bg-white dark:bg-slate-950',
      )}
    >
      {!thumbnail ? (
        <div className="flex min-h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
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
              className="grid h-11 w-11 shrink-0 place-items-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => changeZoom(zoom - 0.25)}
            >
              <Minus size={12} />
            </button>
            <span className="w-10 text-center tabular-nums">
              <GeneratedValue value={Math.round(zoom * 100)} />%
            </span>
            <button
              type="button"
              aria-label={tGenerated('m_12713157ff4ed0')}
              className="grid h-11 w-11 shrink-0 place-items-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => changeZoom(zoom + 0.25)}
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              className="grid h-11 w-11 shrink-0 place-items-center rounded"
              aria-label={t('Fit width')}
              onClick={() => changeZoom(1)}
            >
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              className="grid h-11 w-11 shrink-0 place-items-center rounded"
              ref={fullscreenButton}
              aria-label={t(fullscreen ? 'Exit full screen' : 'Full screen')}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
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
              <div ref={pagesRef} className={thumbnail ? '' : 'min-w-max space-y-4 px-2 py-3'}>
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
  return fullscreen ? createPortal(viewer, document.body) : viewer
}
