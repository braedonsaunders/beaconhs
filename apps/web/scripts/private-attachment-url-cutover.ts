export type PersistedJson =
  | null
  | boolean
  | number
  | string
  | PersistedJson[]
  | { [key: string]: PersistedJson }

export type AttachmentReference =
  | {
      kind: 'route'
      raw: string
      attachmentId: string
      capability: string | null
      path: string
    }
  | {
      kind: 'public-object'
      raw: string
      tenantId: string
      key: string
      path: string
    }

type InvalidAttachmentReference = {
  raw: string
  path: string
  reason: string
}

type PersistedValueInspection = {
  references: AttachmentReference[]
  invalid: InvalidAttachmentReference[]
}

const ROUTE_MARKER = '/api/attachments'
const ROUTE_RE =
  /^\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\?cap=([A-Za-z0-9_-]{43}))?$/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type LocatedReference = AttachmentReference & { start: number; end: number }
type LocatedInvalid = InvalidAttachmentReference & { start: number; end: number }

function isForwardDelimiter(value: string): boolean {
  return /[\s"'<>()[\]{}\\`]/u.test(value)
}

function isBackwardDelimiter(value: string): boolean {
  return isForwardDelimiter(value) || /[=,;!]/u.test(value)
}

function tokenEnd(value: string, start: number): number {
  let end = start
  while (end < value.length && !isForwardDelimiter(value[end]!)) end++
  return end
}

function tokenStart(value: string, end: number): number {
  let start = end
  while (start > 0 && !isBackwardDelimiter(value[start - 1]!)) start--
  return start
}

function invalid(
  raw: string,
  path: string,
  reason: string,
  start: number,
  end: number,
): LocatedInvalid {
  return { raw, path, reason, start, end }
}

function routeAt(value: string, marker: number, path: string): LocatedReference | LocatedInvalid {
  const possibleStart = tokenStart(value, marker)
  const prefix = value.slice(possibleStart, marker)
  const end = tokenEnd(value, marker)
  if (prefix !== '' && !/^https?:\/\//i.test(prefix)) {
    return invalid(
      value.slice(possibleStart, end),
      path,
      'attachment route is mounted below an unexpected relative base path',
      possibleStart,
      end,
    )
  }
  const start = possibleStart
  const raw = value.slice(start, end)

  let route = raw
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.hash !== ''
      ) {
        return invalid(
          raw,
          path,
          'absolute attachment route is not a plain HTTP(S) URL',
          start,
          end,
        )
      }
      route = `${parsed.pathname}${parsed.search}`
    } catch {
      return invalid(raw, path, 'absolute attachment route is not a valid URL', start, end)
    }
  }

  const match = ROUTE_RE.exec(route)
  if (!match) {
    return invalid(
      raw,
      path,
      'attachment route must contain one exact UUID and, optionally, one 43-character cap query',
      start,
      end,
    )
  }
  return {
    kind: 'route',
    raw,
    attachmentId: match[1]!.toLowerCase(),
    capability: match[2] ?? null,
    path,
    start,
    end,
  }
}

