'use client'

// Registers the PWA service worker (/sw.js) for every authenticated session and
// mirrors the unread-notification count onto the OS app-icon badge where the
// platform supports it (installed PWAs on Chrome/Edge/Android, and iOS/iPadOS
// 16.4+ home-screen installs). Renders nothing.
//
// The service worker makes the app installable and lets push notifications
// reach the device. BeaconHS remains deliberately online-only; authenticated
// pages are never placed in a cross-session browser cache. See public/sw.js.

import { useEffect } from 'react'

type BadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export function ServiceWorkerRegistrar({ unreadCount }: { unreadCount: number }) {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // Registration is idempotent — the browser no-ops when /sw.js is unchanged.
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] service worker registration failed:', err)
    })
  }, [])

  useEffect(() => {
    // Best-effort, feature-detected. No-op on platforms without the Badging API.
    const nav = navigator as BadgeNavigator
    if (typeof nav.setAppBadge !== 'function') return
    if (unreadCount > 0) nav.setAppBadge(unreadCount).catch(() => {})
    else nav.clearAppBadge?.().catch(() => {})
  }, [unreadCount])

  return null
}
