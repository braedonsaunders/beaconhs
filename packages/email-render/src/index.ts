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

// --- merge-value plainification ----------------------------------------------
//
// Merge values are record DATA, and rich-text fields store HTML ('<p>…</p>').
// Substituting them verbatim shows literal tags (escaped) or injects markup
// (raw). Every substituted value is therefore reduced to readable plain text —
// tags become text with line breaks preserved — before insertion; the authored
// template markup around it is untouched. `{{{raw}}}` stays the explicit
// opt-in for values that really are trusted HTML.

const HTML_VALUE_RE = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>|&(?:amp|lt|gt|quot|nbsp|#\d+);/i

/** Stringify a merge value; if it looks like HTML, reduce it to plain text. */
export function plainValue(v: unknown): string {
  const s = v == null ? '' : String(v)
  return HTML_VALUE_RE.test(s) ? htmlToPlainText(s) : s
}

// --- {{token}} interpolation (scalar only; inline path uses this) -----------

/**
 * Replace `{{ token }}` occurrences with values[token] (reduced to plain text —
 * see {@link plainValue}). When `escapeHtml` is set, only the SUBSTITUTED VALUE
 * is HTML-escaped (the surrounding template is left intact) — use that when
 * interpolating into trusted HTML. Scalar-only — for collections / conditionals
 * use {@link renderTemplate}.
 */
export function interpolate(
  tpl: string,
  values: Record<string, unknown>,
  opts?: { escapeHtml?: boolean },
): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k: string) => {
    const s = plainValue(values[k])
    return opts?.escapeHtml ? escapeHtml(s) : s
  })
}

// --- Block template engine ({{#each}} / {{#if}} / {{this.field}} / {{{raw}}}) -
//
// A small, dependency-free templating layer for the template/design render path
// so authored templates can render the record's COLLECTIONS as tables/lists,
// not just scalar header tokens. Grammar:
//   {{ path }}            escaped value (path = key, this, this.key, a.b.c, @index…)
//   {{{ path }}}          raw (unescaped) value — for fields that hold trusted HTML
//   {{#each coll}}…{{/each}}   iterate an array; inside, {{field}} is the item's field
//   {{#if path}}…{{else}}…{{/if}}   conditional (empty array / 0 / '' / null = false)
// Loop metadata inside #each: {{@index}} (0-based), {{@number}} (1-based),
// {{@first}}, {{@last}}, {{@length}}. Scalar-only templates render byte-identically
// to `interpolate`, preserving inline + existing template back-compat.

type Frame = { data: Record<string, unknown>; item?: unknown; meta?: Record<string, unknown> }

type TplNode =
  | { t: 'text'; v: string }
  | { t: 'var'; expr: string; raw: boolean }
  | { t: 'each'; expr: string; body: TplNode[] }
  | { t: 'if'; expr: string; body: TplNode[]; alt: TplNode[] }

type Tok =
  | { k: 'text'; v: string }
  | { k: 'var'; expr: string; raw: boolean }
  | { k: 'open'; block: 'each' | 'if'; expr: string }
  | { k: 'else' }
  | { k: 'close'; block: 'each' | 'if' }

const TAG_RE = /\{\{\{\s*([\s\S]*?)\s*\}\}\}|\{\{\s*([\s\S]*?)\s*\}\}/g

function tokenize(tpl: string): Tok[] {
  const toks: Tok[] = []
  let last = 0
  let m: RegExpExecArray | null
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(tpl))) {
    if (m.index > last) toks.push({ k: 'text', v: tpl.slice(last, m.index) })
    last = TAG_RE.lastIndex
    if (m[1] !== undefined) {
      toks.push({ k: 'var', expr: m[1].trim(), raw: true })
      continue
    }
    const inner = (m[2] ?? '').trim()
    if (inner.startsWith('#each'))
      toks.push({ k: 'open', block: 'each', expr: inner.slice(5).trim() })
    else if (inner.startsWith('#if'))
      toks.push({ k: 'open', block: 'if', expr: inner.slice(3).trim() })
    else if (inner === 'else') toks.push({ k: 'else' })
    else if (inner === '/each') toks.push({ k: 'close', block: 'each' })
    else if (inner === '/if') toks.push({ k: 'close', block: 'if' })
    else if (inner.startsWith('/')) {
      /* unknown close — drop */
    } else toks.push({ k: 'var', expr: inner, raw: false })
  }
  if (last < tpl.length) toks.push({ k: 'text', v: tpl.slice(last) })
  return toks
}

