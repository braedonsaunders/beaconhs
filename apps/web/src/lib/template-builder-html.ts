export type TemplateMergeField = { key: string; label?: string }
export type TemplateCollection = {
  key: string
  label: string
  fields: { key: string; label: string }[]
}

type TemplateEditorSnapshot = {
  getHtml: () => string
  getCss?: () => string | undefined
}

const TEMPLATE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

export function safeTemplateKey(value: string): string | null {
  const key = value.trim()
  return TEMPLATE_KEY.test(key) ? key : null
}

/**
 * GrapesJS stores authored rules separately from its component HTML. Persist the
 * two together so reopening or compiling a design cannot silently lose styles.
 */
export function serializeTemplateEditor(editor: TemplateEditorSnapshot): string {
  const css = editor.getCss?.() ?? ''
  const html = editor.getHtml()
  return css ? `<style>${css}</style>${html}` : html
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function mergeFieldBlockHtml(field: TemplateMergeField): string | null {
  const key = safeTemplateKey(field.key)
  return key ? `<span style="color:#0f172a;">{{${key}}}</span>` : null
}

const TABLE_HEADER_STYLE =
  'text-align:left;border-bottom:2px solid #e2e8f0;padding:6px 8px;font-size:11px;color:#475569;font-weight:700;text-transform:uppercase'
const TABLE_CELL_STYLE =
  'border-bottom:1px solid #eef2f7;padding:6px 8px;font-size:13px;color:#0f172a;vertical-align:top'

/** Build one editable repeating-row table without allowing schema labels or keys into markup. */
export function collectionTableBlockHtml(collection: TemplateCollection): string | null {
  const collectionKey = safeTemplateKey(collection.key)
  if (!collectionKey || collection.fields.length === 0) return null

  const fields = collection.fields.map((field) => ({
    key: safeTemplateKey(field.key),
    label: escapeHtml(field.label),
  }))
  if (fields.some((field) => field.key === null)) return null

  const head = fields
    .map((field) => `<th style="${TABLE_HEADER_STYLE}">${field.label}</th>`)
    .join('')
  const body = fields
    .map((field) => `<td style="${TABLE_CELL_STYLE}">{{${field.key!}}}</td>`)
    .join('')
  // Matches the seeded document tables: an even <colgroup> the column resizer
  // writes to, `table-layout:fixed` so a table that breaks across a page keeps
  // the same shape on both halves, and the headings in <thead> so they repeat.
  const width = Math.round((100 / fields.length) * 10) / 10
  const colgroup = `<colgroup>${fields
    .map(() => `<col style="width:${width}%" />`)
    .join('')}</colgroup>`
  return (
    '<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 8px;">' +
    colgroup +
    `<thead><tr>${head}</tr></thead>` +
    `<tr data-each="${collectionKey}">${body}</tr></table>`
  )
}
