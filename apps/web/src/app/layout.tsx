import './globals.css'
import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTimeZone } from 'next-intl/server'
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
  const [headerStore, locale, messages, timeZone] = await Promise.all([
    headers(),
    getLocale(),
    getMessages(),
    getTimeZone(),
  ])
  const nonce = headerStore.get('x-nonce') ?? undefined
  return (
    <html lang={locale} className="h-full" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT }}
        />
      </head>
      <body className="h-full overflow-hidden bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
          <AppLinkProvider>{children}</AppLinkProvider>
        </NextIntlClientProvider>
        <SplashScreen />
      </body>
    </html>
  )
}
