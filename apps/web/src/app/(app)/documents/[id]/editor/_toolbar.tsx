'use client'

// The document editor's formatting toolbar. Reads active state straight off the
// editor (useEditor re-renders on every transaction), so buttons reflect the
// current selection.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Subscript as SubIcon,
  Superscript as SupIcon,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code2,
  Link2,
  Image as ImageIcon,
  Table as TableIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  IndentIncrease,
  IndentDecrease,
  Baseline,
  Highlighter,
  RemoveFormatting,
  SeparatorHorizontal,
  Undo2,
  Redo2,
  ChevronDown,
  Search,
} from 'lucide-react'
import { cn, FileUploader } from '@beaconhs/ui'
import { requestUpload, finalizeUpload } from '@/lib/uploads'
import { FONT_FAMILIES, FONT_SIZES, LINE_SPACINGS, TEXT_COLORS, HIGHLIGHT_COLORS } from './_lib'

export function FormattingToolbar({
  editor,
  onToggleFind,
}: {
  editor: Editor
  onToggleFind: () => void
}) {
  const inTable = editor.isActive('table')
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 py-1">
      <Btn label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={15} />
      </Btn>
      <Btn label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={15} />
      </Btn>
      <Sep />

      <ParagraphStyleSelect editor={editor} />
      <FontFamilySelect editor={editor} />
      <FontSizeSelect editor={editor} />
      <Sep />

      <Btn label="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={15} />
      </Btn>
      <Btn label="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={15} />
      </Btn>
      <Btn label="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon size={15} />
      </Btn>
      <Btn label="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={15} />
      </Btn>
      <ColorMenu editor={editor} mode="text" />
      <ColorMenu editor={editor} mode="highlight" />
      <Btn label="Subscript" active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}>
        <SubIcon size={15} />
      </Btn>
      <Btn label="Superscript" active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
        <SupIcon size={15} />
      </Btn>
      <Sep />

      <Btn label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
        <AlignLeft size={15} />
      </Btn>
      <Btn label="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
        <AlignCenter size={15} />
      </Btn>
      <Btn label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
        <AlignRight size={15} />
      </Btn>
      <Btn label="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>
        <AlignJustify size={15} />
      </Btn>
      <LineSpacingMenu editor={editor} />
      <Sep />

      <Btn label="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={15} />
      </Btn>
      <Btn label="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={15} />
      </Btn>
      <Btn label="Checklist" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks size={15} />
      </Btn>
      <Btn label="Decrease indent" onClick={() => editor.chain().focus().outdent().run()}>
        <IndentDecrease size={15} />
      </Btn>
      <Btn label="Increase indent" onClick={() => editor.chain().focus().indent().run()}>
        <IndentIncrease size={15} />
      </Btn>
      <Sep />

      <Btn label="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={15} />
      </Btn>
      <Btn label="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <Code2 size={15} />
      </Btn>
      <Btn label="Link" active={editor.isActive('link')} onClick={() => setLink(editor)}>
        <Link2 size={15} />
      </Btn>
      <ImageInsert editor={editor} />
      <TableMenu editor={editor} inTable={inTable} />
      <Btn label="Page break" onClick={() => editor.chain().focus().setPageBreak().run()}>
        <SeparatorHorizontal size={15} />
      </Btn>
      <Btn label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <RemoveFormatting size={15} />
      </Btn>

      <div className="ml-auto flex items-center gap-0.5">
        <Btn label="Find & replace (⌘F)" onClick={onToggleFind}>
          <Search size={15} />
        </Btn>
      </div>
    </div>
  )
}

// ---- Selects ---------------------------------------------------------------

function ParagraphStyleSelect({ editor }: { editor: Editor }) {
  const current = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : 'p'
  return (
    <ToolbarSelect
      value={current}
      title="Paragraph style"
      onChange={(v) => {
        const chain = editor.chain().focus()
        if (v === 'p') chain.setParagraph().run()
        else chain.toggleHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run()
      }}
      options={[
        { value: 'p', label: 'Normal text' },
        { value: 'h1', label: 'Heading 1' },
        { value: 'h2', label: 'Heading 2' },
        { value: 'h3', label: 'Heading 3' },
      ]}
      widthClass="w-28"
    />
  )
}

function FontFamilySelect({ editor }: { editor: Editor }) {
  const value = (editor.getAttributes('textStyle').fontFamily as string) || ''
  return (
    <ToolbarSelect
      value={value}
      title="Font"
      onChange={(v) => (v ? editor.chain().focus().setFontFamily(v).run() : editor.chain().focus().unsetFontFamily().run())}
      options={FONT_FAMILIES}
      widthClass="w-32"
    />
  )
}

function FontSizeSelect({ editor }: { editor: Editor }) {
  const value = (editor.getAttributes('textStyle').fontSize as string) || ''
  return (
    <ToolbarSelect
      value={value}
      title="Font size"
      onChange={(v) => (v ? editor.chain().focus().setFontSize(v).run() : editor.chain().focus().unsetFontSize().run())}
      options={[{ value: '', label: 'Size' }, ...FONT_SIZES.map((s) => ({ value: s, label: s.replace('px', '') }))]}
      widthClass="w-16"
    />
  )
}

