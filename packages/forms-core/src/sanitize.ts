// Server-side sanitizer for rich-text document HTML (TipTap editor output and
// imported DOCX). Lives in forms-core so the web app, the PDF worker, and the
// email composer can all share one allow-list. Runs in Node via jsdom.
//
// DOMPurify's defaults already permit everything the editor emits — headings,
// lists, tables, <span style/class>, images, and data-* attributes (our comment
// + suggestion marks ride on data-comment-id / data-suggestion) — while
// stripping <script>, event handlers, and javascript: URIs. We only extend it
// to keep <a target> (with a forced rel) and TipTap's table `colwidth`.

import DOMPurify from 'isomorphic-dompurify'

// Links opened in a new tab must not leak window.opener (reverse tabnabbing).
// Typed structurally so this compiles in DOM-less (worker) tsconfigs too.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  const el = node as unknown as {
    tagName?: string
    getAttribute(name: string): string | null
    setAttribute(name: string, value: string): void
  }
  if (el.tagName === 'A' && el.getAttribute('target')) {
    el.setAttribute('rel', 'noopener noreferrer')
  }
})

/**
 * Sanitize rich-text document HTML for safe storage and rendering.
 * Returns '' for nullish input. Idempotent — safe to run on write and on render.
 */
export function sanitizeDocumentHtml(html: string | null | undefined): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'colwidth'],
    // We never author <style> blocks; inline style attributes are still allowed
    // and CSS-sanitized by DOMPurify.
    FORBID_TAGS: ['style'],
  })
}
