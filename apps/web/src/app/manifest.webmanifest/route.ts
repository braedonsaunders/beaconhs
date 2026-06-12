// PWA manifest served at /manifest.webmanifest. Tenant branding can override
// fields server-side in v2; for now we ship the global brand.

import { NextResponse } from 'next/server'

export function GET() {
  return NextResponse.json({
    name: 'BeaconHS',
    short_name: 'BeaconHS',
    description: 'Health & Safety platform',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1B2B4A',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  })
}
