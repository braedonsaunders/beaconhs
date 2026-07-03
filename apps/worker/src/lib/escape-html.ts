// Single HTML-escaping helper for every place the worker assembles email or
// PDF HTML from stored/user-controlled strings (notification titles, flow
// bodies, report names, …). Null-tolerant so callers can pass optional fields.
export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