function parseBlock(toks: Tok[], i: { v: number }, until: (t: Tok) => boolean): TplNode[] {
  const nodes: TplNode[] = []
  while (i.v < toks.length) {
    const t = toks[i.v]
    if (!t) break
    if (until(t)) return nodes
    i.v++
    if (t.k === 'text') nodes.push({ t: 'text', v: t.v })
    else if (t.k === 'var') nodes.push({ t: 'var', expr: t.expr, raw: t.raw })
    else if (t.k === 'open' && t.block === 'each') {
      const body = parseBlock(toks, i, (x) => x.k === 'close' && x.block === 'each')
      if (toks[i.v]?.k === 'close') i.v++
      nodes.push({ t: 'each', expr: t.expr, body })
    } else if (t.k === 'open' && t.block === 'if') {
      const body = parseBlock(
        toks,
        i,
        (x) => x.k === 'else' || (x.k === 'close' && x.block === 'if'),
      )
      let alt: TplNode[] = []
      if (toks[i.v]?.k === 'else') {
        i.v++
        alt = parseBlock(toks, i, (x) => x.k === 'close' && x.block === 'if')
      }
      if (toks[i.v]?.k === 'close') i.v++
      nodes.push({ t: 'if', expr: t.expr, body, alt })
    }
    // stray else/close at this depth → dropped
  }
  return nodes
}

function resolvePath(expr: string, stack: Frame[]): unknown {
  const path = expr.trim()
  if (path === 'this' || path === '.') return stack[stack.length - 1]?.item
  if (path.startsWith('@')) {
    const key = path.slice(1)
    for (let i = stack.length - 1; i >= 0; i--) {
      const meta = stack[i]?.meta
      if (meta && key in meta) return meta[key]
    }
    return undefined
  }
  const parts = path.split('.')
  const head = parts[0] ?? ''
  let base: unknown
  if (head === 'this') {
    base = stack[stack.length - 1]?.item
  } else {
    for (let i = stack.length - 1; i >= 0; i--) {
      const d = stack[i]?.data
      if (d && typeof d === 'object' && Object.prototype.hasOwnProperty.call(d, head)) {
        base = d[head]
        break
      }
    }
  }
  for (const part of parts.slice(1)) {
    if (base == null || typeof base !== 'object') return undefined
    base = (base as Record<string, unknown>)[part]
  }
  return base
}

function isTruthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (v == null || v === false) return false
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v)
  if (typeof v === 'string') return v.length > 0
  return true
}

function renderNodes(nodes: TplNode[], stack: Frame[], escape: boolean): string {
  let out = ''
  for (const n of nodes) {
    if (n.t === 'text') {
      out += n.v
    } else if (n.t === 'var') {
      const v = resolvePath(n.expr, stack)
      // {{{raw}}} passes trusted HTML through untouched; plain {{tokens}} are
      // data — reduce HTML-bearing values to text, then escape when required.
      const s = n.raw ? (v == null ? '' : String(v)) : plainValue(v)
      out += escape && !n.raw ? escapeHtml(s) : s
    } else if (n.t === 'each') {
      const coll = resolvePath(n.expr, stack)
      if (Array.isArray(coll)) {
        for (let idx = 0; idx < coll.length; idx++) {
          const item = coll[idx]
          stack.push({
            data: item && typeof item === 'object' ? (item as Record<string, unknown>) : {},
            item,
            meta: {
              index: idx,
              number: idx + 1,
              first: idx === 0,
              last: idx === coll.length - 1,
              length: coll.length,
            },
          })
          out += renderNodes(n.body, stack, escape)
          stack.pop()
        }
      }
    } else if (n.t === 'if') {
      out += renderNodes(isTruthy(resolvePath(n.expr, stack)) ? n.body : n.alt, stack, escape)
    }
  }
  return out
}

/**
 * Render an authored template that may contain {{#each}} / {{#if}} blocks and
 * dotted paths, against `values`. Scalar `{{token}}` output is byte-identical to
 * {@link interpolate}. When `escapeHtml` is set, substituted values are escaped
 * (use {@link `{{{raw}}}`} to opt a field out, e.g. a sanitized rich-text field).
 */
export function renderTemplate(
  tpl: string,
  values: Record<string, unknown>,
  opts?: { escapeHtml?: boolean },
): string {
  if (tpl.indexOf('{{') === -1) return tpl
  const nodes = parseBlock(tokenize(tpl), { v: 0 }, () => false)
  return renderNodes(nodes, [{ data: values, item: values }], opts?.escapeHtml ?? false)
}

