// Assembles the full TipTap extension set for the document editor.
// FontSize/LineHeight/Color/FontFamily ship inside @tiptap/extension-text-style
// in v3. Comment + suggestion (track-changes) marks are layered in by the
// callers that need them (see _comment-mark / _ext/suggestion).

import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import { CharacterCount } from '@tiptap/extension-character-count'
import { Color, FontFamily, FontSize, LineHeight, TextStyle } from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import TextAlign from '@tiptap/extension-text-align'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import type { Extensions } from '@tiptap/core'
import { Indent } from './_ext/indent'
import { PageBreak } from './_ext/page-break'
import { ResizableImage } from './_ext/resizable-image'
import { FindReplace } from './_ext/find-replace'
import { CommentMark } from './_ext/comment-mark'
import { InsertionMark, DeletionMark, Suggestion } from './_ext/suggestion'
import { Pagination } from './_ext/pagination'

export function buildExtensions(opts: { placeholder?: string } = {}): Extensions {
  return [
    // StarterKit bundles Link in v3 — disable so our styled Link is the only one.
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: false }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      HTMLAttributes: {
        class: 'text-teal-700 underline underline-offset-2',
        rel: 'noopener noreferrer nofollow',
      },
    }),
    Placeholder.configure({ placeholder: opts.placeholder ?? 'Start writing your document…' }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    Typography,
    CharacterCount,
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    LineHeight,
    Underline,
    Subscript,
    Superscript,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Indent,
    PageBreak,
    ResizableImage.configure({ allowBase64: true }),
    FindReplace,
    CommentMark,
    InsertionMark,
    DeletionMark,
    Suggestion,
    Pagination,
  ]
}
