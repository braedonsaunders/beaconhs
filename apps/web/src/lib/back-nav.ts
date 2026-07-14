// Shared helpers for smart back-navigation. Pure + isomorphic (no server-only
// or browser-only imports) so both the client SmartBackLink and any server-side
// caller can use them.
//
// The model: a record page carries a hardcoded `back` fallback, but is reachable
// from many places. The real return target is resolved at render time from —
// in priority order — an explicit `?from` param, the in-app history stack, then
// the fallback.

const SITE_TITLE_SUFFIX = ' · BeaconHS'

/**
 * Clean a document.title into a short back-link noun. Strips the site suffix
 * ("Foo · BeaconHS" → "Foo") and drops any trailing " · <id>" disambiguator so
 * "Person · a1b2c3d4" reads as "Person". Returns null when nothing usable
 * remains.
 */
export function cleanTitle(title: string | null | undefined): string | null {
  if (!title) return null
  let t = title.trim()
  if (t.endsWith(SITE_TITLE_SUFFIX)) t = t.slice(0, -SITE_TITLE_SUFFIX.length).trim()
  // Middle-dot separates a page name from an id (e.g. "Person · a1b2c3d4"); the
  // leading segment is the human-meaningful part.
  const dot = t.indexOf(' · ')
  if (dot > 0) t = t.slice(0, dot).trim()
  return t.length > 0 ? t : null
}

/**
 * Accept an in-app return path only. Rejects anything that could be an
 * open-redirect (absolute URLs, protocol-relative `//`, non-path values), so a
 * hostile `?from=` can never bounce a user off-site.
 */
export function sanitizeFrom(from: string | null | undefined): string | null {
  if (!from) return null
  const v = from.trim()
  if (!v.startsWith('/')) return null
  if (v.startsWith('//') || v.startsWith('/\\')) return null
  // Reject control chars / whitespace (a real path is URL-encoded); guards
  // against header/redirect smuggling via a crafted `?from`.
  if (/[\u0000-\u0020]/.test(v)) return null
  return v
}

// Module roots → the noun used in "Back to <noun>". Longest-prefix wins, so more
// specific sub-areas can override their parent. Used to label a `?from` target
// (which carries no captured title) and as a last resort for history entries.
const PATH_LABELS: ReadonlyArray<[prefix: string, label: string]> = [
  ['/people/groups', 'groups'],
  ['/people/titles', 'titles'],
  ['/people/departments', 'departments'],
  ['/people', 'people'],
  ['/training/courses', 'courses'],
  ['/training/records', 'training records'],
  ['/training/assessments', 'assessments'],
  ['/training', 'training'],
  ['/equipment/inspections', 'equipment inspections'],
  ['/equipment/maintenance', 'maintenance'],
  ['/equipment/station', 'the station'],
  ['/equipment', 'equipment'],
  ['/incidents', 'incidents'],
  ['/corrective-actions', 'corrective actions'],
  ['/hazard-assessments', 'hazard assessments'],
  ['/inspections', 'inspections'],
  ['/ppe', 'PPE'],
  ['/documents', 'documents'],
  ['/reports', 'reports'],
  ['/insights', 'insights'],
  ['/compliance', 'compliance'],
  ['/journals', 'journals'],
  ['/apps', 'apps'],
  ['/tools', 'tools'],
  ['/assistant', 'the assistant'],
  ['/notifications', 'notifications'],
  ['/admin', 'admin'],
  ['/platform', 'platform'],
  ['/my', 'my workspace'],
  ['/feed', 'the feed'],
]

/** Human noun for a path, e.g. "/people/x?tab=y" → "people". Null if unknown. */
function labelForPath(path: string): string | null {
  const pathname = path.split('?')[0] ?? path
  for (const [prefix, label] of PATH_LABELS) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return label
  }
  return null
}

/** Full back-link label ("Back to people"), given an optional captured title. */
export function backLabel(path: string, title?: string | null): string {
  const noun = cleanTitle(title) ?? labelForPath(path)
  return noun ? `Back to ${noun}` : 'Back'
}
