'use client'

// Slideshow playback — keyboard, fullscreen, notes, progress. Used by the
// learner player (inline stage) and the studio Present overlay.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  StickyNote,
} from 'lucide-react'
import type { Slide } from '@beaconhs/db/schema'
import { SlideView } from './slide-view'

export function SlidePlayer({
  slides,
  attachmentUrls = {},
  onReachedEnd,
  className = '',
}: {
  slides: Slide[]
  attachmentUrls?: Record<string, string | null | undefined>
  onReachedEnd?: () => void
  className?: string
}) {
  const [idx, setIdx] = useState(0)
  const [showNotes, setShowNotes] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const reachedEndRef = useRef(false)

  const total = slides.length
  const slide = slides[Math.min(idx, total - 1)] ?? null

  const go = useCallback(
    (delta: number) => {
      setIdx((cur) => Math.max(0, Math.min(total - 1, cur + delta)))
    },
    [total],
  )

  useEffect(() => {
    if (total > 0 && idx >= total - 1 && !reachedEndRef.current) {
      reachedEndRef.current = true
      onReachedEnd?.()
    }
  }, [idx, total, onReachedEnd])

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  function toggleFullscreen() {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
      e.preventDefault()
      go(1)
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault()
      go(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setIdx(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setIdx(total - 1)
    } else if (e.key === 'f') {
      toggleFullscreen()
    }
  }

  if (total === 0) {
    return (
      <div className="grid aspect-[16/9] w-full place-items-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
        No slides yet.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={`group relative flex flex-col overflow-hidden rounded-lg bg-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
        isFullscreen ? 'h-full justify-center' : ''
      } ${className}`}
    >
      {/* progress */}
      <div className="absolute inset-x-0 top-0 z-10 h-0.5 bg-white/10">
        <div
          className="h-full bg-teal-400 transition-all duration-300"
          style={{ width: `${((idx + 1) / total) * 100}%` }}
        />
      </div>

      <div className={isFullscreen ? 'mx-auto w-full max-w-[177.78vh]' : ''}>
        {slide ? <SlideView slide={slide} attachmentUrls={attachmentUrls} /> : null}
      </div>

      {/* click zones */}
      <button
        type="button"
        aria-label="Previous slide"
        onClick={() => go(-1)}
        className="absolute inset-y-10 left-0 w-1/4 cursor-w-resize opacity-0"
      />
      <button
        type="button"
        aria-label="Next slide"
        onClick={() => go(1)}
        className="absolute inset-y-10 right-0 w-1/4 cursor-e-resize opacity-0"
      />

      {/* control bar */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={idx === 0}
          aria-label="Previous"
          className="grid h-8 w-8 place-items-center rounded-md text-white/90 hover:bg-white/15 disabled:opacity-30"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={idx >= total - 1}
          aria-label="Next"
          className="grid h-8 w-8 place-items-center rounded-md text-white/90 hover:bg-white/15 disabled:opacity-30"
        >
          <ChevronRight size={18} />
        </button>
        <span className="ml-1 text-xs tabular-nums text-white/80">
          {idx + 1} / {total}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {slide?.notes ? (
            <button
              type="button"
              onClick={() => setShowNotes((v) => !v)}
              aria-label="Toggle notes"
              className={`grid h-8 w-8 place-items-center rounded-md hover:bg-white/15 ${
                showNotes ? 'text-amber-300' : 'text-white/90'
              }`}
            >
              <StickyNote size={15} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label="Toggle fullscreen"
            className="grid h-8 w-8 place-items-center rounded-md text-white/90 hover:bg-white/15"
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>

      {showNotes && slide?.notes ? (
        <div className="absolute inset-x-3 bottom-12 z-10 max-h-[35%] overflow-y-auto rounded-md bg-black/80 px-3 py-2 text-xs leading-relaxed text-amber-100 backdrop-blur">
          {slide.notes}
        </div>
      ) : null}
    </div>
  )
}
