// Minimal, deliberately online-only service worker. It provides PWA
// installability and push notifications without caching authenticated HTML.
// A shared shell cache can leak one user's dashboard to the next user of the
// device and can resurrect a signed-in page after logout, so navigations are
// always handled by the browser/network.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Remove the retired v1 shell cache from existing installations.
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  const data = event.data.json()
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'BeaconHS', {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      data: { url: data.linkPath ?? '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(event.notification.data?.url ?? '/'))
})
