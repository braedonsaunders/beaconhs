'use client'

import { useEffect, useRef, useState } from 'react'
import { Eraser, X } from 'lucide-react'
import { Button } from '@beaconhs/ui'

/**
 * HTML5 canvas signature pad. Handles mouse + touch + pen.
 * Emits a PNG data URL via onChange whenever the user lifts their pointer.
 */
export function SignaturePad({
  value,
  onChange,
  height = 140,
  className,
}: {
  value?: string | null
  onChange: (dataUrl: string | null) => void
  height?: number
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState<boolean>(Boolean(value))

  // Set up canvas + rehydrate from value
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * ratio
    canvas.height = rect.height * ratio
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 1.8
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    if (value) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height)
        setHasInk(true)
      }
      img.src = value
    } else {
      setHasInk(false)
    }
  }, [value])

  function ptFromEvent(e: PointerEvent | React.PointerEvent): { x: number; y: number } {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start(e: React.PointerEvent) {
    e.preventDefault()
    drawingRef.current = true
    lastRef.current = ptFromEvent(e)
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  function move(e: React.PointerEvent) {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cur = ptFromEvent(e)
    const last = lastRef.current ?? cur
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(cur.x, cur.y)
    ctx.stroke()
    lastRef.current = cur
  }

  function end() {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastRef.current = null
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    setHasInk(true)
    onChange(dataUrl)
  }

  function clear() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    setHasInk(false)
    onChange(null)
  }

  return (
    <div className={className}>
      <div className="relative rounded-md border border-slate-300 bg-white">
        <canvas
          ref={canvasRef}
          style={{ height, width: '100%', touchAction: 'none' }}
          className="block rounded-md"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {!hasInk ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
            Sign with your finger, pen, or mouse
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>{hasInk ? 'Signature captured' : 'Not signed yet'}</span>
        {hasInk ? (
          <Button type="button" variant="ghost" size="sm" onClick={clear}>
            <Eraser size={12} />
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )
}
