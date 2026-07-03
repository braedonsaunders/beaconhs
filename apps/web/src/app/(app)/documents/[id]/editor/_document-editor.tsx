'use client'

// Full-screen Word-like document editor. Renders a fixed inset-0 surface above
// the app shell: top app bar + formatting toolbar + paper canvas + (later)
// comments rail. Owns the editor instance, autosave, and page/zoom state.

import './editor-styles.css'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { toast } from 'sonner'
import { documentBodyCss } from '@beaconhs/forms-core'
import { buildExtensions } from './_extensions'
import { useDocumentAutosave } from './_autosave'
import { EditorAppbar, type LayoutState } from './_appbar'
import { FormattingToolbar } from './_toolbar'
import { FindReplaceBar } from './_find-replace'
import { CommentsPanel } from './_comments-panel'
import { AiPanel } from './_ai-panel'
import { SuggestionBar } from './_suggestion-bar'
import { PageCanvas } from './_canvas'
import {
  renameDocument,
  updateDocumentLayout,
  publishDraft,
  saveDraft,
  listDocumentComments,
} from '../_actions'
import type { EditorComment, EditorUser } from './_lib'
import type { DocumentMode } from '../_mode-switch'

export function DocumentEditor({
  documentId,
  initialTitle,
  initialHtml,
  initialJson,
  initialLayout,
  initialComments,
  currentUser,
  aiEnabled = false,
  embedded = false,
  mode,
  onModeChange,
}: {
  documentId: string
  initialTitle: string
  initialHtml: string
  initialJson: Record<string, unknown> | null
  initialLayout: LayoutState
  initialComments: EditorComment[]
  /** The active member — stamps track-changes suggestions with their author. */
  currentUser: EditorUser
  aiEnabled?: boolean
  /** Embedded in the manage page's right pane (fills its container) vs full-screen overlay. */
  embedded?: boolean
  mode?: DocumentMode
  onModeChange?: (m: DocumentMode) => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [layout, setLayout] = useState<LayoutState>(initialLayout)
  const [comments, setComments] = useState<EditorComment[]>(initialComments)
  const [zoom, setZoom] = useState(1)
  const [suggesting, setSuggesting] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [publishing, startPublish] = useTransition()

  const { saveState, queueSave, flush } = useDocumentAutosave(documentId)

  const editor = useEditor({
    extensions: buildExtensions({ placeholder: 'Start writing your document…' }),
    content: initialJson ?? initialHtml ?? '',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'doc-body focus:outline-none',
      },
    },
    onUpdate({ editor }) {
      queueSave(editor.getJSON(), editor.getHTML())
    },
  })

  // Title rename (debounced).
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onTitleChange = useCallback(
    (t: string) => {
      setTitle(t)
      if (titleTimer.current) clearTimeout(titleTimer.current)
      titleTimer.current = setTimeout(() => void renameDocument({ documentId, title: t }), 600)
    },
    [documentId],
  )

  // Page setup (persists immediately).
  const onLayoutChange = useCallback(
    (patch: Partial<LayoutState>) => {
      setLayout((prev) => {
        const next = { ...prev, ...patch }
        void updateDocumentLayout({
          documentId,
          pageSize: next.pageSize,
          headerText: next.headerText,
          footerText: next.footerText,
          printHeader: next.printHeader,
          printFooter: next.printFooter,
        })
        return next
      })
    },
    [documentId],
  )

  const refreshComments = useCallback(async () => {
    setComments(await listDocumentComments(documentId))
  }, [documentId])

  // Keep the editor's suggesting flag in sync with the toggle.
  useEffect(() => {
    editor?.commands.setSuggesting(suggesting)
  }, [editor, suggesting])

  // Attribute track-changes suggestions to the active member.
  useEffect(() => {
    editor?.commands.setSuggestionUser({
      id: currentUser.tenantUserId ?? '',
      name: currentUser.name,
    })
  }, [editor, currentUser])

  // ⌘F / Ctrl-F opens the find bar instead of the browser's.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function onPublish() {
    if (!editor) return
    const json = editor.getJSON()
    const html = editor.getHTML()
    startPublish(async () => {
      // Persist the latest content first so the snapshot is current.
      await saveDraft({ documentId, contentJson: json, contentHtml: html })
      const r = await publishDraft({ documentId })
      if (r.ok) toast.success(`Published v${r.version}`)
      else toast.error('error' in r ? r.error : 'Publish failed')
    })
  }

  if (!editor) {
    return (
      <div
        className={`${embedded ? 'h-full' : 'fixed inset-0 z-50'} grid place-items-center bg-slate-100 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400`}
      >
        Loading editor…
      </div>
    )
  }

  const words = editor.storage.characterCount?.words?.() ?? 0

  return (
    <div
      className={
        embedded
          ? 'pm-doc relative flex h-full min-h-0 flex-col bg-slate-100 dark:bg-slate-950'
          : 'pm-doc fixed inset-0 z-50 flex flex-col bg-slate-100 dark:bg-slate-950'
      }
    >
      <style dangerouslySetInnerHTML={{ __html: documentBodyCss('.doc-body') }} />
      <EditorAppbar
        documentId={documentId}
        embedded={embedded}
        mode={mode}
        onModeChange={onModeChange}
        title={title}
        onTitleChange={onTitleChange}
        saveState={saveState}
        words={words}
        zoom={zoom}
        onZoomChange={setZoom}
        layout={layout}
        onLayoutChange={onLayoutChange}
        suggesting={suggesting}
        onToggleSuggesting={() => setSuggesting((v) => !v)}
        commentsOpen={commentsOpen}
        onToggleComments={() => {
          setCommentsOpen((v) => !v)
          setAiOpen(false)
        }}
        commentCount={comments.length}
        aiOpen={aiOpen}
        onToggleAi={() => {
          setAiOpen((v) => !v)
          setCommentsOpen(false)
        }}
        onPublish={onPublish}
        publishing={publishing}
      />
      <FormattingToolbar editor={editor} onToggleFind={() => setFindOpen((v) => !v)} />
      {findOpen ? (
        <FindReplaceBar
          editor={editor}
          onClose={() => {
            setFindOpen(false)
            editor.commands.clearSearch()
          }}
        />
      ) : null}
      {suggesting ? <SuggestionBar editor={editor} /> : null}
      <div className="relative flex min-h-0 flex-1">
        <PageCanvas pageSize={layout.pageSize} zoom={zoom}>
          <EditorContent editor={editor} />
        </PageCanvas>
        {commentsOpen ? (
          <CommentsPanel
            editor={editor}
            documentId={documentId}
            comments={comments}
            onChanged={refreshComments}
            onClose={() => setCommentsOpen(false)}
          />
        ) : null}
      </div>
      <AiPanel
        editor={editor}
        documentId={documentId}
        aiEnabled={aiEnabled}
        open={aiOpen}
        onClose={() => setAiOpen(false)}
      />
    </div>
  )
}
