'use client'

// GrapesJS + MJML email builder in a 1/3–2/3 layout (like the document editor):
//   • LEFT 1/3  — palette: the record's merge fields/tokens + standard email
//     elements (MJML blocks), grouped by category, drag into the canvas.
//   • RIGHT 2/3 — the live canvas.
// Client-only (touches window) → always mounted via dynamic(ssr:false). Forces a
// LIGHT theme via GrapesJS CSS variables (its default chrome is dark).

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

type MergeField = { key: string; label?: string }

export default function EmailBuilder({
  initialDesign,
  onReady,
  mergeFields = [],
}: {
  initialDesign: Record<string, unknown> | null
  onReady: (editor: Editor) => void
  mergeFields?: MergeField[]
}) {
  return (
    <div
      className="gjs-light overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700"
      style={LIGHT_THEME}
    >
      <GjsEditor
        grapesjs={grapesjs}
        options={{
          height: '72vh',
          storageManager: false,
          fromElement: false,
          plugins: [mjmlPlugin],
        }}
        onEditor={(editor: Editor) => {
          // Register the record's tokens as draggable blocks (category "Record
          // fields") — dropping one inserts an <mj-text> with the {{token}}.
          for (const f of mergeFields) {
            editor.Blocks.add(`token:${f.key}`, {
              label: f.label || f.key,
              category: 'Record fields',
              content: `<mj-text>{{${f.key}}}</mj-text>`,
              media:
                '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg>',
            })
          }
          try {
            if (initialDesign && Object.keys(initialDesign).length > 0) {
              editor.loadProjectData(initialDesign)
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
        <div className="grid h-[72vh] grid-cols-3">
          {/* LEFT 1/3 — palette: record fields + standard email elements */}
          <aside className="col-span-1 min-h-0 overflow-y-auto border-r border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <BlocksProvider>
              {({ mapCategoryBlocks, dragStart, dragStop }) => (
                <div className="space-y-4">
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
          <div className="col-span-2 min-h-0">
            <Canvas className="h-full" />
          </div>
        </div>
      </GjsEditor>
    </div>
  )
}
