'use client'
import { GeneratedValue } from '@/i18n/generated'

// Plain-HTML GrapesJS email builder in a palette and canvas layout (like the document
// editor). Runs in HTML mode (NO MJML) so every element — including the record
// data tables — is a real, editable component. Email-safe inline styles are
// authored directly; the repeating table rows carry a `data-each` marker that
// is expanded to a {{#each}} loop at compile (see compileBuilderHtml).
//   • LEFT  — palette: layout/content blocks + the record's merge-field
//     tokens (Record fields) + one drag-in table per collection (Tables).
//   • RIGHT — the live canvas.
// Client-only (touches window) → always mounted via dynamic(ssr:false). Forces a
// LIGHT theme via GrapesJS CSS variables (its default chrome is dark).
//
// Scroll: the grid uses `grid-rows-1` so its single row is `minmax(0,1fr)` and
// fills the fixed-height container — without it the row sizes to content and the
// overflow is clipped by the wrapper (the "can't scroll to the bottom" bug).

import { useState, type CSSProperties } from 'react'
import GjsEditor, { Canvas } from '@grapesjs/react'
import grapesjs, { type Editor } from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'
import { TemplateBuilderSidebar } from '@/components/template-builder-sidebar'
import { installTemplateComponents } from '../_template-components'
import {
  collectionTableBlockHtml,
  mergeFieldBlockHtml,
  type TemplateCollection,
  type TemplateMergeField,
} from '@/lib/template-builder-html'
import {
  installTableEditing,
  repairTables,
  TableColumnResizer,
  TableToolbar,
} from '../_table-tools'

const STARTER_HTML =
  '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;padding:24px;max-width:680px;margin:0 auto;">' +
  '<h1 style="font-size:20px;margin:0 0 8px;">Hello {{name}}</h1>' +
  '<p style="font-size:14px;line-height:1.6;color:#334155;margin:0;">Write your message here. Drag a field from the left to insert a token like {{site}}.</p>' +
  '</div>'

// Light-mode overrides for GrapesJS's (dark) chrome.
const LIGHT_THEME: CSSProperties & Record<string, string> = {
  '--gjs-primary-color': '#f1f5f9',
  '--gjs-secondary-color': '#334155',
  '--gjs-tertiary-color': '#0d9488',
  '--gjs-quaternary-color': '#0f766e',
  '--gjs-font-color': '#334155',
  '--gjs-font-color-active': '#0f172a',
  '--gjs-main-dark-color': '#e2e8f0',
}

// Standard email content/layout blocks (inline-styled, email-safe).
const BASE_BLOCKS: { id: string; label: string; content: string }[] = [
  {
    id: 'heading',
    label: 'Heading',
    content:
      '<h2 style="font-size:16px;font-weight:700;color:#0f172a;margin:16px 0 6px;border-bottom:2px solid #e2e8f0;padding-bottom:4px;">Section heading</h2>',
  },
  {
    id: 'text',
    label: 'Text',
    content:
      '<p style="font-size:14px;line-height:1.6;color:#334155;margin:0 0 8px;">Your text here.</p>',
  },
  {
    id: 'button',
    label: 'Button',
    content:
      '<a href="#" style="display:inline-block;background:#0d9488;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;margin:6px 0;">Open record</a>',
  },
  {
    id: 'image',
    label: 'Image',
    content:
      '<img src="https://placehold.co/600x180" alt="" style="max-width:100%;display:block;border-radius:6px;margin:6px 0;" />',
  },
  {
    id: 'divider',
    label: 'Divider',
    content: '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" />',
  },
  {
    id: 'spacer',
    label: 'Spacer',
    content: '<div style="height:16px;line-height:16px;">&nbsp;</div>',
  },
  {
    id: 'two-col',
    label: '2 columns',
    content:
      '<table style="width:100%;border-collapse:collapse;margin:6px 0;"><tr>' +
      '<td style="width:50%;vertical-align:top;padding-right:8px;font-size:14px;color:#334155;">Column one</td>' +
      '<td style="width:50%;vertical-align:top;padding-left:8px;font-size:14px;color:#334155;">Column two</td>' +
      '</tr></table>',
  },
  {
    id: 'detail-row',
    label: 'Label + value',
    content:
      '<table style="border-collapse:collapse;margin:0 0 2px;"><tr>' +
      '<td style="padding:4px 12px 4px 0;font-size:12px;color:#64748b;white-space:nowrap;">Label</td>' +
      '<td style="padding:4px 0;font-size:13px;color:#0f172a;">{{token}}</td>' +
      '</tr></table>',
  },
]

export default function EmailBuilder({
  initialHtml,
  onReady,
  mergeFields = [],
  collections = [],
}: {
  /** Inline-styled HTML to seed the canvas when there is no saved design yet. */
  initialHtml?: string | null
  onReady: (editor: Editor) => void
  mergeFields?: TemplateMergeField[]
  collections?: TemplateCollection[]
}) {
  const [editor, setEditor] = useState<Editor | null>(null)
  return (
    <div
      data-editor-ready={!!editor}
      className="gjs-light flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-slate-900"
      style={LIGHT_THEME}
    >
      <GjsEditor
        grapesjs={grapesjs}
        options={{
          height: '100%',
          storageManager: false,
          fromElement: false,
          panels: { defaults: [] },
          // All active controls use bundled SVGs; the default icon CDN is blocked by CSP.
          cssIcons: '',
          // HTML mode — no MJML plugin; components are real editable HTML.
        }}
        onEditor={(editor: Editor) => {
          const bm = editor.BlockManager
          for (const b of BASE_BLOCKS) {
            bm.add(b.id, { label: b.label, category: 'Content', content: b.content })
          }
          // Record tokens → draggable blocks (category "Record fields").
          for (const f of mergeFields) {
            const content = mergeFieldBlockHtml(f)
            if (!content) continue
            bm.add(`token:${f.key}`, {
              label: f.label || f.key,
              category: 'Record fields',
              content,
            })
          }
          // Each collection → a drag-in editable table (category "Tables").
          for (const c of collections) {
            const content = collectionTableBlockHtml(c)
            if (!content) continue
            bm.add(`table:${c.key}`, {
              label: `${c.label} table`,
              category: 'Tables',
              content,
            })
          }
          // Cells delete as whole columns; must be in place before components load.
          installTemplateComponents(editor)
          installTableEditing(editor)
          // Sanitized HTML+CSS is the sole editable source; else use the starter.
          editor.setComponents(initialHtml?.trim() ? initialHtml : STARTER_HTML)
          // Open tables whole: rows padded to one column count, widths filling 100%.
          repairTables(editor)
          editor.onReady(() => {
            setEditor(editor)
            onReady(editor)
          })
        }}
      >
        <div className="flex h-full min-h-0">
          {/* LEFT — palette */}
          <TemplateBuilderSidebar editor={editor} />

          {/* RIGHT — the canvas */}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {!editor && (
              <div
                role="status"
                className="absolute inset-0 z-30 flex items-center justify-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-300"
              >
                <GeneratedValue value="Loading editor…" />
              </div>
            )}
            <TableToolbar editor={editor} />
            <TableColumnResizer editor={editor} />
            <Canvas className="h-full" />
          </div>
        </div>
      </GjsEditor>
    </div>
  )
}
