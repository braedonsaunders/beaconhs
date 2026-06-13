import './globals.css'
import type { Metadata, Viewport } from 'next'
import { AppLinkProvider } from '@/components/app-link-provider'
import { SplashScreen } from '@/components/brand-splash'

export const metadata: Metadata = {
  title: { default: 'BeaconHS', template: '%s · BeaconHS' },
  description: 'Health & Safety platform',
  manifest: '/manifest.webmanifest',
  applicationName: 'BeaconHS',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'BeaconHS' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1B2B4A',
}

// Applied before first paint so a dark-mode user never sees a white flash. Reads
// the persisted preference ('light' | 'dark' | 'system') and toggles `.dark` on
// <html>; 'system' (the default) follows the OS setting.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('theme')||'system';var m=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',t==='dark'||(t==='system'&&m));}catch(e){}})();`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="h-full overflow-hidden bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <AppLinkProvider>{children}</AppLinkProvider>
        <SplashScreen />
      </body>
    </html>
  )
}
