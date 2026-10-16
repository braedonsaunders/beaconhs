export const DIAGNOSTIC_ROUTE_FAMILIES = [
  'journals',
  'equipment',
  'inspections',
  'hazard-assessments',
  'training',
  'corrective-actions',
  'people',
  'documents',
  'ppe',
  'api',
  'login',
  'admin',
  'reports',
  'dashboard',
  'forms',
  'help',
  'other',
] as const
const families = new Set<string>(DIAGNOSTIC_ROUTE_FAMILIES)

export function routeFamily(path: string): string {
  const first = path.split('?')[0]?.split('/')[1] ?? ''
  return families.has(first) ? first : 'other'
}

export function browserCategory(userAgent: string) {
  if (/Edg\//.test(userAgent)) return 'edge'
  if (/Firefox\//.test(userAgent)) return 'firefox'
  if (/Chrome\/|CriOS\//.test(userAgent)) return 'chrome'
  if (/Safari\//.test(userAgent)) return 'safari'
  return 'other'
}

export function safeDigest(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : undefined
}

export const DIAGNOSTIC_ERROR_TYPES = [
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'DOMException',
  'AbortError',
  'Other',
] as const
const errorTypes = new Set<string>(DIAGNOSTIC_ERROR_TYPES)
export function safeErrorType(value: unknown): string {
  return typeof value === 'string' && errorTypes.has(value) ? value : 'Other'
}

export function safeStaticPositions(stack: unknown, message?: unknown): string[] {
  if (typeof stack !== 'string') return []
  let frames = stack.slice(0, 16_000)
  // V8 prefixes stack with the entire message, which may itself have newlines
  // and URL-looking user text. Remove that prefix before inspecting frames.
  const messageAt = typeof message === 'string' && message ? frames.indexOf(message) : -1
  if (messageAt >= 0 && messageAt < 100) frames = frames.slice(messageAt + String(message).length)
  const positions: string[] = []
  for (const line of frames.split('\n')) {
    if (!/^\s*at\s/.test(line) && !/^[^@\s]*@https?:\/\//.test(line)) continue
    const match = line.match(/(https?:\/\/[^\s)]+):(\d{1,7}):(\d{1,7})\)?\s*$/)
    if (!match) continue
    try {
      const path = new URL(match[1]!).pathname
      if (!/^\/_next\/static\/[a-zA-Z0-9_./-]+\.js$/.test(path) || path.includes('..')) continue
      const position = `${path}:${match[2]}:${match[3]}`
      if (position.length <= 240 && !positions.includes(position)) positions.push(position)
      if (positions.length === 5) break
    } catch {
      // Ignore source-map names, extension URLs and malformed locations.
    }
  }
  return positions
}

/** Logging must never turn an application failure into a second failure. */
export function emitDiagnostic(value: object, level: 'warn' | 'error' | 'info' = 'warn') {
  try {
    console[level](JSON.stringify(value))
    return true
  } catch {
    // Diagnostics are best-effort; no request depends on a writable log sink.
    return false
  }
}
