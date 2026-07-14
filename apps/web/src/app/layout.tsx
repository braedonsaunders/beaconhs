import './globals.css'
import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { AppLinkProvider } from '@/components/app-link-provider'
import { SplashScreen } from '@/components/brand-splash'

export const metadata: Metadata = {
  title: { default: 'BeaconHS', template: '%s · BeaconHS' },
  description: 'Health & Safety platform',
  // The manifest <link> is rendered manually in <head> below so it can carry
  // crossorigin="use-credentials" — without it the browser fetches the manifest
  // without the session cookie and the per-tenant branding can't be resolved.
  applicationName: 'BeaconHS',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'BeaconHS' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Extend under notches/home indicator; safe-area env() padding in the app
  // shell and bottom tab bar keeps content clear of them.
  viewportFit: 'cover',
  themeColor: '#1B2B4A',
}

// Per-request CSP nonces require dynamic rendering. The authenticated shell was
// already dynamic; applying this at the root keeps public/login/verification
// pages under the same strict script policy.
export const dynamic = 'force-dynamic'

// Applied before first paint so a dark-mode user never sees a white flash. Reads
// the persisted preference ('light' | 'dark' | 'system') and toggles `.dark` on
// <html>; 'system' (the default) follows the OS setting.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme')||'system';var m=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',t==='dark'||(t==='system'&&m));}catch(e){}})();`

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT }}
        />
      </head>
      <body className="h-full overflow-hidden bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <AppLinkProvider>{children}</AppLinkProvider>
        <SplashScreen />
      </body>
    </html>
  )
}
