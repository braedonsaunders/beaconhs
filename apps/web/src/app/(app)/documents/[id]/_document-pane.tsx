'use client'

// The right pane: a Write ↔ PDF surface. Holds the mode and renders the
// embedded editor (Write) or the PDF view (PDF). Both carry the ModeSwitch in
// their header so you can flip between them for any document.

import { useState } from 'react'
import { DocumentEditor } from './editor/_document-editor'
import type { LayoutState } from './editor/_appbar'
import type { EditorComment } from './editor/_lib'
import { DocumentPdfPane } from './_pdf-pane'
import type { DocumentMode } from './_mode-switch'

export function DocumentPane({
  documentId,
  defaultMode,
  initialTitle,
  initialHtml,
  initialJson,
  initialLayout,
  initialComments,
}: {
  documentId: string
  defaultMode: DocumentMode
  initialTitle: string
  initialHtml: string
  initialJson: Record<string, unknown> | null
  initialLayout: LayoutState
  initialComments: EditorComment[]
}) {
  const [mode, setMode] = useState<DocumentMode>(defaultMode)

  if (mode === 'pdf') {
    return <DocumentPdfPane documentId={documentId} mode={mode} onModeChange={setMode} />
  }
  return (
    <DocumentEditor
      embedded
      mode={mode}
      onModeChange={setMode}
      documentId={documentId}
      initialTitle={initialTitle}
      initialHtml={initialHtml}
      initialJson={initialJson}
      initialLayout={initialLayout}
      initialComments={initialComments}
    />
  )
}
