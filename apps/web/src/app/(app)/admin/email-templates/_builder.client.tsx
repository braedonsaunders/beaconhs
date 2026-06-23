'use client'

// GrapesJS + MJML email builder in a 1/3–2/3 layout (like the document editor):
//   • LEFT 1/3  — palette: the record's merge fields/tokens + repeating "table"
//     blocks (one per collection) + standard email elements (MJML blocks).
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
import mjmlPlugin from 'grapesjs-mjml'
import 'grapesjs/dist/css/grapes.min.css'

const STARTER_MJML =
  '<mjml><mj-body><mj-section><mj-column>' +
  '<mj-text font-size="20px" font-weight="bold">Hello {{name}}</mj-text>' +
  '<mj-text>Write your message here. Drag a field from the left to insert a token like {{site}}.</mj-text>' +
  '<mj-button href="https://example.com">Open</mj-button>' +
  '</mj-column></mj-section></mj-body></mjml>'

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

type MergeField = { key: string; label?: string }
type Collection = { key: string; label: string; fields: { key: string; label: string }[] }

const TH_STYLE =
  'text-align:left;border-bottom:2px solid #e2e8f0;padding:6px 8px;font-size:12px;color:#475569;font-weight:bold'
const TD_STYLE =
  'border-bottom:1px solid #eef2f7;padding:6px 8px;font-size:13px;color:#0f172a;vertical-align:top'

// MJML for a collection's `{{#each}}` table — a leading "#" column (1-based row
// number) + one column per field. mj-table preserves the mustache (incl.
// {{@number}}) through compile, so the loop survives end-to-end.
function collectionTableMjml(c: Collection): string {
  const headCells =
    `<th style="${TH_STYLE};width:28px">#</th>` +
    c.fields.map((f) => `<th style="${TH_STYLE}">${f.label}</th>`).join('')
  const bodyCells =
    `<td style="${TD_STYLE}">{{@number}}</td>` +
    c.fields.map((f) => `<td style="${TD_STYLE}">{{${f.key}}}</td>`).join('')
  return (
    '<mj-table cellpadding="0" cellspacing="0" width="100%">' +
    `<tr>${headCells}</tr>` +
    `{{#each ${c.key}}}<tr>${bodyCells}</tr>{{/each}}` +
    '</mj-table>'
  )
}

export default function EmailBuilder({
  initialDesign,
  initialMjml,
  onReady,
  mergeFields = [],
  collections = [],
}: {
  initialDesign: Record<string, unknown> | null
  /** MJML source to seed the canvas when there is no saved GrapesJS design yet. */
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
          plugins: [mjmlPlugin],
        }}
        onEditor={(editor: Editor) => {
          // Record tokens → draggable blocks (category "Record fields"); dropping
          // one inserts an <mj-text> with the {{token}}.
          for (const f of mergeFields) {
            editor.Blocks.add(`token:${f.key}`, {
              label: f.label || f.key,
              category: 'Record fields',
              content: `<mj-text>{{${f.key}}}</mj-text>`,
              media: TOKEN_SVG,
            })
          }
          // Each collection → a draggable {{#each}} table block (category "Tables").
          for (const c of collections) {
            editor.Blocks.add(`table:${c.key}`, {
              label: `${c.label} table`,
              category: 'Tables',
              content: collectionTableMjml(c),
              media: TABLE_SVG,
            })
          }
          // Saved GrapesJS design wins; else seed the canvas from the template's
          // MJML (record-report templates ship MJML, no saved design yet); else
          // the generic starter.
          try {
            if (initialDesign && Object.keys(initialDesign).length > 0) {
              editor.loadProjectData(initialDesign)
            } else if (initialMjml && initialMjml.trim()) {
              editor.setComponents(initialMjml)
            } else {
              editor.setComponents(STARTER_MJML)
            }
          } catch {
            try {
              editor.setComponents(STARTER_MJML)
            } catch {
              /* noop */
            }
          }
          onReady(editor)
        }}
      >
        <div className="grid h-full min-h-0 grid-cols-3 grid-rows-1">
          {/* LEFT 1/3 — palette: record fields + tables + standard email elements */}
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
