// Ambient declarations for email-builder libraries that ship no types.

declare module 'mjml' {
  interface MjmlError {
    line?: number
    message?: string
    formattedMessage?: string
    tagName?: string
  }
  interface Mjml2HtmlResult {
    html: string
    errors: MjmlError[]
  }
  export default function mjml2html(
    mjml: string,
    options?: {
      validationLevel?: 'strict' | 'soft' | 'skip'
      minify?: boolean
      keepComments?: boolean
      beautify?: boolean
      fonts?: Record<string, string>
      [key: string]: unknown
    },
  ): Mjml2HtmlResult
}

declare module 'grapesjs-mjml' {
  // The plugin is a GrapesJS plugin function; typed loosely to avoid fighting
  // @grapesjs/react's expected plugin signature.
  const plugin: (editor: unknown, opts?: Record<string, unknown>) => void
  export default plugin
}

declare module 'pagedjs' {
  // Paged.js polyfill — paginates HTML/CSS into page boxes in the browser.
  export class Previewer {
    constructor()
    preview(
      content?: string | HTMLElement,
      stylesheets?: unknown[],
      renderTo?: HTMLElement,
    ): Promise<{ total: number; pages: unknown[] }>
  }
}
