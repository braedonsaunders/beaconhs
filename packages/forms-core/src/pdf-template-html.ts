// Generate a Builder app's default PDF DOCUMENT template (pdf_templates
// sourceHtml) from its published form schema. The output is plain
// inline-styled HTML using the builder's <tr data-each="…"> / <tr data-if="…">
// repeat markers, so the generated document opens fully editable in
// /admin/pdf-templates and compiles through the same expandRepeatMarkers →
// sanitize pipeline as hand-built templates.
//
// Every token references the form flow adapter's loadValues() map ONLY:
// raw {{fieldId}} values plus the companion keys declared in
// form-companions.ts (`_text`, `_image`, `_photos`, repeating-section and
// table-field collections). Layout-only fields are skipped.
//
// Consumed by the web publish hook / admin "Generate" affordance AND the db
// seed backfill — keep it dependency-free (pure string building).

import type { FormSchemaV1 } from './schema'
import {
  SKIP_FIELD_TYPES,
  hasImageCompanion,
  hasPhotosCompanion,
  hasTextCompanion,
  isAttachmentArrayField,
  labelText,
} from './form-companions'

// --- shared design language (mirrors the seeded native-module documents) ----

const FONT = "font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;"
const H1 = 'font-size:21px;font-weight:800;color:#0f172a;margin:0;letter-spacing:.2px;'
const SUB = 'font-size:12px;color:#64748b;margin:3px 0 0;'
const H2 =
  'font-size:13px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.6px;margin:0;border-bottom:2px solid #0f172a;padding-bottom:3px;'
const TH =
  'text-align:left;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:.3px;'
const TD =
  'border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;'
const LBL =
  'width:18%;border:1px solid #e2e8f0;background:#f1f5f9;padding:5px 8px;font-size:10.5px;font-weight:600;color:#475569;vertical-align:top;'
const VAL =
  'width:32%;border:1px solid #e2e8f0;padding:5px 8px;font-size:11.5px;color:#0f172a;vertical-align:top;'
const TABLE = 'width:100%;border-collapse:collapse;margin:0 0 10px;'
const ROW = 'page-break-inside:avoid;'
const HEAD_CELL = 'border:none;padding:14px 0 6px;'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function headingRow(title: string, colspan: number, gate?: string): string {
  const marker = gate ? ` data-if="${gate}"` : ''
  return `<tr${marker}><td colspan="${colspan}" style="${HEAD_CELL}"><div style="${H2}">${esc(title)}</div></td></tr>`
}

// Long-form values read better on a full-width row than in a 2-up grid.
const LONG_VALUE_TYPES = new Set([
  'textarea',
  'rich_text',
  'matrix',
  'ranking',
  'address',
  'photo_ai',
  'photo_annotated',
])

type KvRow =
  | { kind: 'pair'; label: string; value: string } // short — packed 2-up
  | { kind: 'row'; html: string } // pre-built full-width <tr>

function fullRow(label: string, valueHtml: string, gate?: string): KvRow {
  const marker = gate ? ` data-if="${gate}"` : ''
  return {
    kind: 'row',
    html: `<tr${marker} style="${ROW}"><td style="${LBL}">${esc(label)}</td><td colspan="3" style="${VAL}">${valueHtml}</td></tr>`,
  }
}

/** Pack pair-rows two per <tr>; full rows flush the pending pair first. */
function renderKvTable(rows: KvRow[]): string {
  const out: string[] = []
  let pending: { label: string; value: string } | null = null
  const flush = () => {
    if (!pending) return
    out.push(
      `<tr style="${ROW}"><td style="${LBL}">${esc(pending.label)}</td><td colspan="3" style="${VAL}">${pending.value}</td></tr>`,
    )
    pending = null
  }
  for (const r of rows) {
    if (r.kind === 'row') {
      flush()
      out.push(r.html)
      continue
    }
    if (pending) {
      out.push(
        `<tr style="${ROW}"><td style="${LBL}">${esc(pending.label)}</td><td style="${VAL}">${pending.value}</td>` +
          `<td style="${LBL}">${esc(r.label)}</td><td style="${VAL}">${r.value}</td></tr>`,
      )
      pending = null
    } else {
      pending = { label: r.label, value: r.value }
    }
  }
  flush()
  return out.length === 0 ? '' : `<table style="${TABLE}">${out.join('')}</table>`
}

/** A collection table: gated heading + header row, one data-each body row. */
function collectionTable(
  title: string,
  eachKey: string,
  columns: { header: string; cell: string }[],
): string {
  const ths = columns.map((c) => `<th style="${TH}">${esc(c.header)}</th>`).join('')
  const tds = columns.map((c) => `<td style="${TD}">${c.cell}</td>`).join('')
  return (
    `<table style="${TABLE}">` +
    headingRow(title, columns.length, eachKey) +
    `<tr data-if="${eachKey}">${ths}</tr>` +
    `<tr data-each="${eachKey}" style="${ROW}">${tds}</tr>` +
    `</table>`
  )
}

