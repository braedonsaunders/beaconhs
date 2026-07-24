import { GeneratedValue } from '@/i18n/generated'
import './globals.css'
import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTimeZone } from 'next-intl/server'
import { AppLinkProvider } from '@/components/app-link-provider'
import { SplashScreen } from '@/components/brand-splash'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { PRODUCT_NAME } from '@/lib/brand'

export async function generateMetadata(): Promise<Metadata> {
  const tGenerated = await getGeneratedTranslations()
  return {
    title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
    description: tGenerated('m_1502d68cae153f'),
    // The manifest <link> is rendered manually in <head> below so it can carry
    // crossorigin="use-credentials" — without it the browser fetches the manifest
    // without the session cookie and the per-tenant branding can't be resolved.
    applicationName: PRODUCT_NAME,
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: PRODUCT_NAME,
    },
  }
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
// the persisted preference ('light' | 'dark' | 'system') and sets an explicit
// `.light`/`.dark` class on <html> ('system', the default, follows the OS). We
// stamp `.light` too — never leaving <html> class-less — because vendored design
// tokens (AppKit) fall back to `prefers-color-scheme` when neither class is
// present, which would force those surfaces dark on a dark-OS machine even while
// the app is in light mode.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme')||'system';var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t==='dark'||(t==='system'&&m);var e=document.documentElement;e.classList.toggle('dark',d);e.classList.toggle('light',!d);}catch(e){}})();`

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
          <AppLinkProvider>
            <GeneratedValue value={children} />
          </AppLinkProvider>
        </NextIntlClientProvider>
        <SplashScreen />
      </body>
    </html>
  )
}
