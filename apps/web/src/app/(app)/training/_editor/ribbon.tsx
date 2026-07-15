'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
import { cn, Select, uploadReservedFile } from '@beaconhs/ui'
import { normalizeRichTextLinkUrl } from '@beaconhs/forms-core'
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
  const tGenerated = useGeneratedTranslations()
  // The surface's `activeEditor` can briefly point at a DESTROYED TipTap
  // instance (switching slides/lessons remounts the RichEditor) — calling
  // .can()/.isActive() on one derefs nulled internals. Treat destroyed as none.
  const e = editor && !editor.isDestroyed ? editor : null
  const can = !!e
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
      <Btn
        label={tGenerated('m_164c39255db582')}
        disabled={!can || !e!.can().undo()}
        onClick={() => e!.chain().focus().undo().run()}
      >
        <Undo2 size={15} />
      </Btn>
      <Btn
        label={tGenerated('m_11d36eb7bdbd5d')}
        disabled={!can || !e!.can().redo()}
        onClick={() => e!.chain().focus().redo().run()}
      >
        <Redo2 size={15} />
      </Btn>
      <Sep />

      <StyleSelect editor={e} />
      <Sep />

      <Btn
        label={tGenerated('m_1e62e6d69a0d11')}
        disabled={!can}
        active={can && e!.isActive('bold')}
        onClick={() => e!.chain().focus().toggleBold().run()}
      >
        <Bold size={15} />
      </Btn>
      <Btn
        label={tGenerated('m_1ee96b6856cb45')}
        disabled={!can}
        active={can && e!.isActive('italic')}
        onClick={() => e!.chain().focus().toggleItalic().run()}
      >
        <Italic size={15} />
      </Btn>
      <Btn
        label={tGenerated('m_0ca9da1d16cfae')}
        disabled={!can}
        active={can && e!.isActive('underline')}
        onClick={() => e!.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon size={15} />
      </Btn>
      <Btn
        label={tGenerated('m_12d4047e2b561e')}
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
        label={tGenerated('m_0d3c39e0b97288')}
        disabled={!can}
        active={can && e!.isActive('bulletList')}
        onClick={() => e!.chain().focus().toggleBulletList().run()}
      >
        <List size={15} />
      </Btn>
      <Btn
        label={tGenerated('m_018e8c7f92cf35')}
        disabled={!can}
        active={can && e!.isActive('orderedList')}
        onClick={() => e!.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} />
      </Btn>
      <Btn
        label={tGenerated('m_08e83f80918eaf')}
        disabled={!can}
        active={can && e!.isActive('taskList')}
        onClick={() => e!.chain().focus().toggleTaskList().run()}
      >
        <ListChecks size={15} />
      </Btn>
      <Btn
        label={tGenerated('m_0a071dfef73a21')}
        disabled={!can}
        active={can && e!.isActive('blockquote')}
        onClick={() => e!.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={15} />
      </Btn>
      <Sep />

      <Btn
        label={tGenerated('m_1ef8a8bcc41afe')}
        disabled={!can}
        active={can && e!.isActive({ textAlign: 'left' })}
        onClick={() => e!.chain().focus().setTextAlign('left').run()}
      >
        <AlignLeft size={15} />
      </Btn>
      <Btn
        label={tGenerated('m_1d852083b55942')}
        disabled={!can}
        active={can && e!.isActive({ textAlign: 'center' })}
        onClick={() => e!.chain().focus().setTextAlign('center').run()}
      >
        <AlignCenter size={15} />
      </Btn>
      <Btn
        label={tGenerated('m_07282d01cb7513')}
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
        label={tGenerated('m_0c5d6844f3954a')}
        disabled={!can}
        active={can && e!.isActive('table')}
        onClick={() =>
          e!.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <TableIcon size={15} />
      </Btn>
      <Btn
        label={tGenerated('m_087aa75e7549fe')}
        disabled={!can}
        onClick={() => e!.chain().focus().setHorizontalRule().run()}
      >
        <SeparatorHorizontal size={15} />
      </Btn>
      <Btn
        label={tGenerated('m_10b16b3eb112c5')}
        disabled={!can}
        onClick={() => e!.chain().focus().clearNodes().unsetAllMarks().run()}
      >
        <RemoveFormatting size={15} />
      </Btn>

      <GeneratedValue
        value={
          extra ? (
            <>
              <Sep />
              <div className="flex flex-wrap items-center gap-1">
                <GeneratedValue value={extra} />
              </div>
            </>
          ) : null
        }
      />
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
  const tGeneratedValue = useGeneratedValueTranslations()
  return (
    <button
      type="button"
      title={tGeneratedValue(label)}
      aria-label={tGeneratedValue(label)}
      disabled={disabled}
      onMouseDown={(ev) => ev.preventDefault()} // keep editor selection
      onClick={onClick}
      className={cn(
        'grid h-7 w-7 place-items-center rounded text-slate-600 transition-colors dark:text-slate-300',
        active
          ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200'
          : 'hover:bg-slate-100 dark:hover:bg-slate-800',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent dark:hover:bg-transparent',
      )}
    >
      <GeneratedValue value={children} />
    </button>
  )
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-800" />
}

function StyleSelect({ editor }: { editor: Editor | null }) {
  const tGenerated = useGeneratedTranslations()
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
      title={tGenerated('m_193b769ecd01ce')}
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
      <option value="p">
        <GeneratedText id="m_19862da7cdac1d" />
      </option>
      <option value="h1">
        <GeneratedText id="m_05a59f16978305" />
      </option>
      <option value="h2">
        <GeneratedText id="m_0b5fa291a5a72a" />
      </option>
      <option value="h3">
        <GeneratedText id="m_1e90df2a72ca42" />
      </option>
    </Select>
  )
}

function ColorMenu({ editor, mode }: { editor: Editor | null; mode: 'text' | 'highlight' }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const [open, setOpen] = useState(false)
  const colors = mode === 'text' ? TEXT_COLORS : HIGHLIGHTS
  return (
    <span className="relative">
      <Btn
        label={tGeneratedValue(
          mode === 'text' ? tGenerated('m_1cf64f72efcada') : tGenerated('m_041c65e7c65d79'),
        )}
        disabled={!editor}
        active={!!editor && mode === 'highlight' && editor.isActive('highlight')}
        onClick={() => setOpen((v) => !v)}
      >
        <GeneratedValue
          value={mode === 'text' ? <Baseline size={15} /> : <Highlighter size={15} />}
        />
        <ChevronDown size={8} className="-ml-0.5" />
      </Btn>
      <GeneratedValue
        value={
          open && editor ? (
            <span className="absolute top-8 left-0 z-40 flex gap-1 rounded-md border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              <GeneratedValue
                value={colors.map((c) => (
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
              />
              <button
                type="button"
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => {
                  if (mode === 'text') editor.chain().focus().unsetColor().run()
                  else editor.chain().focus().unsetHighlight().run()
                  setOpen(false)
                }}
                className="grid h-5 w-5 place-items-center rounded border border-slate-200 text-[9px] text-slate-500 dark:border-slate-700 dark:text-slate-400"
                title={tGenerated('m_04be42f1f72c23')}
              >
                ✕
              </button>
            </span>
          ) : null
        }
      />
    </span>
  )
}

function LinkBtn({ editor }: { editor: Editor | null }) {
  const tGenerated = useGeneratedTranslations()
  return (
    <Btn
      label={tGenerated('m_197fef09772e0d')}
      disabled={!editor}
      active={!!editor && editor.isActive('link')}
      onClick={() => {
        if (!editor) return
        if (editor.isActive('link')) {
          editor.chain().focus().unsetLink().run()
          return
        }
        const url = window.prompt('Link URL (https://…)')
        if (!url) return
        const safeUrl = normalizeRichTextLinkUrl(url)
        if (!safeUrl) {
          toast.error(tGenerated('m_00c6e6d4556cc0'))
          return
        }
        editor.chain().focus().setLink({ href: safeUrl }).run()
      }}
    >
      <Link2 size={15} />
    </Btn>
  )
}

function ImageBtn({ editor }: { editor: Editor | null }) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <Btn
        label={tGenerated('m_05f9352b29d6ff')}
        disabled={!editor || busy}
        onClick={() => inputRef.current?.click()}
      >
        <GeneratedValue
          value={busy ? <Loader2 size={15} className="animate-spin" /> : <ImageIcon size={15} />}
        />
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
            const finalizeInput = await uploadReservedFile(req, file)
            const fin = await finalizeUpload(finalizeInput)
            if (!fin.ok) throw new Error(fin.error)
            editor.chain().focus().setImage({ src: fin.url, alt: file.name }).run()
          } catch (err) {
            toast.error(
              tGeneratedValue(err instanceof Error ? err.message : tGenerated('m_13c8c1e77439bf')),
            )
          } finally {
            setBusy(false)
          }
        }}
      />
    </>
  )
}
