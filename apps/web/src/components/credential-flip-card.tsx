'use client'

// A rendered credential card you can flip — the REAL front/back artboard HTML
// produced server-side by `renderDesignDocumentHtml`, embedded in isolated
// iframes and scaled to the container. Shared by /my/wallet and the public
// badge transcript so what's on screen is always identical to the printed
// CR80 card.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { RotateCw } from 'lucide-react'
import { cn } from '@beaconhs/ui'

const DPI = 96

export function CredentialFlipCard({
  frontHtml,
  backHtml,
  widthIn,
  heightIn,
  className,
}: {
  frontHtml: string
  backHtml: string
  widthIn: number
  heightIn: number
  className?: string
}) {
  const [flipped, setFlipped] = useState(false)
  const naturalW = widthIn * DPI
  const naturalH = heightIn * DPI
  const ratio = widthIn / heightIn

  return (
    <button
      type="button"
      onClick={() => setFlipped((f) => !f)}
      aria-label={flipped ? 'Show card front' : 'Show card back'}
      className={cn(
        'group relative w-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
        className,
      )}
      style={{ perspective: 1200 }}
    >
      <div
        className="relative w-full transition-transform duration-500 ease-out"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          aspectRatio: String(ratio),
        }}
      >
        <CardFace
          html={frontHtml}
          naturalW={naturalW}
          naturalH={naturalH}
          className="absolute inset-0"
          style={{ backfaceVisibility: 'hidden' }}
        />
        <CardFace
          html={backHtml}
          naturalW={naturalW}
          naturalH={naturalH}
          className="absolute inset-0"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
        />
      </div>
      <span className="pointer-events-none absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[10px] font-medium text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
        <RotateCw size={11} />
        Flip
      </span>
    </button>
  )
}

// Embed a single rendered artboard, scaled to its container width. The iframe
// isolates the design's CSS (units in inches/points) so it never collides with
// app styles; pointer-events are off so taps reach the flip button.
function CardFace({
  html,
  naturalW,
  naturalH,
  className,
  style,
}: {
  html: string
  naturalW: number
  naturalH: number
  className?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (w: number) => {
      if (w) setScale(w / naturalW)
    }
    update(el.clientWidth)
    const ro = new ResizeObserver((entries) => update(entries[0]?.contentRect.width ?? 0))
    ro.observe(el)
    return () => ro.disconnect()
  }, [naturalW])

  return (
    <div
      ref={ref}
      className={cn(
        'overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/10',
        className,
      )}
      style={style}
    >
      <iframe
        title=""
        srcDoc={html}
        scrolling="no"
        sandbox=""
        tabIndex={-1}
        style={{
          width: naturalW,
          height: naturalH,
          border: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