function LineSpacingMenu({ editor }: { editor: Editor }) {
  return (
    <Dropdown trigger={<Baseline size={15} />} title="Line spacing" widthClass="w-28">
      {(close) => (
        <div className="py-1">
          {LINE_SPACINGS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => {
                editor.chain().focus().setLineHeight(s.value).run()
                close()
              }}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  )
}

function ToolbarSelect({
  value,
  onChange,
  options,
  title,
  widthClass,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  title: string
  widthClass: string
}) {
  return (
    <select
      title={title}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      className={cn(
        'doc-select h-8 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-1.5 text-xs text-slate-700 dark:text-slate-200 outline-none hover:border-slate-300 dark:hover:border-slate-700 focus:border-teal-400',
        widthClass,
      )}
    >
      {options.map((o) => (
        <option key={o.value || 'none'} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

// ---- Color + highlight -----------------------------------------------------

function ColorMenu({ editor, mode }: { editor: Editor; mode: 'text' | 'highlight' }) {
  const colors = mode === 'text' ? TEXT_COLORS : HIGHLIGHT_COLORS
  return (
    <Dropdown
      trigger={mode === 'text' ? <Baseline size={15} /> : <Highlighter size={15} />}
      title={mode === 'text' ? 'Text color' : 'Highlight'}
      widthClass="w-40"
    >
      {(close) => (
        <div className="p-2">
          <div className="grid grid-cols-5 gap-1.5">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => {
                  if (mode === 'text') editor.chain().focus().setColor(c).run()
                  else editor.chain().focus().setHighlight({ color: c }).run()
                  close()
                }}
                className="h-6 w-6 rounded border border-slate-200 dark:border-slate-700"
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              if (mode === 'text') editor.chain().focus().unsetColor().run()
              else editor.chain().focus().unsetHighlight().run()
              close()
            }}
            className="mt-2 w-full rounded px-2 py-1 text-left text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60"
          >
            Clear {mode === 'text' ? 'color' : 'highlight'}
          </button>
        </div>
      )}
    </Dropdown>
  )
}

// ---- Image + table ---------------------------------------------------------

function ImageInsert({ editor }: { editor: Editor }) {
  return (
    <Dropdown trigger={<ImageIcon size={15} />} title="Insert image" widthClass="w-64">
      {(close) => (
        <div className="p-2">
          <FileUploader
            requestUploadAction={requestUpload}
            finalizeUploadAction={finalizeUpload}
            kind="image"
            accept="image/*"
            compact
            label="Drop an image or click to choose"
            onUploaded={(f) => {
              editor.chain().focus().setImage({ src: f.publicUrl, alt: f.filename }).run()
              close()
            }}
          />
        </div>
      )}
    </Dropdown>
  )
}

function TableMenu({ editor, inTable }: { editor: Editor; inTable: boolean }) {
  return (
    <Dropdown trigger={<TableIcon size={15} />} title="Table" widthClass="w-48">
      {(close) => (
        <div className="py-1 text-sm text-slate-700 dark:text-slate-200">
          <MenuItem
            onClick={() => {
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
              close()
            }}
          >
            Insert 3×3 table
          </MenuItem>
          {inTable ? (
            <>
              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
              <MenuItem onClick={() => editor.chain().focus().addRowAfter().run()}>Add row below</MenuItem>
              <MenuItem onClick={() => editor.chain().focus().addColumnAfter().run()}>Add column right</MenuItem>
              <MenuItem onClick={() => editor.chain().focus().deleteRow().run()}>Delete row</MenuItem>
              <MenuItem onClick={() => editor.chain().focus().deleteColumn().run()}>Delete column</MenuItem>
              <MenuItem onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Toggle header row</MenuItem>
              <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
              <MenuItem
                danger
                onClick={() => {
                  editor.chain().focus().deleteTable().run()
                  close()
                }}
              >
                Delete table
              </MenuItem>
            </>
          ) : null}
        </div>
      )}
    </Dropdown>
  )
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'block w-full px-3 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60',
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 dark:text-slate-200',
      )}
    >
      {children}
    </button>
  )
}

// ---- Primitives ------------------------------------------------------------

function setLink(editor: Editor) {
  const prev = editor.getAttributes('link').href as string | undefined
  const url = window.prompt('Link URL', prev ?? 'https://')
  if (url === null) return
  if (url === '') {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
}

function Btn({
  children,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 min-w-[28px] items-center justify-center rounded px-1.5 text-slate-600 dark:text-slate-300 transition-colors',
        active ? 'bg-teal-100 dark:bg-teal-950/50 text-teal-900 dark:text-teal-300' : 'hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100',
        disabled && 'cursor-not-allowed opacity-30 hover:bg-transparent',
      )}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
}

function Dropdown({
  trigger,
  title,
  widthClass,
  children,
}: {
  trigger: ReactNode
  title: string
  widthClass: string
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={title}
        aria-label={title}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-7 items-center gap-0.5 rounded px-1.5 text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100',
          open && 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100',
        )}
      >
        {trigger}
        <ChevronDown size={11} />
      </button>
      {open ? (
        <div
          className={cn(
            'absolute left-0 top-9 z-40 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg',
            widthClass,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}
