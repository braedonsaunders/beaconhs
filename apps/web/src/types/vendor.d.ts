declare module 'pagedjs' {
  // Paged.js — paginates HTML/CSS into page boxes in the browser. Aliased in
  // next.config.ts to its pre-built ESM bundle (dist/paged.esm.js); see
  // _paged-preview.client.tsx for why.
  export class Previewer {
    constructor()
    preview(
      content?: string | HTMLElement,
      stylesheets?: unknown[],
      renderTo?: HTMLElement,
    ): Promise<{ total: number; pages: unknown[] }>
  }
}

declare module 'codemirror' {
  // CodeMirror 5 — the editor GrapesJS ships. Only the surface the template
  // HTML editor (components/code-editor.client.tsx) uses is declared here.
  export type Mode = { token: (...args: never[]) => string | null }
  export type MultiplexOverlay = {
    open: string
    close: string | RegExp
    mode: Mode
    parseDelimiters?: boolean
    innerStyle?: string
  }
  export type EditorConfiguration = {
    value?: string
    mode?: string
    theme?: string
    lineNumbers?: boolean
    lineWrapping?: boolean
    tabSize?: number
    indentUnit?: number
    foldGutter?: boolean
    gutters?: string[]
    matchTags?: { bothTags?: boolean }
    autoCloseTags?: boolean
    styleActiveLine?: boolean
    screenReaderLabel?: string
    phrases?: Record<string, string>
  }
  export type Editor = {
    getValue(): string
    setValue(value: string): void
    on(event: 'change', handler: () => void): void
    off(event: 'change', handler: () => void): void
    refresh(): void
    getScrollInfo(): { left: number; top: number }
    scrollTo(x: number, y: number): void
    getCursor(): { line: number; ch: number }
    setCursor(position: { line: number; ch: number }): void
    getWrapperElement(): HTMLElement
  }
  type CodeMirror = {
    (host: HTMLElement, options?: EditorConfiguration): Editor
    defineMode(name: string, factory: (config: unknown) => Mode): void
    getMode(config: unknown, spec: string): Mode
    multiplexingMode(outer: Mode, ...overlays: MultiplexOverlay[]): Mode
  }
  const CodeMirror: CodeMirror
  export default CodeMirror
}

declare module 'codemirror/mode/*'
declare module 'codemirror/addon/*'
