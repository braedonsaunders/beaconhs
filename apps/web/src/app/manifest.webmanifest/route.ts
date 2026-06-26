// PWA manifest served at /manifest.webmanifest. Falls back to the global brand,
// but overrides name + theme colour for the active tenant when the request
// carries the session cookie. That cookie only rides along because the manifest
// <link> in app/layout.tsx sets crossorigin="use-credentials" — browsers fetch
// the manifest WITHOUT credentials by default, even same-origin.
//
// Note: the install snapshots the manifest, so a tenant's name/colour are fixed
// at the moment of "Add to Home Screen"; switching tenants later won't re-brand
// an already-installed app. Icons stay global (a tenant logoUrl is an arbitrary
// image, not a square/maskable icon set).

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { getRequestContext } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
  { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

export async function GET() {
  let name = 'BeaconHS'
  let themeColor = '#1B2B4A'

  try {
    const ctx = await getRequestContext()
    if (ctx) {
      const [tenant] = await withSuperAdmin(db, async (tx) => {
        return tx
          .select({ name: tenants.name, branding: tenants.branding })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .limit(1)
      })
      if (tenant) {
        name = tenant.name
        themeColor = tenant.branding?.primaryColor || themeColor
      }
    }
  } catch {
    // Any resolution failure (logged out, DB blip) → global brand.
  }

  return NextResponse.json(
    {
      name,
      short_name: name.length > 18 ? name.slice(0, 18) : name,
      description: 'Health & Safety platform',
      start_url: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: themeColor,
      icons: ICONS,
    },
    { headers: { 'Cache-Control': 'private, no-cache' } },
  )
}
