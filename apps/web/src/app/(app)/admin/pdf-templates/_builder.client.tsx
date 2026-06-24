'use client'

// Plain-HTML GrapesJS builder for PDF documents — same editable-HTML model as
// the email builder (Content blocks + Record-field tokens + drag-in data tables
// via data-each), but the canvas is styled as a PAPER PAGE (white column at the
// page content width on a gray surround). Pagination preview is the Preview tab
// (Paged.js); here it's a continuous page-width design surface.

import type { CSSProperties } from 'react'
import GjsEditor, { BlocksProvider, Canvas } from '@grapesjs/react'
import grapesjs, { type Editor } from 'grapesjs'
import 'grapesjs/dist/css/grapes.min.css'

const STARTER_HTML =
  '<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;">' +
  '<h1 style="font-size:22px;margin:0 0 8px;">Document title</h1>' +
  '<p style="font-size:13px;line-height:1.6;color:#334155;margin:0;">Drag content + record fields from the left.</p>' +
  '</div>'

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

function collectionTableHtml(c: Collection): string {
  const head = c.fields.map((f) => `<th style="${TH}">${f.label}</th>`).join('')
  const body = c.fields.map((f) => `<td style="${TD}">{{${f.key}}}</td>`).join('')
  return (
    `<table style="width:100%;border-collapse:collapse;margin:0 0 8px;">` +
    `<tr>${head}</tr><tr data-each="${c.key}">${body}</tr></table>`
  )
}

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
      '<p style="font-size:13px;line-height:1.6;color:#334155;margin:0 0 8px;">Your text here.</p>',
  },
  {
    id: 'image',
    label: 'Image',
    content:
      '<img src="https://placehold.co/600x180" alt="" style="max-width:100%;display:block;margin:6px 0;" />',
  },
  {
    id: 'divider',
    label: 'Divider',
    content: '<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0;" />',
  },
  {
    id: 'pagebreak',
    label: 'Page break',
    content:
      '<div style="break-after:page;page-break-after:always;height:0;font-size:0;">&nbsp;</div>',
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
      '<td style="width:50%;vertical-align:top;padding-right:8px;font-size:13px;color:#334155;">Column one</td>' +
      '<td style="width:50%;vertical-align:top;padding-left:8px;font-size:13px;color:#334155;">Column two</td>' +
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

export default function PdfBuilder({
  initialDesign,
  initialHtml,
  pageWidthPx,
  onReady,
  mergeFields = [],
  collections = [],
}: {
  initialDesign: Record<string, unknown> | null
  initialHtml?: string | null
  pageWidthPx: number
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
        options={{ height: '100%', storageManager: false, fromElement: false }}
        onEditor={(editor: Editor) => {
          const bm = editor.BlockManager
          for (const b of BASE_BLOCKS) {
            bm.add(b.id, { label: b.label, category: 'Content', content: b.content })
          }
          for (const f of mergeFields) {
            bm.add(`token:${f.key}`, {
              label: f.label || f.key,
              category: 'Record fields',
              content: `<span style="color:#0f172a;">{{${f.key}}}</span>`,
              media: TOKEN_SVG,
            })
          }
          for (const c of collections) {
            bm.add(`table:${c.key}`, {
              label: `${c.label} table`,
              category: 'Tables',
              content: collectionTableHtml(c),
              media: TABLE_SVG,
            })
          }
          // Style the canvas as a paper page once the iframe is ready.
          editor.on('load', () => {
            const doc = editor.Canvas.getBody()?.ownerDocument
            if (!doc) return
            const style = doc.createElement('style')
            style.innerHTML =
              `html{background:#e5e7eb;}` +
              `body{box-sizing:border-box;max-width:${pageWidthPx}px;margin:24px auto;` +
              `background:#fff;padding:36px;min-height:calc(100vh - 48px);` +
              `box-shadow:0 1px 6px rgba(0,0,0,.18);}`
            doc.head.appendChild(style)
          })
          try {
            if (initialDesign && Object.keys(initialDesign).length > 0) {
              editor.loadProjectData(initialDesign)
            } else if (initialHtml && initialHtml.trim()) {
              editor.setComponents(initialHtml)
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
          <div className="col-span-2 min-h-0 overflow-hidden">
            <Canvas className="h-full" />
          </div>
        </div>
      </GjsEditor>
    </div>
  )
}
