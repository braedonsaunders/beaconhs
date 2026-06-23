// @beaconhs/email-render — the single keystone that turns a `send_email` flow
// action (inline / template / design) into { subject, html, text } for
// enqueueEmail. Shared by BOTH the Builder/Forms flow runner and native-module
// flows so there is exactly one merge + render path.
//
// Safety model:
//   • Authored template HTML (admin-trusted, MJML-compiled) is sanitized ONCE at
//     SAVE time via `sanitizeEmailHtml` — NOT on every send.
//   • Untrusted merge values (form data) are HTML-escaped at interpolation time
//     when substituted into HTML (`escapeHtml: true`), so render-time injection
//     is impossible even though we don't re-sanitize the whole document per send.

import DOMPurify from 'isomorphic-dompurify'

// --- HTML escaping (matches the legacy inline shell in run-automations.ts) ---

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// --- {{token}} interpolation ------------------------------------------------

/**
 * Replace `{{ token }}` occurrences with values[token]. When `escapeHtml` is set,
 * only the SUBSTITUTED VALUE is HTML-escaped (the surrounding template is left
 * intact) — use that when interpolating into trusted HTML.
 */
export function interpolate(
  tpl: string,
  values: Record<string, unknown>,
  opts?: { escapeHtml?: boolean },
): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => {
    const v = values[k]
    const s = v == null ? '' : String(v)
    return opts?.escapeHtml ? escapeHtml(s) : s
  })
}

// --- Plain-text fallback ----------------------------------------------------

/** Derive a readable plain-text body from rendered HTML (for the text/* part). */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

// --- Sanitization (email allow-list; run at SAVE/compile time) ---------------

/**
 * Sanitize authored email HTML. Loosens DOMPurify's defaults for the tags/attrs
 * legitimate emails need (full document, <style>, tables, bgcolor/align/…) while
 * keeping its safe-by-default stripping of <script>, event handlers, and
 * javascript: URIs. Idempotent — safe to run again on read.
 */
export function sanitizeEmailHtml(html: string): string {
  return String(
    DOMPurify.sanitize(html, {
      WHOLE_DOCUMENT: true,
      ADD_TAGS: ['style', 'meta', 'link', 'title', 'head', 'body', 'html', 'center'],
      ADD_ATTR: [
        'style',
        'class',
        'bgcolor',
        'background',
        'align',
        'valign',
        'width',
        'height',
        'border',
        'cellpadding',
        'cellspacing',
        'dir',
        'lang',
        'role',
        'target',
      ],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea'],
      ALLOW_DATA_ATTR: false,
    }),
  )
}

// --- The single render entry point ------------------------------------------

export type RenderableEmail =
  // Legacy inline body — byte-for-byte the old run-automations.ts shell.
  | { mode: 'inline'; subject: string; bodyTemplate: string }
  // A saved library template OR a one-off design: pre-sanitized, compiled HTML
  // with {{tokens}} still embedded.
  | { mode: 'template' | 'design'; subjectTemplate: string; compiledHtml: string }

export type RenderedEmail = { subject: string; html: string; text: string }

const INLINE_SHELL_OPEN =
  '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;max-width:680px;white-space:pre-wrap;">'
const INLINE_SHELL_CLOSE = '</div>'

export function renderEmail(spec: RenderableEmail, values: Record<string, unknown>): RenderedEmail {
  if (spec.mode === 'inline') {
    const subject = interpolate(spec.subject, values) || 'Notification'
    const text = interpolate(spec.bodyTemplate, values)
    const html = `${INLINE_SHELL_OPEN}${escapeHtml(text)}${INLINE_SHELL_CLOSE}`
    return { subject, html, text }
  }
  // template | design — interpolate escaped values into trusted, pre-sanitized HTML.
  const subject = interpolate(spec.subjectTemplate, values) || 'Notification'
  const html = interpolate(spec.compiledHtml, values, { escapeHtml: true })
  const text = htmlToPlainText(html)
  return { subject, html, text }
}
