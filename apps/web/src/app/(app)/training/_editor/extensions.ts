// Training-owned TipTap extension set for lesson content + slide regions.
// Same engine the Documents editor swallowed (TipTap/ProseMirror), assembled
// independently so training can extend it without touching documents (no
// comments / track-changes / pagination here — lessons don't need them).

import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import type { Extensions } from '@tiptap/core'

export function buildLessonExtensions(opts: { placeholder?: string } = {}): Extensions {
  return [
    // StarterKit bundles Link in v3 — disable so our styled Link is the only one.
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: {
        class: 'text-teal-700 underline underline-offset-2',
        rel: 'noopener noreferrer nofollow',
      },
    }),
    Image.configure({
      HTMLAttributes: { class: 'lesson-img' },
    }),
    Placeholder.configure({ placeholder: opts.placeholder ?? 'Start writing…' }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    Typography,
    TextStyle,
    Color,
    Underline,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
  ]
}
