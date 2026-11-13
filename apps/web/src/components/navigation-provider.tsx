'use client'
import { GeneratedValue } from '@/i18n/generated'

// Supplies a client-side navigate fn (Next's router.push) to @beaconhs/ui's
// UrlDrawer via DrawerNavigateContext. Without this, UrlDrawer falls back to a
// hard navigation. Mounted once around the authenticated app shell so every
// URL-driven drawer can close by changing the URL (re-running the server
// component that owns its open state).
//
// It also makes URL drawers open instantly: clicking a link that adds
// `?drawer=…` on the current page slides a loading panel out at once, and the
// real drawer takes it over when the server's content arrives — the page
// underneath never blanks or waits on a dead click.

import { Suspense, useCallback, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  DrawerNavigateContext,
  PendingDrawerProvider,
  settlePendingDrawer,
  type DrawerSize,
} from '@beaconhs/ui'
import { announceDrawerNavigation } from '@/lib/drawer-link'

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const navigate = useCallback(
    (href: string) => router.push(href as never, { scroll: false }),
    [router],
  )

  useEffect(() => {
    // Capture phase: runs before Next's <Link> handler prevents the default.
    function onClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return
      if ((anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return
      announceDrawerNavigation(
        anchor.href,
        (anchor.dataset.drawerSize as DrawerSize | undefined) ?? 'md',
      )
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return (
    <DrawerNavigateContext.Provider value={navigate}>
      <PendingDrawerProvider>
        <GeneratedValue value={children} />
        <Suspense fallback={null}>
          <SettlePendingDrawerOnNavigation />
        </Suspense>
      </PendingDrawerProvider>
    </DrawerNavigateContext.Provider>
  )
}

/** Each landed navigation lets the provider drop a panel no drawer took over. */
function SettlePendingDrawerOnNavigation() {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  useEffect(() => {
    settlePendingDrawer()
  }, [pathname, search])
  return null
}
