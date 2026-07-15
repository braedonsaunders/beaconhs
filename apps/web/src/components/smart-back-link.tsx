'use client'
import { GeneratedValue } from '@/i18n/generated'

// The injected back-link implementation. Resolves a record page's back target,
// in priority order:
//   1. an explicit ?from=<path> override (survives fresh loads / shared links),
//   2. the in-app history trail (where you actually came from),
//   3. the page's hardcoded href/label fallback.
//
// (1) is deterministic on the server, so it renders identically on both sides.
// (2) comes from an external store whose server snapshot is empty, so the first
// client render matches SSR and then upgrades after hydration — no mismatch.

import { usePathname, useSearchParams } from 'next/navigation'
import { UiBackLinkProvider, UiLink, type BackLinkProps } from '@beaconhs/ui'
import { backLabel, sanitizeFrom } from '@/lib/back-nav'
import { NavHistoryTracker, useNavBack } from './nav-history'

export function SmartBackLink({ href, label, className }: BackLinkProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const navBack = useNavBack(pathname)

  let target = { href, label }

  const from = sanitizeFrom(searchParams.get('from'))
  if (from) {
    const fromLabel = searchParams.get('fromLabel')
    target = { href: from, label: fromLabel?.trim() ? fromLabel : backLabel(from) }
  } else if (navBack) {
    target = navBack
  }

  return (
    <UiLink href={target.href} className={className}>
      ← <GeneratedValue value={target.label} />
    </UiLink>
  )
}

/** Mount in the authenticated shell: tracks in-app history and upgrades every
 *  DetailHeader/PageHeader back link to the smart resolver. */
export function BackNavProviders({ children }: { children: React.ReactNode }) {
  return (
    <UiBackLinkProvider backLink={SmartBackLink}>
      <NavHistoryTracker />
      <GeneratedValue value={children} />
    </UiBackLinkProvider>
  )
}
