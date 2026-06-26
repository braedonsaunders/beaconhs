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
  const trimmed = value.trim()
  const iso = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1] ?? ''
  const t = Date.parse(trimmed)
  return Number.isNaN(t) ? trimmed : new Date(t).toISOString().slice(0, 10)
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
