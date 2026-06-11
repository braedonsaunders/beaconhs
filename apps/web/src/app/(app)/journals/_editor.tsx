'use client'

// The JournalEditor — an elevated TipTap surface: headings, lists, checklists,
// highlight, smart typography, markdown shortcuts, voice dictation, and
// streaming inline AI (tidy / expand / continue / fix / bulletize / summarize).

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { CharacterCount } from '@tiptap/extension-character-count'
import { toast } from 'sonner'
import {
  Bold,
  CheckSquare,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Sparkles,
  Strikethrough,
  Undo2,
  Wand2,
} from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { VoiceButton } from './_voice-button'

type WritingMode = 'tidy' | 'expand' | 'continue' | 'fix' | 'bulletize' | 'summarize'

const AI_ACTIONS: { mode: WritingMode; label: string; hint: string }[] = [
  { mode: 'tidy', label: 'Improve writing', hint: 'Clean up grammar & flow' },
  { mode: 'expand', label: 'Expand to prose', hint: 'Turn notes into a full entry' },
  { mode: 'continue', label: 'Continue writing', hint: 'Add the next few sentences' },
  { mode: 'fix', label: 'Fix spelling & grammar', hint: 'Corrections only' },
  { mode: 'bulletize', label: 'Make bullet points', hint: 'Work · hazards · actions' },
  { mode: 'summarize', label: 'Summarize', hint: 'One short paragraph' },
]

async function* streamAI(mode: WritingMode, text: string): AsyncGenerator<string> {
  const res = await fetch('/journals/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode, text }),
  })
  if (res.status === 503) throw new Error('AI isn’t configured. Add an API key to enable it.')
  if (!res.ok || !res.body) throw new Error('AI request failed.')
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const s = dec.decode(value, { stream: true })
    if (s) yield s
  }
}

