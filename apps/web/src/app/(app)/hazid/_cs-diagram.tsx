'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Eraser, Save, Undo2 } from 'lucide-react'
import { Button } from '@beaconhs/ui'

// Confined-space sketchpad. Saves the canvas as a PNG data URL.
// Strokes are tracked client-side so we can implement undo without re-drawing
// the full history every move.
export function CSDiagram({
  assessmentId,
  initial,
  disabled,
  saveAction,
}: {
  assessmentId: string
  initial: string | null
  disabled?: boolean
  saveAction: (formData: FormData) => Promise<void>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const strokesRef = useRef<{ x: number; y: number }[][]>([])
  const [hasInk, setHasInk] = useState<boolean>(Boolean(initial))
  const [pending, start] = useTransition()
  const [dirty, setDirty] = useState(false)

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
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    if (initial) {
      const img = new Image()
      img.onload = () => {
        ctx.drawImage(img, 0, 0, rect.width, rect.height)
        setHasInk(true)
      }
      img.src = initial
    }
  }, [initial])

  function pt(e: React.PointerEvent): { x: number; y: number } {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function start_(e: React.PointerEvent) {
    if (disabled) return
    e.preventDefault()
    drawingRef.current = true
    lastRef.current = pt(e)
    canvasRef.current?.setPointerCapture(e.pointerId)
    strokesRef.current.push([lastRef.current])
  }

  function move(e: React.PointerEvent) {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cur = pt(e)
    const last = lastRef.current ?? cur
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(cur.x, cur.y)
    ctx.stroke()
    lastRef.current = cur
    const cur_stroke = strokesRef.current[strokesRef.current.length - 1]
    if (cur_stroke) cur_stroke.push(cur)
  }

  function end() {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastRef.current = null
    setHasInk(true)
    setDirty(true)
  }

  function clear() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    strokesRef.current = []
    setHasInk(false)
    setDirty(true)
  }

  function undo() {
    if (strokesRef.current.length === 0) return
    strokesRef.current.pop()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    for (const stroke of strokesRef.current) {
      ctx.beginPath()
      const first = stroke[0]
      if (!first) continue
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i]!.x, stroke[i]!.y)
      ctx.stroke()
    }
    setHasInk(strokesRef.current.length > 0)
    setDirty(true)
  }

  function save() {
    const canvas = canvasRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL('image/png')
    const fd = new FormData()
    fd.set('id', assessmentId)
    fd.set('field', 'csDiagramBase64')
    fd.set('value', hasInk ? dataUrl : '')
    start(async () => {
      await saveAction(fd)
      setDirty(false)
    })
  }

  return (
    <div className="space-y-2">
      <div className="relative rounded-md border border-slate-300 bg-white">
        <canvas
          ref={canvasRef}
          style={{ height: 320, width: '100%', touchAction: 'none' }}
          className="block rounded-md"
          onPointerDown={start_}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {!hasInk ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
            Sketch the space layout
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {hasInk ? 'Diagram captured' : 'No diagram'}
          {dirty ? ' · unsaved changes' : ''}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={undo} disabled={disabled}>
            <Undo2 size={12} /> Undo
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={disabled}>
            <Eraser size={12} /> Clear
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={disabled || pending || !dirty}>
            <Save size={12} /> {pending ? 'Saving…' : 'Save diagram'}
          </Button>
        </div>
      </div>
    </div>
  )
}
