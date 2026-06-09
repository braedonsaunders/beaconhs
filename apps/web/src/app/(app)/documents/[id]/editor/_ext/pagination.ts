// Content-flow pagination. Measures the rendered top-level blocks and inserts
// "page spacer" widget decorations so content visually breaks across fixed-size
// pages whose geometry (content width + height + margins) is identical to the
// PDF — so the editor preview tracks the PDF output.
//
// Defensive: if geometry/measurement isn't available it inserts nothing, so the
// editor always works. Decorations are view-only (never written to the doc).
//
// Measurement notes:
//  - We read page geometry from CSS vars (set by the canvas) in CSS px.
//  - The canvas scales with CSS `zoom`; getBoundingClientRect returns scaled px,
//    so we divide by the detected zoom (rect width ÷ --page-w) to get CSS px.
//  - Our own spacers shift later blocks, so we subtract accumulated spacer
//    height to recover each block's *natural* (un-paginated) position.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

export const paginationKey = new PluginKey('pagination')

type Break = { pos: number; spacer: number }

function spacerElement(height: number): HTMLElement {
  const el = document.createElement('div')
  el.className = 'pm-page-spacer'
  el.setAttribute('data-page-spacer', 'true')
  el.contentEditable = 'false'
  el.style.height = `${Math.max(0, Math.round(height))}px`
  return el
}

function computeBreaks(view: EditorView): Break[] {
  const dom = view.dom as HTMLElement
  const cs = getComputedStyle(dom)
  const cssPH = parseFloat(cs.getPropertyValue('--page-content-h'))
  const M = parseFloat(cs.getPropertyValue('--page-margin'))
  const GAP = parseFloat(cs.getPropertyValue('--page-gap'))
  const cssPageW = parseFloat(cs.getPropertyValue('--page-w'))
  if (!cssPH || cssPH < 80 || !cssPageW) return [] // geometry not ready

  const domRect = dom.getBoundingClientRect()
  const zoom = domRect.width > 0 ? domRect.width / cssPageW : 1
  if (!isFinite(zoom) || zoom <= 0) return []

  // Doc position before each top-level node.
  const positions: number[] = []
  view.state.doc.forEach((_node, offset) => positions.push(offset))

  const breaks: Break[] = []
  let pageStart = 0
  let lastBottom = 0
  let spacerAccum = 0
  let blockIndex = 0

  for (const child of Array.from(dom.children) as HTMLElement[]) {
    const r = child.getBoundingClientRect()
    if (child.dataset.pageSpacer === 'true') {
      spacerAccum += r.height / zoom
      continue
    }
    const contentTop = (r.top - domRect.top) / zoom - M - spacerAccum
    const height = r.height / zoom
    const contentBottom = contentTop + height

    if (lastBottom > pageStart && contentBottom - pageStart > cssPH + 1) {
      const used = lastBottom - pageStart
      const spacer = cssPH - used + 2 * M + GAP
      const pos = positions[blockIndex]
      if (pos !== undefined && spacer > 4) breaks.push({ pos, spacer })
      pageStart = contentTop
    }
    lastBottom = contentBottom
    blockIndex++
  }
  return breaks
}

export const Pagination = Extension.create({
  name: 'pagination',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: paginationKey,
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, old) {
            const meta = tr.getMeta(paginationKey) as { decorations?: DecorationSet } | undefined
            if (meta?.decorations) return meta.decorations
            return (old as DecorationSet).map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            return paginationKey.getState(state)
          },
        },
        view(view) {
          let raf = 0
          let sig = ''
          const compute = () => {
            raf = 0
            let breaks: Break[] = []
            try {
              breaks = computeBreaks(view)
            } catch {
              breaks = []
            }
            const nextSig = breaks.map((b) => `${b.pos}:${Math.round(b.spacer)}`).join('|')
            if (nextSig === sig) return
            sig = nextSig
            const decos = breaks.map((b) =>
              Decoration.widget(b.pos, () => spacerElement(b.spacer), {
                side: -1,
                key: `pb-${b.pos}-${Math.round(b.spacer)}`,
              }),
            )
            view.dispatch(
              view.state.tr.setMeta(paginationKey, {
                decorations: DecorationSet.create(view.state.doc, decos),
              }),
            )
          }
          const schedule = () => {
            if (!raf) raf = requestAnimationFrame(compute)
          }
          schedule()
          let ro: ResizeObserver | null = null
          if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(schedule)
            ro.observe(view.dom)
          }
          return {
            update(v, prev) {
              if (prev.doc !== v.state.doc) {
                sig = '' // force recompute after content changes
                schedule()
              }
            },
            destroy() {
              if (raf) cancelAnimationFrame(raf)
              ro?.disconnect()
            },
          }
        },
      }),
    ]
  },
})