/** A gated photo list: heading + one image-per-row with its filename. */
function photoBlock(title: string, eachKey: string): string {
  return (
    `<table style="${TABLE}">` +
    headingRow(title, 1, eachKey) +
    `<tr data-each="${eachKey}" style="${ROW}"><td style="border:none;padding:4px 0 8px;">` +
    `<img src="{{url}}" width="320" style="border:1px solid #e2e8f0;border-radius:4px;display:block;" alt="" />` +
    `<div style="font-size:10px;color:#64748b;padding-top:3px;">{{filename}}</div>` +
    `</td></tr></table>`
  )
}

export type GeneratedFormPdfTemplate = {
  sourceHtml: string
  headerHtml: string
  footerHtml: string
}

/**
 * Build the full generated document for a form template. Sections become
 * headed blocks of label/value rows; repeating sections and table fields
 * become collection tables; photo/file fields become photo grids; signature
 * and sketch fields embed their images. Uses only keys the form flow adapter's
 * loadValues() provides.
 */
export function generateFormPdfTemplate(
  schema: FormSchemaV1,
  formName: string,
): GeneratedFormPdfTemplate {
  const blocks: string[] = []

  // Letterhead: app name + a compliance line when the response carries one.
  blocks.push(
    `<div style="border-bottom:3px solid #0f172a;padding-bottom:8px;margin-bottom:12px;">` +
      `<h1 style="${H1}">${esc(formName)}</h1>` +
      `<p style="${SUB}">Record report</p>` +
      `</div>`,
  )
  blocks.push(
    `<table style="${TABLE}">` +
      `<tr data-if="compliance_status" style="${ROW}"><td style="${LBL}">Compliance status</td><td colspan="3" style="${VAL}">{{compliance_status}}</td></tr>` +
      `<tr data-if="compliance_score" style="${ROW}"><td style="${LBL}">Compliance score</td><td colspan="3" style="${VAL}">{{compliance_score}}</td></tr>` +
      `</table>`,
  )

  for (const sec of schema.sections ?? []) {
    const fields = (sec.fields ?? []).filter((f) => !SKIP_FIELD_TYPES.has(f.type))
    if (fields.length === 0) continue
    const secTitle = labelText(sec.title, 'Details')

    // Repeating section → one collection table keyed by the section id.
    if (sec.repeating) {
      blocks.push(
        collectionTable(secTitle, sec.id, [
          { header: '#', cell: '{{@number}}' },
          ...fields.map((f) => ({
            header: labelText(f.label, f.id),
            cell: `{{${f.id}}}`,
          })),
        ]),
      )
      continue
    }

    const kv: KvRow[] = []
    const trailing: string[] = []
    for (const f of fields) {
      const label = labelText(f.label, f.id)

      if (f.type === 'signature') {
        kv.push(
          fullRow(
            label,
            `<img src="{{${f.id}}}" style="max-height:56px;display:block;" alt="" />`,
            f.id,
          ),
        )
        continue
      }
      if (hasImageCompanion(f.type)) {
        kv.push(
          fullRow(
            label,
            `<img src="{{${f.id}_image}}" style="max-width:100%;max-height:220px;display:block;border:1px solid #e2e8f0;border-radius:4px;" alt="" />`,
            `${f.id}_image`,
          ),
        )
        continue
      }
      if (isAttachmentArrayField(f.type)) {
        if (f.type === 'photo' || f.type === 'photo_upload') {
          trailing.push(photoBlock(label, f.id))
        } else {
          // file / video / audio — list the filenames.
          kv.push({
            kind: 'row',
            html: `<tr data-each="${f.id}" style="${ROW}"><td style="${LBL}">${esc(label)}</td><td colspan="3" style="${VAL}">{{filename}}</td></tr>`,
          })
        }
        continue
      }
      if (hasPhotosCompanion(f.type)) {
        // photo_ai / photo_annotated: readable summary + the photos.
        kv.push(fullRow(label, `{{${f.id}_text}}`, f.id))
        trailing.push(photoBlock(`${label} — photos`, `${f.id}_photos`))
        continue
      }
      if (f.type === 'table') {
        const cfg = (f.config ?? {}) as { columns?: { key: string; label?: string }[] }
        const columns = cfg.columns ?? []
        if (columns.length > 0) {
          trailing.push(
            collectionTable(
              label,
              f.id,
              columns.map((c) => ({ header: c.label || c.key, cell: `{{${c.key}}}` })),
            ),
          )
        }
        continue
      }
      if (f.type === 'rich_text') {
        // Rich text stores HTML — merge it unescaped so formatting survives.
        kv.push(fullRow(label, `{{{${f.id}}}}`))
        continue
      }

      const token = hasTextCompanion(f.type) ? `{{${f.id}_text}}` : `{{${f.id}}}`
      if (LONG_VALUE_TYPES.has(f.type)) kv.push(fullRow(label, token))
      else kv.push({ kind: 'pair', label, value: token })
    }

    const kvHtml = renderKvTable(kv)
    if (kvHtml || trailing.length > 0) {
      blocks.push(
        `<table style="width:100%;border-collapse:collapse;">${headingRow(secTitle, 1)}</table>`,
      )
      if (kvHtml) blocks.push(kvHtml)
      blocks.push(...trailing)
    }
  }

  return {
    sourceHtml: `<div style="${FONT}color:#0f172a;">${blocks.join('')}</div>`,
    headerHtml: esc(formName),
    footerHtml: 'Page {{page}} of {{pages}}',
  }
}