// --- Editable-builder markers → mustache (run at SAVE/compile) --------------
//
// The plain-HTML email builder can't author `{{#each}}` directly (the markers
// would show as literal text in the canvas and a table row can't carry text
// nodes between it). Instead the builder marks a repeating table row with
// `data-each="collection"` and a conditional element with `data-if="path"` —
// real, invisible HTML attributes that round-trip through GrapesJS. At compile
// we expand them into the `{{#each}}` / `{{#if}}` blocks the renderer handles.

/**
 * Expand `data-each` / `data-if` builder markers into mustache blocks:
 *   <tr data-each="hazards">…</tr>      → {{#each hazards}}<tr>…</tr>{{/each}}
 *   <tr data-if="signatures">…</tr>     → {{#if signatures}}<tr>…</tr>{{/if}}
 * Only `<tr>` is supported (the table-row case) — rows don't nest, so a
 * non-greedy match to the first `</tr>` is correct. The marker attribute is
 * stripped from the emitted row.
 */
export function expandRepeatMarkers(html: string): string {
  return html.replace(
    /<tr\b([^>]*)\bdata-(each|if)="([^"]+)"([^>]*)>([\s\S]*?)<\/tr>/gi,
    (_m, pre: string, kind: string, key: string, post: string, inner: string) => {
      const attrs = `${pre}${post}`.replace(/\s+/g, ' ').trim()
      const open = attrs ? `<tr ${attrs}>` : '<tr>'
      const block = kind === 'each' ? 'each' : 'if'
      return `{{#${block} ${key}}}${open}${inner}</tr>{{/${block}}}`
    },
  )
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

/** Optional call-to-action button appended to an inline email. */
export type EmailCta = { url: string; label: string }

export type RenderableEmail =
  // Inline body: plain text with {{tokens}}, rendered into the shared shell.
  | { mode: 'inline'; subject: string; bodyTemplate: string; cta?: EmailCta; brandName?: string }
  // A saved library template OR a one-off design: pre-sanitized, compiled HTML
  // with {{tokens}} / {{#each}} blocks still embedded.
  | { mode: 'template' | 'design'; subjectTemplate: string; compiledHtml: string }

export type RenderedEmail = { subject: string; html: string; text: string }

// Inline authoring is "Label: {{token}}" lines — when the token resolves empty
// the line reads "Label:" with nothing after it. Drop those lines entirely and
// collapse the gap they leave.
function dropEmptyLabelLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*[^:\n]{1,60}:\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The shared shell for inline flow emails: a clean card that renders the plain
 *  body with real line breaks (clients ignore `white-space` CSS) + optional CTA. */
function inlineShellHtml(body: string, cta: EmailCta | undefined, brandName: string): string {
  const bodyHtml = escapeHtml(body).replace(/\n/g, '<br/>')
  const font = "font-family:system-ui,'Segoe UI',Arial,sans-serif;"
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 2px;"><tr>
        <td style="background:#1b2b4a;border-radius:6px;">
          <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:10px 18px;${font}font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(cta.label)}</a>
        </td></tr></table>`
    : ''
  return `<div style="background:#f1f5f9;padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
      <tr><td style="padding:0 6px 10px;${font}font-size:13px;font-weight:700;letter-spacing:.4px;color:#475569;">${escapeHtml(brandName)}</td></tr>
      <tr><td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px 28px;${font}font-size:14px;line-height:1.65;color:#0f172a;">${bodyHtml}${button}</td></tr>
      <tr><td style="padding:10px 6px 0;${font}font-size:11px;color:#94a3b8;">This message was sent automatically by ${escapeHtml(brandName)}.</td></tr>
    </table>
  </td></tr></table>
</div>`
}

export function renderEmail(spec: RenderableEmail, values: Record<string, unknown>): RenderedEmail {
  if (spec.mode === 'inline') {
    const subject =
      interpolate(spec.subject, values).replace(/\s+/g, ' ').trim() || 'Notification'
    const body = dropEmptyLabelLines(interpolate(spec.bodyTemplate, values))
    const text = spec.cta ? `${body}\n\n${spec.cta.label}: ${spec.cta.url}` : body
    const html = inlineShellHtml(body, spec.cta, spec.brandName?.trim() || 'BeaconHS')
    return { subject, html, text }
  }
  // template | design — render {{tokens}} + {{#each}} blocks (escaped values)
  // into trusted, pre-sanitized HTML.
  const subject = renderTemplate(spec.subjectTemplate, values) || 'Notification'
  const html = renderTemplate(spec.compiledHtml, values, { escapeHtml: true })
  const text = htmlToPlainText(html)
  return { subject, html, text }
}
