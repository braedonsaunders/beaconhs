'use client'

// The GrapesJS + MJML drag-and-drop email canvas. Client-only (touches window),
// always mounted via dynamic(ssr:false). Hands the live editor up via onReady so
// the wrapper can read getProjectData() (design) + getHtml() (MJML) on save.

import GjsEditor from '@grapesjs/react'
import grapesjs, { type Editor } from 'grapesjs'
import mjmlPlugin from 'grapesjs-mjml'
import 'grapesjs/dist/css/grapes.min.css'

const STARTER_MJML =
  '<mjml><mj-body><mj-section><mj-column>' +
  '<mj-text font-size="20px" font-weight="bold">Hello {{name}}</mj-text>' +
  '<mj-text>Write your message here. Insert tokens like {{site}} that fill in when the flow runs.</mj-text>' +
  '<mj-button href="https://example.com">Open</mj-button>' +
  '</mj-column></mj-section></mj-body></mjml>'

export default function EmailBuilder({
  initialDesign,
  onReady,
}: {
  initialDesign: Record<string, unknown> | null
  onReady: (editor: Editor) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      <GjsEditor
        grapesjs={grapesjs}
        options={{
          height: '70vh',
          storageManager: false,
          fromElement: false,
          plugins: [mjmlPlugin],
          // grapesjs-mjml ships its own block/style managers; default panels stay.
        }}
        onEditor={(editor: Editor) => {
          try {
            if (initialDesign && Object.keys(initialDesign).length > 0) {
              editor.loadProjectData(initialDesign)
            } else {
              editor.setComponents(STARTER_MJML)
            }
          } catch {
            // A malformed stored design shouldn't blank the editor — fall back.
            try {
              editor.setComponents(STARTER_MJML)
            } catch {
              /* noop */
            }
          }
          onReady(editor)
        }}
      />
    </div>
  )
}
