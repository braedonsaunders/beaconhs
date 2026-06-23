'use client'

// Plain-HTML GrapesJS email builder in a 1/3–2/3 layout (like the document
// editor). Runs in HTML mode (NO MJML) so every element — including the record
// data tables — is a real, editable component. Email-safe inline styles are
// authored directly; the repeating table rows carry a `data-each` marker that
// is expanded to a {{#each}} loop at compile (see compileBuilderHtml).
//   • LEFT 1/3  — palette: layout/content blocks + the record's merge-field
//     tokens (Record fields) + one drag-in table per collection (Tables).
//   • RIGHT 2/3 — the live canvas.
// Client-only (touches window) → always mounted via dynamic(ssr:false). Forces a
// LIGHT theme via GrapesJS CSS variables (its default chrome is dark).
//
// Scroll: the grid uses `grid-rows-1` so its single row is `minmax(0,1fr)` and
// fills the fixed-height container — without it the row sizes to content and the
// overflow is clipped by the wrapper (the "can't scroll to the bottom" bug).

import type { CSSProperties } from 'react'
import GjsEditor, { BlocksProvider, Canvas } from '@grapesjs/react'
import grapesjs, { type Editor } from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'

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

const TOKEN_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg>'
const TABLE_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16"/></svg>'

const TH =
  'text-align:left;border-bottom:2px solid #e2e8f0;padding:6px 8px;font-size:11px;color:#475569;font-weight:700;text-transform:uppercase'
const TD =
  'border-bottom:1px solid #eef2f7;padding:6px 8px;font-size:13px;color:#0f172a;vertical-align:top'

type MergeField = { key: string; label?: string }
type Collection = { key: string; label: string; fields: { key: string; label: string }[] }

// An EDITABLE record table: a real <table> with a header row + ONE body row
// carrying `data-each="<collection>"`. The marker (invisible in the canvas) is
// expanded to {{#each}} at compile, so the single editable row repeats per item.
function collectionTableHtml(c: Collection): string {
  const head = c.fields.map((f) => `<th style="${TH}">${f.label}</th>`).join('')
  const body = c.fields.map((f) => `<td style="${TD}">{{${f.key}}}</td>`).join('')
  return (
    `<table style="width:100%;border-collapse:collapse;margin:0 0 8px;">` +
    `<tr>${head}</tr>` +
    `<tr data-each="${c.key}">${body}</tr>` +
    `</table>`
  )
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
  initialDesign,
  initialMjml,
  onReady,
  mergeFields = [],
  collections = [],
}: {
  initialDesign: Record<string, unknown> | null
  /** Inline-styled HTML to seed the canvas when there is no saved design yet. */
  initialMjml?: string | null
  onReady: (editor: Editor) => void
  mergeFields?: MergeField[]
  collections?: Collection[]
}) {
  return (
    <div
      className="gjs-light flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-slate-900"
      style={LIGHT_THEME}
    >
      <GjsEditor
        grapesjs={grapesjs}
        options={{
          height: '100%',
          storageManager: false,
          fromElement: false,
          // HTML mode — no MJML plugin; components are real editable HTML.
        }}
        onEditor={(editor: Editor) => {
          const bm = editor.BlockManager
          for (const b of BASE_BLOCKS) {
            bm.add(b.id, { label: b.label, category: 'Content', content: b.content })
          }
          // Record tokens → draggable blocks (category "Record fields").
          for (const f of mergeFields) {
            bm.add(`token:${f.key}`, {
              label: f.label || f.key,
              category: 'Record fields',
              content: `<span style="color:#0f172a;">{{${f.key}}}</span>`,
              media: TOKEN_SVG,
            })
          }
          // Each collection → a drag-in editable table (category "Tables").
          for (const c of collections) {
            bm.add(`table:${c.key}`, {
              label: `${c.label} table`,
              category: 'Tables',
              content: collectionTableHtml(c),
              media: TABLE_SVG,
            })
          }
          // Saved design wins; else seed from the template's HTML; else starter.
          try {
            if (initialDesign && Object.keys(initialDesign).length > 0) {
              editor.loadProjectData(initialDesign)
            } else if (initialMjml && initialMjml.trim()) {
              editor.setComponents(initialMjml)
            } else {
              editor.setComponents(STARTER_HTML)
            }
          } catch {
            try {
              editor.setComponents(STARTER_HTML)
            } catch {
              /* noop */
            }
          }
          onReady(editor)
        }}
      >
        <div className="grid h-full min-h-0 grid-cols-3 grid-rows-1">
          {/* LEFT 1/3 — palette */}
          <aside className="col-span-1 min-h-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <BlocksProvider>
              {({ mapCategoryBlocks, dragStart, dragStop }) => (
                <div className="space-y-4 pb-6">
                  {Array.from(mapCategoryBlocks.entries()).map(([category, blocks]) => (
                    <div key={category || 'general'}>
                      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
                        {category || 'Elements'}
                      </p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {blocks.map((block) => (
                          <div
                            key={block.getId()}
                            draggable
                            onDragStart={(e) => dragStart(block, e.nativeEvent)}
                            onDragEnd={() => dragStop()}
                            title={block.getLabel()}
                            className="flex cursor-grab flex-col items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-2 text-center text-[10px] leading-tight text-slate-600 shadow-sm transition hover:border-teal-400 hover:text-teal-700 active:cursor-grabbing dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {block.getMedia() ? (
                              <span
                                className="text-slate-500 dark:text-slate-400"
                                dangerouslySetInnerHTML={{ __html: block.getMedia() as string }}
                              />
                            ) : null}
                            <span dangerouslySetInnerHTML={{ __html: block.getLabel() }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </BlocksProvider>
          </aside>

          {/* RIGHT 2/3 — the canvas */}
          <div className="col-span-2 min-h-0 overflow-hidden">
            <Canvas className="h-full" />
          </div>
        </div>
      </GjsEditor>
    </div>
  )
}
