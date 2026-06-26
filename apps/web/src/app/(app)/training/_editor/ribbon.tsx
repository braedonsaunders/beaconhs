'use client'

// Office-style formatting ribbon for the lesson editor — mirrors the documents
// editor's toolbar conventions (active state read straight off the editor) but
// owned by training. Targets whichever RichEditor is focused; `extra` hosts
// kind-specific controls (slide ops, etc.).

import { useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Quote,
  Redo2,
  RemoveFormatting,
  SeparatorHorizontal,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react'
import { cn, Select } from '@beaconhs/ui'
import { finalizeUpload, requestUpload } from '@/lib/uploads'
import { toast } from '@/lib/toast'

const TEXT_COLORS = [
  '#0f172a',
  '#dc2626',
  '#d97706',
  '#059669',
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#ffffff',
]
const HIGHLIGHTS = ['#fef08a', '#bbf7d0', '#fbcfe8', '#bfdbfe', '#fed7aa']

export function LessonRibbon({ editor, extra }: { editor: Editor | null; extra?: ReactNode }) {
  // The surface's `activeEditor` can briefly point at a DESTROYED TipTap
  // instance (switching slides/lessons remounts the RichEditor) — calling
  // .can()/.isActive() on one derefs nulled internals. Treat destroyed as none.
  const e = editor && !editor.isDestroyed ? editor : null
  const can = !!e
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
      <Btn
        label="Undo"
        disabled={!can || !e!.can().undo()}
        onClick={() => e!.chain().focus().undo().run()}
      >
        <Undo2 size={15} />
      </Btn>
      <Btn
        label="Redo"
        disabled={!can || !e!.can().redo()}
        onClick={() => e!.chain().focus().redo().run()}
      >
        <Redo2 size={15} />
      </Btn>
      <Sep />

      <StyleSelect editor={e} />
      <Sep />

      <Btn
        label="Bold"
        disabled={!can}
        active={can && e!.isActive('bold')}
        onClick={() => e!.chain().focus().toggleBold().run()}
      >
        <Bold size={15} />
      </Btn>
      <Btn
        label="Italic"
        disabled={!can}
        active={can && e!.isActive('italic')}
        onClick={() => e!.chain().focus().toggleItalic().run()}
      >
        <Italic size={15} />
      </Btn>
      <Btn
        label="Underline"
        disabled={!can}
        active={can && e!.isActive('underline')}
        onClick={() => e!.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon size={15} />
      </Btn>
      <Btn
        label="Strikethrough"
        disabled={!can}
        active={can && e!.isActive('strike')}
        onClick={() => e!.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={15} />
      </Btn>
      <ColorMenu editor={e} mode="text" />
      <ColorMenu editor={e} mode="highlight" />
      <Sep />

      <Btn
        label="Bullet list"
        disabled={!can}
        active={can && e!.isActive('bulletList')}
        onClick={() => e!.chain().focus().toggleBulletList().run()}
      >
        <List size={15} />
      </Btn>
      <Btn
        label="Numbered list"
        disabled={!can}
        active={can && e!.isActive('orderedList')}
        onClick={() => e!.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} />
      </Btn>
      <Btn
        label="Checklist"
        disabled={!can}
        active={can && e!.isActive('taskList')}
        onClick={() => e!.chain().focus().toggleTaskList().run()}
      >
        <ListChecks size={15} />
      </Btn>
      <Btn
        label="Quote"
        disabled={!can}
        active={can && e!.isActive('blockquote')}
        onClick={() => e!.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={15} />
      </Btn>
      <Sep />

      <Btn
        label="Align left"
        disabled={!can}
        active={can && e!.isActive({ textAlign: 'left' })}
        onClick={() => e!.chain().focus().setTextAlign('left').run()}
      >
        <AlignLeft size={15} />
      </Btn>
      <Btn
        label="Align centre"
        disabled={!can}
        active={can && e!.isActive({ textAlign: 'center' })}
        onClick={() => e!.chain().focus().setTextAlign('center').run()}
      >
        <AlignCenter size={15} />
      </Btn>
      <Btn
        label="Align right"
        disabled={!can}
        active={can && e!.isActive({ textAlign: 'right' })}
        onClick={() => e!.chain().focus().setTextAlign('right').run()}
      >
        <AlignRight size={15} />
      </Btn>
      <Sep />

      <LinkBtn editor={e} />
      <ImageBtn editor={e} />
      <Btn
        label="Insert table"
        disabled={!can}
        active={can && e!.isActive('table')}
        onClick={() =>
          e!.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <TableIcon size={15} />
      </Btn>
      <Btn
        label="Divider"
        disabled={!can}
        onClick={() => e!.chain().focus().setHorizontalRule().run()}
      >
        <SeparatorHorizontal size={15} />
      </Btn>
      <Btn
        label="Clear formatting"
        disabled={!can}
        onClick={() => e!.chain().focus().clearNodes().unsetAllMarks().run()}
      >
        <RemoveFormatting size={15} />
      </Btn>

      {extra ? (
        <>
          <Sep />
          <div className="flex flex-wrap items-center gap-1">{extra}</div>
        </>
      ) : null}
    </div>
  )
}

// --- primitives ---------------------------------------------------------------

function Btn({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onMouseDown={(ev) => ev.preventDefault()} // keep editor selection
      onClick={onClick}
      className={cn(
        'grid h-7 w-7 place-items-center rounded text-slate-600 transition-colors dark:text-slate-300',
        active
          ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200'
          : 'hover:bg-slate-100 dark:hover:bg-slate-800',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
      )}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-800" />
}

function StyleSelect({ editor }: { editor: Editor | null }) {
  const value = !editor
    ? 'p'
    : editor.isActive('heading', { level: 1 })
      ? 'h1'
      : editor.isActive('heading', { level: 2 })
        ? 'h2'
        : editor.isActive('heading', { level: 3 })
          ? 'h3'
          : 'p'
  return (
    <Select
      title="Text style"
      disabled={!editor}
      value={value}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.currentTarget.value
        if (!editor) return
        if (v === 'p') editor.chain().focus().setParagraph().run()
        else
          editor
            .chain()
            .focus()
            .setHeading({ level: Number(v[1]) as 1 | 2 | 3 })
            .run()
      }}
      className="h-7 px-1.5 text-xs font-medium text-slate-700 disabled:opacity-40 dark:text-slate-200"
    >
      <option value="p">Normal</option>
      <option value="h1">Heading 1</option>
      <option value="h2">Heading 2</option>
      <option value="h3">Heading 3</option>
    </Select>
  )
}

function ColorMenu({ editor, mode }: { editor: Editor | null; mode: 'text' | 'highlight' }) {
  const [open, setOpen] = useState(false)
  const colors = mode === 'text' ? TEXT_COLORS : HIGHLIGHTS
  return (
    <span className="relative">
      <Btn
        label={mode === 'text' ? 'Text colour' : 'Highlight'}
        disabled={!editor}
        active={!!editor && mode === 'highlight' && editor.isActive('highlight')}
        onClick={() => setOpen((v) => !v)}
      >
        {mode === 'text' ? <Baseline size={15} /> : <Highlighter size={15} />}
        <ChevronDown size={8} className="-ml-0.5" />
      </Btn>
      {open && editor ? (
        <span className="absolute top-8 left-0 z-40 flex gap-1 rounded-md border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => {
                if (mode === 'text') editor.chain().focus().setColor(c).run()
                else editor.chain().focus().setHighlight({ color: c }).run()
                setOpen(false)
              }}
              className="h-5 w-5 rounded border border-slate-200 dark:border-slate-700"
              style={{ background: c }}
            />
          ))}
          <button
            type="button"
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => {
              if (mode === 'text') editor.chain().focus().unsetColor().run()
              else editor.chain().focus().unsetHighlight().run()
              setOpen(false)
            }}
            className="grid h-5 w-5 place-items-center rounded border border-slate-200 text-[9px] text-slate-500 dark:border-slate-700 dark:text-slate-400"
            title="None"
          >
            ✕
          </button>
        </span>
      ) : null}
    </span>
  )
}