export function JournalEditor({
  initialHtml,
  editable = true,
  aiEnabled,
  placeholder = 'Start your entry… what did you work on, what hazards did you see, what got done?',
  onChange,
}: {
  initialHtml: string
  editable?: boolean
  aiEnabled: boolean
  placeholder?: string
  onChange: (html: string, text: string) => void
}) {
  const [aiBusy, setAiBusy] = useState<WritingMode | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const aiRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      // StarterKit v3 bundles Link — disable it here so our styled Link is the
      // only registration (avoids the "Duplicate extension names" warning).
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-teal-700 underline underline-offset-2' },
      }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Typography,
      CharacterCount,
    ],
    content: initialHtml,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'prose prose-slate max-w-none focus:outline-none min-h-[50vh] leading-relaxed',
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML(), editor.getText())
    },
  })

  // Re-hydrate when switching to a different entry.
  useEffect(() => {
    if (editor && initialHtml !== editor.getHTML()) {
      editor.commands.setContent(initialHtml, { emitUpdate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml])

  useEffect(() => {
    if (editor) editor.setEditable(editable)
  }, [editor, editable])

  // Close AI menu on outside click.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (aiRef.current && !aiRef.current.contains(e.target as Node)) setAiOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  async function runAI(mode: WritingMode) {
    if (!editor || aiBusy) return
    setAiOpen(false)
    const sel = editor.state.selection
    const hasSelection = !sel.empty
    const source = hasSelection
      ? editor.state.doc.textBetween(sel.from, sel.to, '\n')
      : editor.getText()
    if (!source.trim()) {
      toast.error('Write something first, then ask AI.')
      return
    }
    setAiBusy(mode)
    try {
      if (mode === 'continue') {
        editor.commands.focus('end')
      } else if (hasSelection) {
        editor.chain().focus().deleteSelection().run()
      } else {
        editor.chain().focus().selectAll().deleteSelection().run()
      }
      let pos = editor.state.selection.from
      if (mode === 'continue') editor.commands.insertContentAt(pos, ' ')
      pos = editor.state.selection.from
      for await (const chunk of streamAI(mode, source)) {
        editor.commands.insertContentAt(pos, chunk)
        pos += chunk.length
      }
      editor.commands.focus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI request failed.')
    } finally {
      setAiBusy(null)
    }
  }

  function setLink() {
    if (!editor) return
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', prev ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  if (!editor) {
    return <div className="min-h-[50vh] animate-pulse rounded-lg bg-slate-50" />
  }

  const words = editor.storage.characterCount?.words?.() ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white/90 px-1 py-1 backdrop-blur">
        <TBtn
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          label="Bold"
        >
          <Bold size={15} />
        </TBtn>
        <TBtn
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          label="Italic"
        >
          <Italic size={15} />
        </TBtn>
        <TBtn
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          label="Strikethrough"
        >
          <Strikethrough size={15} />
        </TBtn>
        <TBtn
          active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          label="Highlight"
        >
          <Highlighter size={15} />
        </TBtn>
        <Divider />
        <TBtn
          active={editor.isActive('heading', { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          label="Heading 1"
        >
          <Heading1 size={15} />
        </TBtn>
        <TBtn
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          label="Heading 2"
        >
          <Heading2 size={15} />
        </TBtn>
        <TBtn
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          label="Heading 3"
        >
          <Heading3 size={15} />
        </TBtn>
        <Divider />
        <TBtn
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="Bullet list"
        >
          <List size={15} />
        </TBtn>
        <TBtn
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          label="Numbered list"
        >
          <ListOrdered size={15} />
        </TBtn>
        <TBtn
          active={editor.isActive('taskList')}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          label="Checklist"
        >
          <CheckSquare size={15} />
        </TBtn>
        <TBtn
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          label="Quote"
        >
          <Quote size={15} />
        </TBtn>
        <TBtn
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          label="Code block"
        >
          <Code size={15} />
        </TBtn>
        <TBtn active={editor.isActive('link')} onClick={setLink} label="Link">
          <Link2 size={15} />
        </TBtn>

        <Divider />
        {/* AI dropdown */}
        <div ref={aiRef} className="relative">
          <button
            type="button"
            onClick={() =>
              aiEnabled
                ? setAiOpen((v) => !v)
                : toast.error('AI isn’t configured. Add an API key to enable it.')
            }
            disabled={!!aiBusy}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium transition-colors',
              aiEnabled
                ? 'bg-gradient-to-r from-teal-600 to-teal-700 text-white hover:from-teal-700 hover:to-teal-800'
                : 'bg-slate-100 text-slate-400',
              aiBusy && 'opacity-70',
            )}
          >
            {aiBusy ? <Sparkles size={13} className="animate-pulse" /> : <Wand2 size={13} />}
            {aiBusy ? 'Writing…' : 'AI'}
          </button>
          {aiOpen ? (
            <div className="absolute top-9 left-0 z-30 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                Selection, or whole entry
              </div>
              {AI_ACTIONS.map((a) => (
                <button
                  key={a.mode}
                  type="button"
                  onClick={() => runAI(a.mode)}
                  className="flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors hover:bg-teal-50"
                >
                  <span className="text-sm font-medium text-slate-800">{a.label}</span>
                  <span className="text-[11px] text-slate-400">{a.hint}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <VoiceButton
          className="ml-1 h-7 w-7"
          disabled={!editable}
          onText={(t) => editor.chain().focus().insertContent(t).run()}
        />

        <div className="ml-auto flex items-center gap-0.5 pr-1">
          <span className="mr-1 hidden text-[11px] text-slate-400 tabular-nums sm:inline">
            {words} words
          </span>
          <TBtn
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
            label="Undo"
          >
            <Undo2 size={15} />
          </TBtn>
          <TBtn
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
            label="Redo"
          >
            <Redo2 size={15} />
          </TBtn>
        </div>
      </div>

      {/* Writing surface */}
      <div className="app-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}

function TBtn({
  children,
  active = false,
  disabled = false,
  onClick,
  label,
}: {
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-slate-600 transition-colors',
        active ? 'bg-teal-100 text-teal-900' : 'hover:bg-slate-100 hover:text-slate-900',
        disabled && 'cursor-not-allowed opacity-30 hover:bg-transparent',
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="mx-1 h-5 w-px bg-slate-200" />
}
