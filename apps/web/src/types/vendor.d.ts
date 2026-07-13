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