function LinkBtn({ editor }: { editor: Editor | null }) {
  return (
    <Btn
      label="Link"
      disabled={!editor}
      active={!!editor && editor.isActive('link')}
      onClick={() => {
        if (!editor) return
        if (editor.isActive('link')) {
          editor.chain().focus().unsetLink().run()
          return
        }
        const url = window.prompt('Link URL (https://…)')
        if (url) editor.chain().focus().setLink({ href: url }).run()
      }}
    >
      <Link2 size={15} />
    </Btn>
  )
}

function ImageBtn({ editor }: { editor: Editor | null }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Btn
        label="Insert image"
        disabled={!editor || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />}
      </Btn>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={async (ev) => {
          const file = ev.currentTarget.files?.[0]
          ev.currentTarget.value = ''
          if (!file || !editor) return
          setBusy(true)
          try {
            const req = await requestUpload({
              kind: 'image',
              filename: file.name,
              contentType: file.type,
              sizeBytes: file.size,
            })
            if (!req.ok) throw new Error(req.error)
            await fetch(req.putUrl, {
              method: 'PUT',
              body: file,
              headers: { 'Content-Type': file.type },
            })
            const fin = await finalizeUpload({
              key: req.key,
              kind: 'image',
              filename: file.name,
              contentType: file.type,
              sizeBytes: file.size,
            })
            if (!fin.ok) throw new Error(fin.error)
            editor.chain().focus().setImage({ src: req.publicUrl, alt: file.name }).run()
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Image upload failed')
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}
