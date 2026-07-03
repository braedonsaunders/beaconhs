'use client'

// TipTap-based rich text editor.
//
// Outputs HTML via `onChange(html)`. Stable enough to use in forms with a
// hidden input (set `name` and `defaultValue`) — the latest HTML mirrors
// into the hidden input on every edit so a `formData.get(name)` server
// action call gets the current content.

import { useEffect, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { cn } from './utils'

export type RichTextEditorProps = {
  /** Initial HTML content. */
  defaultValue?: string
  /** Called on every edit with the latest HTML. */
  onChange?: (html: string) => void
  /** Optional hidden input name so the editor works inside a <form>. */
  name?: string
  /** Placeholder text shown when empty. */
  placeholder?: string
  /** Disabled / read-only flag. */
  disabled?: boolean
  /** Extra classes on the outer wrapper. */
  className?: string
  /** Min editor height (default '160px'). */
  minHeight?: string
}

export function RichTextEditor({
  defaultValue = '',
  onChange,
  name,
  placeholder = 'Start typing…',
  disabled = false,
  className,
  minHeight = '160px',
}: RichTextEditorProps) {
  // TipTap v3 does not re-render the host component on transactions
  // (`shouldRerenderOnTransaction` defaults to false), so the latest HTML is
  // mirrored into React state from `onUpdate` to keep the hidden form input
  // current. Toolbar state is driven by `useEditorState` (see Toolbar below).
  const [html, setHtml] = useState(defaultValue)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'text-teal-700 underline underline-offset-2 dark:text-teal-300' },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: defaultValue,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm prose-slate max-w-none focus:outline-none dark:prose-invert',
          'min-h-[var(--rt-min-h)] px-4 py-3',
        ),
        style: `--rt-min-h: ${minHeight}`,
      },
    },
    onUpdate({ editor }) {
      const next = editor.getHTML()
      setHtml(next)
      onChange?.(next)
    },
  })

  // Keep editor in sync if `disabled` toggles after mount.
  useEffect(() => {
    if (editor && editor.isEditable !== !disabled) {
      editor.setEditable(!disabled)
    }
  }, [editor, disabled])

  if (!editor) {
    return (
      <div
        className={cn(
          'rounded-md border border-slate-300 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900',
          className,
        )}
        style={{ minHeight }}
      />
    )
  }

  return (
    <div
      className={cn(
        'rounded-md border border-slate-300 bg-white shadow-sm transition-shadow dark:border-slate-700 dark:bg-slate-900',
        'focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/40',
        disabled && 'opacity-60',
        className,
      )}
    >
      <Toolbar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
      {name ? <input type="hidden" name={name} value={html} readOnly /> : null}
    </div>
  )
}

// ---- Toolbar ---------------------------------------------------------------

function Toolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  // TipTap v3 doesn't re-render on transactions, so subscribe to the slices of
  // editor state the toolbar needs (active marks/nodes + undo/redo ability).
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50/50 px-2 py-1 dark:border-slate-800 dark:bg-slate-800/50">
      <Btn
        active={state.bold}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
        label="Bold"
      >
        <b>B</b>
      </Btn>
      <Btn
        active={state.italic}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        label="Italic"
      >
        <i>I</i>
      </Btn>
      <Btn
        active={state.strike}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        label="Strikethrough"
      >
        <s>S</s>
      </Btn>
      <Sep />
      <Btn
        active={state.h1}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        label="Heading 1"
      >
        H1
      </Btn>
      <Btn
        active={state.h2}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="Heading 2"
      >
        H2
      </Btn>
      <Btn
        active={state.h3}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        label="Heading 3"
      >
        H3
      </Btn>
      <Sep />
      <Btn
        active={state.bulletList}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        label="Bullet list"
      >
        •
      </Btn>
      <Btn
        active={state.orderedList}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        label="Numbered list"
      >
        1.
      </Btn>
      <Btn
        active={state.blockquote}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        label="Quote"
      >
        “”
      </Btn>
      <Btn
        active={state.codeBlock}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        label="Code"
      >
        {'</>'}
      </Btn>
      <Sep />
      <Btn
        active={state.link}
        disabled={disabled}
        onClick={() => {
          const existing = editor.getAttributes('link').href as string | undefined
          const url = window.prompt('Link URL', existing ?? 'https://')
          if (url === null) return
          if (url === '') {
            editor.chain().focus().extendMarkRange('link').unsetLink().run()
            return
          }
          editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
        }}
        label="Link"
      >
        🔗
      </Btn>
      <div className="ml-auto flex items-center gap-0.5">
        <Btn
          disabled={disabled || !state.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
          label="Undo"
        >
          ↶
        </Btn>
        <Btn
          disabled={disabled || !state.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
          label="Redo"
        >
          ↷
        </Btn>
      </div>
    </div>
  )
}

function Btn({
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
        'inline-flex h-7 min-w-[28px] items-center justify-center rounded px-2 text-xs font-medium transition-colors',
        active
          ? 'bg-teal-100 text-teal-900 dark:bg-teal-900/50 dark:text-teal-100'
          : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100',
        disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
      )}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
}
