import './globals.css'
import type { Metadata, Viewport } from 'next'

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
  themeColor: '#0f766e',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden bg-slate-50 antialiased text-slate-900">
        {children}
      </body>
    </html>
  )
}
