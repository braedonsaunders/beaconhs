'use client'

// Training's TipTap instance — direct inline WYSIWYG editing for lesson pages
// and slide regions. Reports itself to the surface on focus so the shared
// ribbon always targets the editor the author is typing in.

import { useEffect } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { buildLessonExtensions } from './extensions'

export type RichChange = { json: unknown; html: string }

export function RichEditor({
  initialJson,
  initialHtml,
  placeholder,
  onChange,
  onFocusEditor,
  className = '',
}: {
  initialJson?: unknown | null
  initialHtml?: string | null
  placeholder?: string
  onChange?: (change: RichChange) => void
  onFocusEditor?: (editor: Editor) => void
  className?: string
}) {
  const editor = useEditor({
    extensions: buildLessonExtensions({ placeholder }),
    content: (initialJson as never) ?? initialHtml ?? '',
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'min-h-[1.5em] focus:outline-none' },
    },
    onUpdate({ editor }) {
      onChange?.({ json: editor.getJSON(), html: editor.getHTML() })
    },
    onFocus({ editor }) {
      onFocusEditor?.(editor)
    },
  })

  // Register as the active editor on mount so the ribbon works immediately
  // for single-editor surfaces.
  useEffect(() => {
    if (editor) onFocusEditor?.(editor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor])

  return <EditorContent editor={editor} className={className} />
}
