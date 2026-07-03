import { createHash } from 'node:crypto'

export type SourceRow = Record<string, unknown>

function scalar(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function getPath(row: unknown, path: string | undefined | null): unknown {
  if (!path) return undefined
  let cur = row
  for (const part of path
    .split('.')
    .map((p) => p.trim())
    .filter(Boolean)) {
    if (cur == null || typeof cur !== 'object') return undefined
    const key = part.match(/^\[(\d+)\]$/)?.[1] ?? part
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function titleCase(value: string): string {
  return value.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
}

function dateOnly(value: string): string {
  return datePart(value) ?? value.trim()
}

// --- Shared connector field helpers ----------------------------------------
// Every native connector (database, http-json, csv) plus netsuite/nango needs
// the same canonical-field coercions; they live here so there is exactly one
// implementation of each.

/** Normalize a source date string to YYYY-MM-DD; null when unparseable. */
export function datePart(v: string | null): string | null {
  if (!v) return null
  const s = v.trim()
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1] ?? null
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (mdy) return `${mdy[3]}-${(mdy[1] ?? '').padStart(2, '0')}-${(mdy[2] ?? '').padStart(2, '0')}`
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

/** Finite number or null. */
export function numPart(v: string | null): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Split "Last, First" or "First Last" into first/last. */
export function splitName(full: string | null): { first: string; last: string } {
  const s = String(full ?? '').trim()
  if (!s) return { first: '', last: '' }
  if (s.includes(',')) {
    const [last, first] = s.split(',', 2)
    return { first: (first ?? '').trim(), last: (last ?? '').trim() }
  }
  const parts = s.split(/\s+/)
  return {
    first: parts.slice(0, -1).join(' ') || (parts[0] ?? ''),
    last: parts.length > 1 ? (parts[parts.length - 1] ?? '') : '',
  }
}

/** Canonical org-unit level or undefined when the source value is unmapped. */
export function orgLevel(v: string | null): 'customer' | 'project' | 'site' | 'area' | undefined {
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
  if (['customer', 'project', 'site', 'area'].includes(s)) {
    return s as 'customer' | 'project' | 'site' | 'area'
  }
  return undefined
}

/** Short stable content hash of a source row — external-id fallback. */
export function hashRow(o: unknown): string {
  return createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 16)
}

function boolText(value: string): string {
  const s = value.trim().toLowerCase()
  if (['1', 'true', 't', 'yes', 'y', 'active', 'on'].includes(s)) return 'true'
  if (['0', 'false', 'f', 'no', 'n', 'inactive', 'off'].includes(s)) return 'false'
  return value
}

function applyTransform(value: string, op: string): string {
  const [nameRaw, ...args] = op.split(':')
  const name = (nameRaw ?? '').trim().toLowerCase()
  switch (name) {
    case '':
      return value
    case 'trim':
      return value.trim()
    case 'upper':
      return value.toUpperCase()
    case 'lower':
      return value.toLowerCase()
    case 'title':
      return titleCase(value)
    case 'date':
    case 'dateonly':
      return dateOnly(value)
    case 'number': {
      const n = Number(value.replace(/,/g, ''))
      return Number.isFinite(n) ? String(n) : value
    }
    case 'bool':
    case 'boolean':
      return boolText(value)
    case 'prefix':
      return `${args.join(':')}${value}`
    case 'suffix':
      return `${value}${args.join(':')}`
    case 'default':
      return value.trim() ? value : args.join(':')
    case 'replace': {
      const [from = '', to = ''] = args
      return from ? value.split(from).join(to) : value
    }
    default:
      return value
  }
}

export function renderTemplate(template: string, row: SourceRow): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
    const [pathRaw, ...ops] = expr.split('|')
    let value = scalar(getPath(row, pathRaw?.trim()))
    for (const op of ops) value = applyTransform(value, op.trim())
    return value
  })
}

export function fieldFromPath(row: SourceRow, path: string | undefined | null): string | null {
  if (!path) return null
  const value = getPath(row, path)
  if (value == null) return null
  const s = scalar(value)
  return s === '' ? null : s
}
