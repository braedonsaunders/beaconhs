import { beginPendingDrawer, type DrawerSize } from '@beaconhs/ui'

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

/**
 * Call just before navigating to `href` from code (a button, not a link): when
 * it opens a drawer on this page, the loading panel slides out at once — the
 * same instant feedback a drawer link gets.
 */
export function announceDrawerNavigation(href: string, size: DrawerSize = 'md'): void {
  if (typeof window === 'undefined') return
  // A drawer already open hands over to the next one through the server.
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
  const drawer = drawerLinkTarget(href, window.location.href)
  if (drawer) beginPendingDrawer(size, `${window.location.pathname}?drawer=${drawer}`)
}
