'use client'

// The "desk": a scrollable gray area that hosts the editor content styled as a
// real paper column. Page geometry is published as CSS variables (consumed by
// editor-styles.css for the page look and by the pagination plugin for
// measurement). Zoom uses the CSS `zoom` property; the pagination plugin
// divides measurements by the detected zoom so breaks stay accurate.

import { type CSSProperties, type ReactNode } from 'react'
import { PAGE_SIZES, PAGE_MARGIN_PX, PAGE_GAP_PX, type PageSizeKey } from './_lib'

export function PageCanvas({
  pageSize,
  zoom,
  children,
}: {
  pageSize: PageSizeKey
  zoom: number
  children: ReactNode
}) {
  const size = PAGE_SIZES[pageSize]
  const vars = {
    zoom,
    ['--page-w']: `${size.wPx}px`,
    ['--page-h']: `${size.hPx}px`,
    ['--page-margin']: `${PAGE_MARGIN_PX}px`,
    ['--page-content-h']: `${size.hPx - 2 * PAGE_MARGIN_PX}px`,
    ['--page-gap']: `${PAGE_GAP_PX}px`,
  } as CSSProperties

  return (
    <div className="app-scroll relative min-h-0 flex-1 overflow-auto bg-slate-200/70">
      <div className="flex flex-col items-center px-6 py-8" style={vars}>
        {children}
      </div>
    </div>
  )
}
