/**
 * Whether following `href` from `current` opens a URL drawer on the same page:
 * same origin and path, with a `drawer` search param that is set and differs
 * from the current one. Returns that drawer name, or null.
 */
export function drawerLinkTarget(href: string, current: string): string | null {
  let next: URL
  let here: URL
  try {
    next = new URL(href, current)
    here = new URL(current)
  } catch {
    return null
  }
  if (next.origin !== here.origin || next.pathname !== here.pathname) return null
  const drawer = next.searchParams.get('drawer')
  if (!drawer || drawer === here.searchParams.get('drawer')) return null
  return drawer
}
