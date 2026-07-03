'use client'

// SignaturePad — a canvas-based "sign here with your finger / stylus / mouse"
// primitive. Outputs a PNG data-url via `onChange(value)`; pass `null` to
// represent an empty canvas. Standalone — does not depend on the upload
// helpers; the consumer is responsible for uploading the data-url if needed.
//
// Example:
//
//   function MySignatureField() {
//     const [value, setValue] = useState<string | null>(null)
//     return (
//       <div className="space-y-2">
//         <SignaturePad value={value} onChange={setValue} />
//         {value ? (
//           <button onClick={() => uploadDataUrl(value)}>Save</button>
//         ) : null}
//       </div>
//     )
//   }
//
// Pointer events are used directly so a single handler covers mouse, touch,
// and stylus input. Strokes are rendered with quadratic-curve interpolation
// for smoothness, and stroke width is modulated lightly by pointer velocity
// (slower = thicker) to feel like ink.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Button } from './button'
import { cn } from './utils'

export type SignaturePadProps = {
  /** Current value as a PNG data-url, or `null` if empty. */
  value: string | null
  /** Called with the new data-url after each completed stroke, or `null` on clear. */
  onChange: (value: string | null) => void
  /** Disable drawing. Renders `value` (if any) as a static image. */
  disabled?: boolean
  /** Canvas height in CSS pixels. Default 160. */
  height?: number
  /** Extra classes on the outer wrapper. */
  className?: string
  /** Accessibility label for the canvas. Default "Signature". */
  ariaLabel?: string
}

const STROKE_COLOR = '#0f172a' // slate-900
const STROKE_BASE_WIDTH = 1.8
const STROKE_MAX_WIDTH = 3.2
const STROKE_MIN_WIDTH = 1.1
const VELOCITY_FILTER = 0.65 // smoothing factor on velocity (0..1)
const DEBOUNCE_MS = 100

type Point = { x: number; y: number; t: number }

