// Shared helpers for rendering a section's free-form canvas layout in the END
// PRODUCT (filler + viewer + PDF). MOBILE-FIRST: the default (no media query) is
// a single stacked column in (y,x) reading order; a scoped @media(min-width:640px)
// block applies the authored positioned grid. This keeps phones usable while
// desktops get the exact Appsmith/WordPress-style layout.

import type { CanvasItem } from '@beaconhs/forms-core'

// Deterministic, collision-safe class derived from the section id (no useId, so
// it works identically in server + client render).
export function gridClass(sectionId: string): string {
  return 'cv_' + sectionId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

// Resolve every field to a grid box, auto-placing any field that lacks one
// (appended below, sensible default size). Returns the mobile reading order +
// the box lookup used to emit desktop placements.
export function resolveCanvas(
  fieldIds: string[],
  items: CanvasItem[],
  cols: number,
): { order: string[]; byId: Map<string, CanvasItem> } {
  const byId = new Map<string, CanvasItem>()
  for (const it of items) if (fieldIds.includes(it.i)) byId.set(it.i, it)
  let nextY = items.reduce((m, it) => Math.max(m, it.y + it.h), 0)
  for (const id of fieldIds) {
    if (!byId.has(id)) {
      byId.set(id, { i: id, x: 0, y: nextY, w: Math.min(cols, 6) || 6, h: 2 })
      nextY += 2
    }
  }
  const order = [...fieldIds].sort((a, b) => {
    const A = byId.get(a)!
    const B = byId.get(b)!
    return A.y - B.y || A.x - B.x
  })
  return { order, byId }
}

// Scoped CSS for the simpler `section.layout.columns` grid: mobile single
// column; desktop N columns with per-field colSpan. Keeps the columns feature
// mobile-friendly too.
export function columnsCss(
  cls: string,
  cols: number,
  spans: { id: string; span: number }[],
): string {
  const spanCss = spans
    .map((s) => `.${cls}>[data-cs="${s.id}"]{grid-column:span ${Math.min(s.span, cols)}}`)
    .join('')
  return (
    `.${cls}{display:grid;grid-template-columns:1fr;gap:16px}` +
    `@media(min-width:640px){.${cls}{grid-template-columns:repeat(${cols},minmax(0,1fr))}${spanCss}}`
  )
}

// Scoped CSS: mobile single column; desktop positioned grid.
export function canvasCss(
  cls: string,
  cols: number,
  rowHeight: number,
  byId: Map<string, CanvasItem>,
): string {
  const placements: string[] = []
  for (const it of byId.values()) {
    placements.push(
      `.${cls}>[data-ci="${it.i}"]{grid-column:${it.x + 1}/span ${it.w};grid-row:${it.y + 1}/span ${it.h};min-width:0}`,
    )
  }
  // grid-auto-rows uses minmax(rowHeight, auto) so cells GROW to fit content
  // (tall inputs never clip) while still honoring the authored row positions.
  return (
    `.${cls}{display:grid;grid-template-columns:1fr;gap:12px}` +
    `@media(min-width:640px){.${cls}{grid-template-columns:repeat(${cols},minmax(0,1fr));grid-auto-rows:minmax(${rowHeight}px,auto);align-items:start}${placements.join('')}}`
  )
}