function decodedPathSegments(raw: string): string[] | null {
  try {
    const schemeEnd = raw.indexOf('://')
    const pathStart = raw.indexOf('/', schemeEnd + 3)
    const rawPath = pathStart < 0 ? '' : raw.slice(pathStart).split(/[?#]/u, 1)[0]!
    const segments = rawPath.split('/')
    if (segments[0] === '') segments.shift()
    return segments.map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
}

function publicObjectAt(
  value: string,
  start: number,
  rowTenantId: string,
  path: string,
): LocatedReference | LocatedInvalid | null {
  const end = tokenEnd(value, start)
  const raw = value.slice(start, end)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  const segments = decodedPathSegments(raw)
  if (!segments) {
    return /\/t\/[0-9a-f-]{30,40}\//i.test(raw)
      ? invalid(raw, path, 'public object URL contains malformed path encoding', start, end)
      : null
  }
  const tenantMarkers = segments
    .map((segment, index) => ({ segment, index }))
    .filter(
      ({ segment, index }) =>
        segment === 't' && /^[0-9a-f-]{30,40}$/i.test(segments[index + 1] ?? ''),
    )
  if (tenantMarkers.length === 0) return null
  if (tenantMarkers.length !== 1) {
    return invalid(raw, path, 'public object URL has an ambiguous tenant path', start, end)
  }
  const marker = tenantMarkers[0]!.index
  const tenantId = segments[marker + 1] ?? ''
  if (!UUID_RE.test(tenantId)) {
    return invalid(raw, path, 'public object URL tenant is not an exact UUID', start, end)
  }
  if (tenantId.toLowerCase() !== rowTenantId.toLowerCase()) {
    return invalid(raw, path, 'public object URL is not scoped to the row tenant', start, end)
  }
  const keySegments = segments.slice(marker)
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    keySegments.length < 3 ||
    keySegments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        segment.includes('/') ||
        segment.includes('\\'),
    )
  ) {
    return invalid(
      raw,
      path,
      'public object URL is not a plain, safe tenant object URL',
      start,
      end,
    )
  }
  return {
    kind: 'public-object',
    raw,
    tenantId: tenantId.toLowerCase(),
    key: keySegments.join('/'),
    path,
    start,
    end,
  }
}

function scanString(
  value: string,
  tenantId: string,
  path: string,
): { references: LocatedReference[]; invalid: LocatedInvalid[] } {
  const references: LocatedReference[] = []
  const invalidReferences: LocatedInvalid[] = []

  let routeOffset = 0
  while (routeOffset < value.length) {
    const marker = value.indexOf(ROUTE_MARKER, routeOffset)
    if (marker < 0) break
    const result = routeAt(value, marker, path)
    if ('reason' in result) invalidReferences.push(result)
    else references.push(result)
    routeOffset = Math.max(marker + ROUTE_MARKER.length, result.end)
  }

  const lower = value.toLowerCase()
  let urlOffset = 0
  while (urlOffset < value.length) {
    const http = lower.indexOf('http://', urlOffset)
    const https = lower.indexOf('https://', urlOffset)
    const start = http < 0 ? https : https < 0 ? http : Math.min(http, https)
    if (start < 0) break
    const result = publicObjectAt(value, start, tenantId, path)
    if (result) {
      if ('reason' in result) invalidReferences.push(result)
      else references.push(result)
      urlOffset = Math.max(start + 1, result.end)
    } else {
      urlOffset = tokenEnd(value, start)
    }
  }

  references.sort((left, right) => left.start - right.start)
  invalidReferences.sort((left, right) => left.start - right.start)
  return { references, invalid: invalidReferences }
}

function inspect(
  value: PersistedJson,
  tenantId: string,
  path: string,
  result: PersistedValueInspection,
): void {
  if (typeof value === 'string') {
    const scanned = scanString(value, tenantId, path)
    result.references.push(
      ...scanned.references.map(({ start: _start, end: _end, ...reference }) => reference),
    )
    result.invalid.push(
      ...scanned.invalid.map(({ start: _start, end: _end, ...reference }) => reference),
    )
    return
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return
  if (Array.isArray(value)) {
    value.forEach((nested, index) => inspect(nested, tenantId, `${path}[${index}]`, result))
    return
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`Persisted JSON at ${path} contains a non-plain object`)
  }
  for (const [key, nested] of Object.entries(value)) {
    inspect(nested, tenantId, `${path}.${key}`, result)
  }
}

/** Exhaustively inspect strings at every depth of a persisted JSON value. */
export function inspectPersistedValue(
  value: PersistedJson,
  tenantId: string,
  path = '$',
): PersistedValueInspection {
  if (!UUID_RE.test(tenantId)) throw new Error(`Row tenant is not an exact UUID at ${path}`)
  const result: PersistedValueInspection = { references: [], invalid: [] }
  inspect(value, tenantId, path, result)
  return result
}

function rewriteString(
  value: string,
  tenantId: string,
  path: string,
  replacement: (reference: AttachmentReference) => string,
): string {
  const scanned = scanString(value, tenantId, path)
  if (scanned.invalid.length > 0) {
    throw new Error(`Cannot rewrite invalid attachment reference at ${scanned.invalid[0]!.path}`)
  }
  const located = scanned.references.sort((left, right) => left.start - right.start)
  let cursor = 0
  let output = ''
  for (const reference of located) {
    if (reference.start < cursor) {
      throw new Error(`Overlapping attachment references at ${path}`)
    }
    output += value.slice(cursor, reference.start)
    output += replacement(reference)
    cursor = reference.end
  }
  return output + value.slice(cursor)
}

/** Rewrite every discovered reference while preserving the rest of the JSON exactly. */
export function rewritePersistedValue(
  value: PersistedJson,
  tenantId: string,
  replacement: (reference: AttachmentReference) => string,
  path = '$',
): PersistedJson {
  if (typeof value === 'string') return rewriteString(value, tenantId, path, replacement)
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (Array.isArray(value)) {
    return value.map((nested, index) =>
      rewritePersistedValue(nested, tenantId, replacement, `${path}[${index}]`),
    )
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`Persisted JSON at ${path} contains a non-plain object`)
  }
  const output: Record<string, PersistedJson> = {}
  for (const [key, nested] of Object.entries(value)) {
    output[key] = rewritePersistedValue(nested, tenantId, replacement, `${path}.${key}`)
  }
  return output
}
