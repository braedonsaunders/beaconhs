// Canonical browser-reachable base URL for links the web app generates —
// certificate/wallet verify QR codes, emails, equipment labels, kiosk URLs.
// One resolution order everywhere (mirrors apps/worker/src/lib/app-base-url.ts):
// PUBLIC_APP_URL wins (deployments that split the public hostname), then
// NEXT_PUBLIC_APP_URL, then APP_URL (the variable documented in .env.example),
// then the local dev default. Never returns a trailing slash.
export function appBaseUrl(): string {
  const raw =
    process.env.PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    'http://localhost:3000'
  return raw.replace(/\/+$/, '')
}
