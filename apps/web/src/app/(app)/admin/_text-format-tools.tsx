'use client'

// Text formatting for the selected element in the template builders (email +
// pdf). A record value — {{driver_name}}, {{total_km}} — is one atomic piece,
// so the rich-text bar that appears while typing in a cell cannot bold it; this
// bar styles the selection as a whole: the value, a heading, a paragraph or a
// table cell. Styles are written through GrapesJS (`setStyle`), which is what
// the designer saves as the template's <style> rules, so the builder canvas,
// the Paged.js preview and the worker PDF all render the same formatting.

import { useEffect, useState, type ReactNode } from 'react'
import type { Component, Editor } from 'grapesjs'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  RemoveFormatting,
  Underline,
} from 'lucide-react'
import { useGeneratedValueTranslations } from '@/i18n/generated'
import {
  TEXT_FORMAT_PROPERTIES,
  isFormattable,
  readTextFormat,
  textFormatPatch,
  type TextAlign,
  type TextFormat,
  type TextFormatChange,
} from './_text-format'

const BTN =
  'inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-700'
const ON = 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-100'

function formattable(editor: Editor): Component | null {
  const selected = editor.getSelected()
  return selected && isFormattable(selected) ? selected : null
}

function computedFormat(cmp: Component): TextFormat | null {
  const el = cmp.getEl()
  const view = el?.ownerDocument.defaultView
  if (!el || !view) return null
  return readTextFormat(view.getComputedStyle(el))
}

function apply(editor: Editor, change: TextFormatChange): void {
  const cmp = formattable(editor)
  if (!cmp) return
  const current = computedFormat(cmp)
  if (!current) return
  const own = { ...cmp.getStyle() } as Record<string, string>
  cmp.setStyle(textFormatPatch(own, current, change))
  editor.trigger('change:canvasOffset')
}

/** Floats over the canvas while a text element is selected. */
export function TextFormatToolbar({ editor }: { editor: Editor | null }) {
  const translate = useGeneratedValueTranslations()
  const [format, setFormat] = useState<TextFormat | null>(null)
  const [size, setSize] = useState('')

  useEffect(() => {
    if (!editor) return
    let frame = 0
    const sync = () => {
      // Styles land in the canvas on the next frame; read them after that.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const cmp = formattable(editor)
        const next = cmp ? computedFormat(cmp) : null
        setFormat(next)
        setSize(next ? String(next.fontSizePx) : '')
      })
    }
    const events = [
      'component:selected',
      'component:deselected',
      'component:update',
      'component:styleUpdate',
      'undo',
      'redo',
    ]
    events.forEach((event) => editor.on(event, sync))
    sync()
    return () => {
      cancelAnimationFrame(frame)
      events.forEach((event) => editor.off(event, sync))
    }
  }, [editor])

  if (!editor || !format) return null

  const applySize = (raw: string) => {
    const px = Number(raw)
    if (Number.isFinite(px) && px > 0) apply(editor, { fontSizePx: px })
  }
  const alignButton = (align: TextAlign, icon: ReactNode, label: string) => (
    <button
      type="button"
      className={`${BTN} ${format.align === align ? ON : ''}`}
      aria-pressed={format.align === align}
      aria-label={translate(label)}
      title={translate(label)}
      onClick={() => apply(editor, { align })}
    >
      {icon}
    </button>
  )

  return (
    <div
      role="toolbar"
      aria-label={translate('Text format')}
      className="pointer-events-auto flex flex-wrap items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white/95 px-2 py-1 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/95"
    >
      <span className="px-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        {translate('Text')}
      </span>
      <button
        type="button"
        className={`${BTN} ${format.bold ? ON : ''}`}
        aria-pressed={format.bold}
        aria-label={translate('Bold')}
        title={translate('Bold')}
        onClick={() => apply(editor, { bold: !format.bold })}
      >
        <Bold size={14} />
      </button>
      <button
        type="button"
        className={`${BTN} ${format.italic ? ON : ''}`}
        aria-pressed={format.italic}
        aria-label={translate('Italic')}
        title={translate('Italic')}
        onClick={() => apply(editor, { italic: !format.italic })}
      >
        <Italic size={14} />
      </button>
      <button
        type="button"
        className={`${BTN} ${format.underline ? ON : ''}`}
        aria-pressed={format.underline}
        aria-label={translate('Underline')}
        title={translate('Underline')}
        onClick={() => apply(editor, { underline: !format.underline })}
      >
        <Underline size={14} />
      </button>
      <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-600" />
      <label className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
        {translate('Size (px)')}
        <input
          type="number"
          min={6}
          max={96}
          step={0.5}
          value={size}
          onChange={(e) => setSize(e.target.value)}
          onBlur={(e) => applySize(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applySize((e.target as HTMLInputElement).value)
          }}
          aria-label={translate('Font size in pixels')}
          className="h-6 w-14 rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
        />
      </label>
      <label
        className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400"
        title={translate('Text colour')}
      >
        <span className="sr-only">{translate('Text colour')}</span>
        <input
          type="color"
          value={format.color}
          onChange={(e) => apply(editor, { color: e.target.value })}
          className="h-6 w-7 cursor-pointer rounded border border-slate-300 bg-white p-0.5 dark:border-slate-600 dark:bg-slate-900"
        />
      </label>
      {format.block ? (
        <>
          <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-600" />
          {alignButton('left', <AlignLeft size={14} />, 'Align left')}
          {alignButton('center', <AlignCenter size={14} />, 'Align centre')}
          {alignButton('right', <AlignRight size={14} />, 'Align right')}
        </>
      ) : null}
      <span className="mx-0.5 h-4 w-px bg-slate-200 dark:bg-slate-600" />
      <button
        type="button"
        className={BTN}
        aria-label={translate('Clear text formatting')}
        title={translate('Clear text formatting')}
        onClick={() => {
          const cmp = formattable(editor)
          if (!cmp) return
          const own = { ...cmp.getStyle() } as Record<string, string>
          for (const property of TEXT_FORMAT_PROPERTIES) delete own[property]
          cmp.setStyle(own)
          editor.trigger('change:canvasOffset')
        }}
      >
        <RemoveFormatting size={14} />
      </button>
    </div>
  )
}
