'use client'

// Hands next/link to @beaconhs/ui (UiLinkProvider) so ui-package anchors
// (e.g. PageHeader/DetailHeader back-links) navigate client-side instead of
// forcing a full document reload — which would replay the boot splash.

import Link from 'next/link'
import { UiLinkProvider } from '@beaconhs/ui'

export function AppLinkProvider({ children }: { children: React.ReactNode }) {
  return <UiLinkProvider link={Link}>{children}</UiLinkProvider>
}
