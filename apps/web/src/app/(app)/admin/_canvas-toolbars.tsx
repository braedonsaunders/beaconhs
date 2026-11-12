'use client'

// The contextual bars over a template builder's canvas, stacked so they never
// cover each other: text formatting for the selected element, and the table
// tools when that element sits in a table (a value in a cell gets both).

import type { Editor } from 'grapesjs'
import type { ColumnValueKind } from '@beaconhs/email-render/column-widths'
import { TableToolbar } from './_table-tools'
import { TextFormatToolbar } from './_text-format-tools'

export function CanvasToolbars({
  editor,
  fieldKinds,
}: {
  editor: Editor | null
  fieldKinds: Readonly<Record<string, ColumnValueKind>>
}) {
  return (
    <div className="pointer-events-none absolute top-2 right-2 left-2 z-20 flex flex-col items-center gap-1">
      <TextFormatToolbar editor={editor} />
      <TableToolbar editor={editor} fieldKinds={fieldKinds} />
    </div>
  )
}
