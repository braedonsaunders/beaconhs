'use client'

// The right pane: a Write ↔ PDF surface. Holds the mode and renders the
// embedded editor (Write) or the PDF view (PDF). Both carry the ModeSwitch in
// their header so you can flip between them for any document.
//
// Read-only users (`canManage === false`) never get the editor: they see the
// published PDF — the document of record — with no write or upload controls.

import { useState } from 'react'
import { DocumentEditor } from './editor/_document-editor'
import type { LayoutState } from './editor/_appbar'
import type { EditorComment, EditorUser } from './editor/_lib'
import { DocumentPdfPane } from './_pdf-pane'
import type { DocumentMode } from './_mode-switch'

export function DocumentPane({
  documentId,
  canManage,
  defaultMode,
  initialTitle,
  initialHtml,
  initialJson,
  initialLayout,
  initialComments,
  currentUser,
  aiEnabled = false,
}: {
  documentId: string
  canManage: boolean
  defaultMode: DocumentMode
  initialTitle: string
  initialHtml: string
  initialJson: Record<string, unknown> | null
  initialLayout: LayoutState
  initialComments: EditorComment[]
  currentUser: EditorUser
  aiEnabled?: boolean
}) {
  const [mode, setMode] = useState<DocumentMode>(defaultMode)

  if (!canManage) {
    return <DocumentPdfPane documentId={documentId} readOnly />
  }
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
      currentUser={currentUser}
      aiEnabled={aiEnabled}
    />
  )
}
