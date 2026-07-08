// Collabora Online (the in-browser PowerPoint editor for PPTX-mastered
// training decks). Two URLs are involved:
//
// - COLLABORA_URL: where the BROWSER (and this server, for discovery) reaches
//   Collabora — e.g. http://localhost:9980 locally, a public https URL in prod.
// - COLLABORA_WOPI_URL: where the COLLABORA CONTAINER reaches THIS app's
//   /wopi/files/* routes. Locally that is http://host.docker.internal:3000
//   (Collabora runs in Docker, the app on the host); in prod it defaults to
//   APP_URL. This is baked into the WOPISrc query param Collabora calls back on.
//
// When COLLABORA_URL is unset the feature is cleanly disabled — the editor
// surfaces explain that PowerPoint editing isn't configured (import, playback
// and download keep working; they don't need Collabora).

/** Office app inside Collabora: Impress (slides) or Writer (documents). */
export type CollaboraApp = 'presentation' | 'text'

const APP_MIME: Record<CollaboraApp, string> = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  text: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const APP_EXT: Record<CollaboraApp, string> = { presentation: 'pptx', text: 'docx' }
const DISCOVERY_TTL_MS = 10 * 60 * 1000

export function collaboraConfigured(): boolean {
  return !!process.env.COLLABORA_URL
}

/** Base URL of this app as reachable from the Collabora container. */
export function wopiCallbackBase(): string {
  const base =
    process.env.COLLABORA_WOPI_URL ??
    process.env.APP_URL ??
    process.env.BETTER_AUTH_URL ??
    'http://localhost:3000'
  return base.replace(/\/+$/, '')
}

const cached: Partial<Record<CollaboraApp, { url: string; at: number }>> = {}

/**
 * Resolve the Collabora edit-action URL for an office app from its WOPI
 * discovery XML (cached 10 min). Returns null when Collabora is not
 * configured or not reachable — callers must surface a real disabled state.
 */
export async function getCollaboraEditUrl(
  app: CollaboraApp = 'presentation',
): Promise<string | null> {
  const base = process.env.COLLABORA_URL?.replace(/\/+$/, '')
  if (!base) return null
  const hit = cached[app]
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.url

  try {
    const res = await fetch(`${base}/hosting/discovery`, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const xml = await res.text()
    const url = editUrlFromDiscovery(xml, app)
    if (!url) return null
    cached[app] = { url, at: Date.now() }
    return url
  } catch {
    return null
  }
}

export function editUrlFromDiscovery(
  xml: string,
  app: CollaboraApp = 'presentation',
): string | null {
  // <app name="...mime..."><action name="edit" urlsrc="https://..."/></app>
  const apps = [...xml.matchAll(/<app[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/app>/g)]
  for (const [, name, body] of apps) {
    if (name !== APP_MIME[app]) continue
    const action = body?.match(/<action[^>]*name="edit"[^>]*urlsrc="([^"]+)"/)
    if (action?.[1]) return action[1]
  }
  // Older discovery layouts key actions by extension instead of MIME type.
  const byExt = xml.match(
    new RegExp(`<action[^>]*ext="${APP_EXT[app]}"[^>]*name="edit"[^>]*urlsrc="([^"]+)"`),
  )
  return byExt?.[1] ?? null
}

/**
 * Full iframe form-POST URL for editing one attachment: the discovery urlsrc
 * plus our WOPISrc. Collabora tolerates trailing placeholder tokens in urlsrc
 * (<ui=UI_LLCC&>…); strip them before appending. Theming lives in the mounted
 * branding.js (deploy/collabora-branding.js), not in URL params.
 */
export function buildEditorUrl(editUrl: string, attachmentId: string): string {
  const cleaned = editUrl.replace(/<[^>]*>/g, '')
  const sep = !cleaned.includes('?')
    ? '?'
    : cleaned.endsWith('?') || cleaned.endsWith('&')
      ? ''
      : '&'
  const wopiSrc = `${wopiCallbackBase()}/wopi/files/${attachmentId}`
  return `${cleaned}${sep}WOPISrc=${encodeURIComponent(wopiSrc)}`
}
