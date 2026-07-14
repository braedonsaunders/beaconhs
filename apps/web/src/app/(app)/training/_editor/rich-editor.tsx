'use client'

// Training's TipTap instance — direct inline WYSIWYG editing for lesson pages
// and slide regions. Reports itself to the surface on focus so the shared
// ribbon always targets the editor the author is typing in.

import { useEffect } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { sanitizeTrainingHtml } from '@/lib/training-rich-content'
import { buildLessonExtensions } from './extensions'

type RichChange = { html: string }

export function RichEditor({
  initialHtml,
  placeholder,
  onChange,
  onFocusEditor,
  className = '',
}: {
  initialHtml?: string | null
  placeholder?: string
  onChange?: (change: RichChange) => void
  onFocusEditor?: (editor: Editor) => void
  className?: string
}) {
  const editor = useEditor({
    extensions: buildLessonExtensions({ placeholder }),
    // Sanitized HTML is the sole persisted representation. Keeping a second,
    // caller-controlled ProseMirror tree caused author/player drift whenever
    // the server removed an unsafe node from the HTML.
    content: sanitizeTrainingHtml(initialHtml),
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'min-h-[1.5em] focus:outline-none' },
      transformPastedHTML: sanitizeTrainingHtml,
    },
    onUpdate({ editor }) {
      onChange?.({ html: editor.getHTML() })
    },
    onFocus({ editor }) {
      onFocusEditor?.(editor)
    },
  })

  // Register as the active editor on mount so the ribbon works immediately
  // for single-editor surfaces.
  useEffect(() => {
    if (editor) onFocusEditor?.(editor)
  }, [editor, onFocusEditor])

  return <EditorContent editor={editor} className={className} />
}
