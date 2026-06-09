'use client'

// Image with drag-to-resize handles + left/center/right alignment, on top of
// the base @tiptap/extension-image. Width is stored as a px style; alignment as
// a data-align attribute the PDF template understands.
import Image from '@tiptap/extension-image'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { useRef } from 'react'
import { cn } from '@beaconhs/ui'

function ImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const width = node.attrs.width as string | null
  const align = (node.attrs.align as 'left' | 'center' | 'right') || 'left'
  const imgRef = useRef<HTMLImageElement>(null)

  function startResize(e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const img = imgRef.current
    if (!img) return
    const startX = e.clientX
    const startWidth = img.offsetWidth
    function onMove(ev: PointerEvent) {
      const next = Math.max(40, Math.round(startWidth + (ev.clientX - startX)))
      updateAttributes({ width: `${next}px` })
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <NodeViewWrapper
      className={cn(
        'pm-image group relative my-3 flex',
        align === 'center' && 'justify-center',
        align === 'right' && 'justify-end',
      )}
      data-align={align}
    >
      <div className="relative inline-block">
        <img
          ref={imgRef}
          src={node.attrs.src ?? ''}
          alt={node.attrs.alt ?? ''}
          title={node.attrs.title ?? undefined}
          style={{ width: width ?? 'auto' }}
          draggable={false}
          className={cn('block max-w-full rounded', selected && 'ring-2 ring-teal-500')}
        />
        {editor.isEditable ? (
          <>
            <div className="absolute left-1 top-1 hidden gap-0.5 rounded bg-white/95 p-0.5 shadow ring-1 ring-slate-200 group-hover:flex">
              {(['left', 'center', 'right'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  title={`Align ${a}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    updateAttributes({ align: a })
                  }}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium capitalize',
                    align === a ? 'bg-teal-100 text-teal-800' : 'text-slate-500 hover:bg-slate-100',
                  )}
                >
                  {a}
                </button>
              ))}
            </div>
            <span
              onPointerDown={startResize}
              className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-white bg-teal-500 opacity-0 shadow group-hover:opacity-100"
            />
          </>
        ) : null}
      </div>
    </NodeViewWrapper>
  )
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).style.width || el.getAttribute('width') || null,
        renderHTML: (attrs) => (attrs.width ? { style: `width: ${attrs.width}` } : {}),
      },
      align: {
        default: 'left',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-align') || 'left',
        renderHTML: (attrs) => (attrs.align ? { 'data-align': attrs.align } : {}),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})
