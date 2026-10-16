'use client'

import { useEffect, useRef, useState } from 'react'
import type { Component, Editor } from 'grapesjs'
import { BlocksProvider } from '@grapesjs/react'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { TemplateBuilderBlockPalette } from './template-builder-block-palette'

const TABS = ['Blocks', 'Styles', 'Layers', 'Settings'] as const

/** Mount GrapesJS's own managers, retaining their state when changing tabs. */
export function TemplateBuilderSidebar({ editor }: { editor: Editor | null }) {
  const translate = useGeneratedValueTranslations()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Blocks')
  const [selected, setSelected] = useState<Component | null>(null)
  const [, setRevision] = useState(0)
  const styles = useRef<HTMLDivElement>(null)
  const layers = useRef<HTMLDivElement>(null)
  const traits = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editor) return
    const styleHost = styles.current
    const layerHost = layers.current
    const traitHost = traits.current
    styleHost?.appendChild(editor.StyleManager.render())
    layerHost?.appendChild(editor.LayerManager.render())
    traitHost?.appendChild(editor.TraitManager.render())
    const sync = () => {
      setSelected(editor.getSelected() ?? null)
      setRevision((value) => value + 1)
    }
    const events = [
      'component:selected',
      'component:deselected',
      'component:update',
      'undo',
      'redo',
    ]
    events.forEach((event) => editor.on(event, sync))
    sync()
    return () => {
      events.forEach((event) => editor.off(event, sync))
      styleHost?.replaceChildren()
      layerHost?.replaceChildren()
      traitHost?.replaceChildren()
    }
  }, [editor])

  const parent = selected?.parent()
  return (
    <aside className="template-builder-tools flex h-full min-h-0 w-52 shrink-0 flex-col border-r border-slate-200 bg-slate-50 text-slate-700 sm:w-64 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      <div className="flex gap-1 border-b border-slate-200 p-2 dark:border-slate-700">
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs disabled:opacity-40"
          disabled={!editor?.UndoManager.hasUndo()}
          onClick={() => editor?.UndoManager.undo()}
        >
          {translate('Undo')}
        </button>
        <button
          type="button"
          className="rounded border px-2 py-1 text-xs disabled:opacity-40"
          disabled={!editor?.UndoManager.hasRedo()}
          onClick={() => editor?.UndoManager.redo()}
        >
          {translate('Redo')}
        </button>
        <button
          type="button"
          className="ml-auto rounded border px-2 py-1 text-xs disabled:opacity-40"
          disabled={!parent}
          onClick={() => parent && editor?.select(parent)}
        >
          {translate('Select parent')}
        </button>
      </div>
      <div
        role="tablist"
        aria-label={translate('Template tools')}
        className="grid grid-cols-4 border-b border-slate-200 dark:border-slate-700"
      >
        {TABS.map((name) => (
          <button
            key={name}
            id={`template-tool-${name}`}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls={`template-panel-${name}`}
            onClick={() => setTab(name)}
            className={`px-1 py-2 text-xs ${tab === name ? 'bg-teal-600 text-white' : 'hover:bg-slate-200 dark:hover:bg-slate-800'}`}
          >
            {translate(name)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          role="tabpanel"
          id="template-panel-Blocks"
          aria-labelledby="template-tool-Blocks"
          hidden={tab !== 'Blocks'}
          className="p-3"
        >
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            {translate(
              'Double-click a cell to edit its text. Type spaces, punctuation or line breaks between fields. Drag fields into the cell or use Layers to move them.',
            )}
          </p>
          <BlocksProvider>{(props) => <TemplateBuilderBlockPalette {...props} />}</BlocksProvider>
        </div>
        <div
          role="tabpanel"
          id="template-panel-Styles"
          aria-labelledby="template-tool-Styles"
          hidden={tab !== 'Styles'}
          ref={styles}
        />
        <div
          role="tabpanel"
          id="template-panel-Layers"
          aria-labelledby="template-tool-Layers"
          hidden={tab !== 'Layers'}
          ref={layers}
        />
        <div
          role="tabpanel"
          id="template-panel-Settings"
          aria-labelledby="template-tool-Settings"
          hidden={tab !== 'Settings'}
        >
          {selected?.get('type') === 'record-value' && (
            <p className="p-3 text-xs">
              {translate(
                'This value fills from the record. Move, style, copy or delete it. To change the value, replace it with a field from Blocks.',
              )}{' '}
              <code className="break-all">
                <GeneratedValue value={selected.getEl()?.textContent ?? selected.toHTML()} />
              </code>
            </p>
          )}
          <div ref={traits} />
        </div>
      </div>
    </aside>
  )
}