export function SignaturePad({
  value,
  onChange,
  disabled = false,
  height = 160,
  className,
  ariaLabel = 'Signature',
}: SignaturePadProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelId = useId()

  // Latest props as refs so stable event handlers can read them.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const valueRef = useRef<string | null>(value)
  useEffect(() => {
    valueRef.current = value
  }, [value])

  // Drawing state — kept in refs to avoid re-renders during a stroke.
  const drawingRef = useRef(false)
  // True once the user has actually drawn on this canvas. Until then, resize
  // must restore the incoming `value` prop rather than a (possibly blank)
  // snapshot taken from a default-sized 300×150 canvas on first mount.
  const hasDrawnRef = useRef(false)
  const activePointerRef = useRef<number | null>(null)
  const lastPointRef = useRef<Point | null>(null)
  const lastMidRef = useRef<{ x: number; y: number } | null>(null)
  const lastWidthRef = useRef(STROKE_BASE_WIDTH)
  const lastVelocityRef = useRef(0)
  const dprRef = useRef(1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [hasInk, setHasInk] = useState<boolean>(!!value)

  const getCtx = () => canvasRef.current?.getContext('2d') ?? null

  // Load a data-url onto the canvas (used for initial value + resize preservation).
  const loadDataUrl = useCallback(
    (dataUrl: string) =>
      new Promise<void>((resolve) => {
        const canvas = canvasRef.current
        const ctx = getCtx()
        if (!canvas || !ctx) {
          resolve()
          return
        }
        const img = new Image()
        img.onload = () => {
          // The image was captured at CSS-pixel dimensions, so paint it back
          // sized to the current CSS box; the context transform handles DPR.
          ctx.drawImage(img, 0, 0, canvas.width / dprRef.current, canvas.height / dprRef.current)
          resolve()
        }
        img.onerror = () => resolve()
        img.src = dataUrl
      }),
    [],
  )

  // Resize the backing store to match the container width and DPR, preserving
  // existing strokes by snapshotting before and restoring after.
  const resizeCanvas = useCallback(async () => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = Math.max(1, window.devicePixelRatio || 1)
    const cssWidth = Math.max(1, Math.floor(wrap.clientWidth))
    const cssHeight = Math.max(1, Math.floor(height))

    // Already correctly sized — bail (avoids the resize loop on first mount).
    if (
      canvas.width === Math.round(cssWidth * dpr) &&
      canvas.height === Math.round(cssHeight * dpr) &&
      dprRef.current === dpr
    ) {
      return
    }

    // Snapshot current pixels so we can repaint after resize — but only once
    // the user has drawn. Before that, an initial-value pad must restore the
    // `value` prop, not a blank snapshot from the default-sized canvas.
    let snapshot: string | null = null
    if (hasDrawnRef.current && canvas.width > 0 && canvas.height > 0) {
      try {
        snapshot = canvas.toDataURL('image/png')
      } catch {
        snapshot = null
      }
    }

    dprRef.current = dpr
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // Scale once so all drawing math can be in CSS pixels.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = STROKE_COLOR
    ctx.fillStyle = STROKE_COLOR
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    // Prefer in-memory snapshot over the prop value to avoid losing strokes
    // that haven't yet been debounced into onChange.
    const toRestore = snapshot ?? valueRef.current
    if (toRestore) {
      await loadDataUrl(toRestore)
    }
  }, [height, loadDataUrl])

  // Initial sizing + window resize listener.
  useLayoutEffect(() => {
    void resizeCanvas()
    const onResize = () => void resizeCanvas()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [resizeCanvas])

  // If `value` changes externally (e.g. parent reset), repaint.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx) return
    const cssWidth = canvas.width / dprRef.current
    const cssHeight = canvas.height / dprRef.current

    if (value === null) {
      ctx.clearRect(0, 0, cssWidth, cssHeight)
      setHasInk(false)
      return
    }
    // Only repaint if this value didn't originate from our own onChange — we
    // detect that by comparing to the most recent emitted value.
    if (value === lastEmittedRef.current) return
    ctx.clearRect(0, 0, cssWidth, cssHeight)
    void loadDataUrl(value).then(() => setHasInk(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, loadDataUrl])

  // Initialized to null (not `value`) so the external-value repaint effect
  // runs once on mount and actually paints an initial signature.
  const lastEmittedRef = useRef<string | null>(null)

  const emit = useCallback((next: string | null) => {
    lastEmittedRef.current = next
    onChangeRef.current(next)
  }, [])

  const scheduleEmit = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        emit(canvas.toDataURL('image/png'))
      } catch {
        // Tainted canvas etc — silently skip.
      }
    }, DEBOUNCE_MS)
  }, [emit])

  // --- Drawing ---------------------------------------------------------------

  const pointFromEvent = (e: PointerEvent): Point => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      t: e.timeStamp,
    }
  }

  // Variable stroke width: slower pointer → thicker line. Velocity is smoothed
  // with a simple low-pass filter so quick jitter doesn't make the line pulse.
  const computeWidth = (velocity: number) => {
    const smoothed = VELOCITY_FILTER * velocity + (1 - VELOCITY_FILTER) * lastVelocityRef.current
    lastVelocityRef.current = smoothed
    // Map velocity to width: 0 px/ms → max, 1.5+ px/ms → min.
    const t = Math.min(1, smoothed / 1.5)
    return STROKE_MAX_WIDTH - (STROKE_MAX_WIDTH - STROKE_MIN_WIDTH) * t
  }

  const onPointerDown = (e: PointerEvent) => {
    if (disabled) return
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx) return
    // Ignore secondary pointers while one is already drawing.
    if (activePointerRef.current !== null) return

    activePointerRef.current = e.pointerId
    drawingRef.current = true
    hasDrawnRef.current = true
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // Some browsers throw if the pointer can't be captured — non-fatal.
    }

    const p = pointFromEvent(e)
    lastPointRef.current = p
    lastMidRef.current = { x: p.x, y: p.y }
    lastVelocityRef.current = 0
    lastWidthRef.current = STROKE_BASE_WIDTH

    // Paint a dot at the starting point so taps produce visible ink.
    ctx.beginPath()
    ctx.arc(p.x, p.y, STROKE_BASE_WIDTH / 2, 0, Math.PI * 2)
    ctx.fill()

    setHasInk(true)
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!drawingRef.current) return
    if (e.pointerId !== activePointerRef.current) return
    const ctx = getCtx()
    const prev = lastPointRef.current
    const prevMid = lastMidRef.current
    if (!ctx || !prev || !prevMid) return

    const p = pointFromEvent(e)
    const dx = p.x - prev.x
    const dy = p.y - prev.y
    const dist = Math.hypot(dx, dy)
    const dt = Math.max(1, p.t - prev.t)
    const velocity = dist / dt // px per ms
    const targetWidth = computeWidth(velocity)
    // Smooth width changes between consecutive segments.
    const width = (lastWidthRef.current + targetWidth) / 2

    // Quadratic curve through the previous mid-point, using `prev` as the
    // control point and the new mid-point as the destination.
    const mid = { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 }
    ctx.beginPath()
    ctx.lineWidth = width
    ctx.moveTo(prevMid.x, prevMid.y)
    ctx.quadraticCurveTo(prev.x, prev.y, mid.x, mid.y)
    ctx.stroke()

    lastPointRef.current = p
    lastMidRef.current = mid
    lastWidthRef.current = width
  }

  const finishStroke = (e: PointerEvent) => {
    if (e.pointerId !== activePointerRef.current) return
    const canvas = canvasRef.current
    const ctx = getCtx()
    const prev = lastPointRef.current
    const prevMid = lastMidRef.current

    if (drawingRef.current && ctx && prev && prevMid) {
      // Close out the curve to the final point so the last segment isn't lost.
      ctx.beginPath()
      ctx.lineWidth = lastWidthRef.current
      ctx.moveTo(prevMid.x, prevMid.y)
      ctx.lineTo(prev.x, prev.y)
      ctx.stroke()
    }

    drawingRef.current = false
    activePointerRef.current = null
    lastPointRef.current = null
    lastMidRef.current = null

    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }

    scheduleEmit()
  }

  // Attach pointer listeners imperatively so we get raw PointerEvent objects
  // and can use `{ passive: false }` where useful.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (disabled) return

    const down = (e: PointerEvent) => onPointerDown(e)
    const move = (e: PointerEvent) => onPointerMove(e)
    const up = (e: PointerEvent) => finishStroke(e)

    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('pointerleave', up)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('pointerleave', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled])

  // Clean up any pending debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = getCtx()
    if (!canvas || !ctx) return
    const cssWidth = canvas.width / dprRef.current
    const cssHeight = canvas.height / dprRef.current
    ctx.clearRect(0, 0, cssWidth, cssHeight)
    setHasInk(false)
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    emit(null)
  }, [emit])

  return (
    <div ref={wrapRef} className={cn('w-full', className)}>
      <div
        className={cn(
          // The signing surface stays white in both themes: the ink is dark
          // (slate-900) and the exported PNG is dark-on-transparent for PDFs,
          // so a dark backing would hide the stroke while signing and viewing.
          'relative w-full overflow-hidden rounded-md border bg-white',
          disabled ? 'border-slate-200 dark:border-slate-800' : 'border-slate-300 dark:border-slate-700',
        )}
        style={{ height }}
      >
        {disabled && value ? (
          // Static image render in disabled mode so the underlying canvas
          // (and its pointer handlers) doesn't have to participate.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={ariaLabel}
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={ariaLabel}
              aria-describedby={labelId}
              className={cn(
                'block h-full w-full',
                disabled ? 'cursor-not-allowed opacity-60' : 'cursor-crosshair',
              )}
              style={{ touchAction: 'none' }}
            />
            {/* Empty-state baseline + hint, hidden once the user has signed. */}
            {!hasInk && !disabled ? (
              <div className="pointer-events-none absolute inset-0">
                <div
                  className="absolute right-4 left-4 border-t border-dashed border-slate-200"
                  style={{ top: `${(2 / 3) * 100}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs text-slate-400">Sign here</span>
                </div>
              </div>
            ) : null}
          </>
        )}
        {/* Visually-hidden status for screen readers. */}
        <span id={labelId} className="sr-only">
          {hasInk ? `${ariaLabel} provided.` : `${ariaLabel} empty.`}
        </span>
      </div>

      {!disabled ? (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {hasInk ? ' ' : 'Sign above with your finger, stylus, or mouse.'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={!hasInk}
            aria-label="Clear signature"
          >
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  )
}
