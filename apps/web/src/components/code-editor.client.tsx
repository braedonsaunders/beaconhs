'use client'

// A code editor for template HTML: syntax colouring for tags, attributes,
// attribute strings, comments, CSS in <style> and {{merge tokens}} /
// {{#if}} blocks, with line numbers, tag folding, tag matching and find /
// replace (Cmd/Ctrl-F, Cmd/Ctrl-Alt-F). It is CodeMirror 5 — the editor
// GrapesJS already ships — loaded on the client only, since it needs `window`.

import { useEffect, useRef, useState } from 'react'
import type { Editor } from 'codemirror'
import 'codemirror/lib/codemirror.css'
import 'codemirror/addon/fold/foldgutter.css'
import 'codemirror/addon/dialog/dialog.css'
import './code-editor.css'
import { useGeneratedValueTranslations } from '@/i18n/generated'

const MODE = 'beacon-template-html'

/** Phrases CodeMirror's find/replace dialogs show, keyed by their English text. */
const PHRASES = [
  'Search:',
  '(Use /re/ syntax for regexp search)',
  'Replace:',
  'Replace all:',
  'Replace with:',
  'With:',
  'Replace?',
  'Yes',
  'No',
  'All',
  'Stop',
] as const

let loading: Promise<typeof import('codemirror').default> | null = null

/** Load CodeMirror, its modes and add-ons once, and register the template mode. */
function loadCodeMirror() {
  loading ??= (async () => {
    const CodeMirror = (await import('codemirror')).default
    await Promise.all([
      import('codemirror/mode/htmlmixed/htmlmixed'),
      import('codemirror/mode/handlebars/handlebars'),
      import('codemirror/addon/mode/multiplex'),
      import('codemirror/addon/edit/matchtags'),
      import('codemirror/addon/edit/closetag'),
      import('codemirror/addon/fold/foldcode'),
      import('codemirror/addon/fold/foldgutter'),
      import('codemirror/addon/fold/xml-fold'),
      import('codemirror/addon/fold/brace-fold'),
      import('codemirror/addon/selection/active-line'),
      import('codemirror/addon/dialog/dialog'),
      import('codemirror/addon/search/searchcursor'),
      import('codemirror/addon/search/search'),
    ])
    // HTML (with CSS in <style>) carrying Handlebars bindings anywhere — text or
    // attribute values. `innerStyle` tags every binding token `cm-hbs`, so the
    // theme can set bindings apart from the markup around them.
    CodeMirror.defineMode(MODE, (config) =>
      CodeMirror.multiplexingMode(CodeMirror.getMode(config, 'text/html'), {
        open: '{{',
        close: /\}\}\}?/,
        mode: CodeMirror.getMode(config, 'handlebars-tags'),
        parseDelimiters: true,
        innerStyle: 'hbs',
      }),
    )
    return CodeMirror
  })()
  return loading
}

export function CodeEditor({
  value,
  onChange,
  ariaLabel,
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  className?: string
}) {
  const translate = useGeneratedValueTranslations()
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<Editor | null>(null)
  const [ready, setReady] = useState(false)
  // The latest props, read from inside CodeMirror's own callbacks.
  const latest = useRef({ value, onChange })
  const label = useRef({ ariaLabel, phrases: {} as Record<string, string> })
  useEffect(() => {
    latest.current = { value, onChange }
    label.current = {
      ariaLabel,
      phrases: Object.fromEntries(PHRASES.map((phrase) => [phrase, translate(phrase)])),
    }
  })

  useEffect(() => {
    let disposed = false
    let instance: Editor | null = null
    const onEdit = () => {
      if (!instance) return
      const next = instance.getValue()
      if (next !== latest.current.value) latest.current.onChange(next)
    }
    void loadCodeMirror().then((CodeMirror) => {
      if (disposed || !host.current) return
      instance = CodeMirror(host.current, {
        value: latest.current.value,
        mode: MODE,
        theme: 'default',
        lineNumbers: true,
        lineWrapping: true,
        tabSize: 2,
        indentUnit: 2,
        foldGutter: true,
        gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
        matchTags: { bothTags: true },
        autoCloseTags: true,
        styleActiveLine: true,
        screenReaderLabel: label.current.ariaLabel,
        phrases: label.current.phrases,
      })
      instance.on('change', onEdit)
      editor.current = instance
      setReady(true)
    })
    return () => {
      disposed = true
      instance?.off('change', onEdit)
      instance?.getWrapperElement().remove()
      editor.current = null
    }
  }, [])

  // Outside changes (Format, a tab switch) replace the text; keep the view put.
  useEffect(() => {
    const instance = editor.current
    if (!instance || instance.getValue() === value) return
    const scroll = instance.getScrollInfo()
    const cursor = instance.getCursor()
    instance.setValue(value)
    instance.setCursor(cursor)
    instance.scrollTo(scroll.left, scroll.top)
  }, [value, ready])

  return (
    <div
      className={`bhs-code-editor relative min-h-0 overflow-hidden rounded-md border border-slate-200 dark:border-slate-700 ${className}`}
    >
      {ready ? null : (
        <div role="status" className="absolute inset-0 p-3 text-xs text-slate-400">
          {translate('Loading editor…')}
        </div>
      )}
      {/* CodeMirror owns this node's children; React never renders into it. */}
      <div ref={host} className="h-full" />
    </div>
  )
}
