// Canonical web-app base URL for worker-generated links (emails, digests,
// certificate verify QR codes, report links). One resolution order everywhere:
// PUBLIC_APP_URL wins (external deployments that split the public hostname),
// then APP_URL (the variable documented in .env.example), then the local dev
// default. Never returns a trailing slash.
export function appBaseUrl(): string {
  const raw = process.env.PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000'
  return raw.replace(/\/+$/, '')
}
