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
type CollaboraApp = 'presentation' | 'text'

const APP_MIME: Record<CollaboraApp, string> = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  text: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const APP_EXT: Record<CollaboraApp, string> = { presentation: 'pptx', text: 'docx' }
const DISCOVERY_TTL_MS = 10 * 60 * 1000

function collaboraConfigured(): boolean {
  return !!process.env.COLLABORA_URL
}

/** Base URL of this app as reachable from the Collabora container. */
function wopiCallbackBase(): string {
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
 * discovery XML (cached 10 min). The action URL practically never changes, so
 * a failed refresh serves the stale cache instead of surfacing a hard
 * "not configured" error mid-session. Returns null only when Collabora is not
 * configured or has never answered discovery.
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
    if (!res.ok) throw new Error(`discovery ${res.status}`)
    const xml = await res.text()
    const url = editUrlFromDiscovery(xml, app)
    if (!url) throw new Error('no edit action in discovery')
    cached[app] = { url, at: Date.now() }
    return url
  } catch {
    return hit?.url ?? null
  }
}

function editUrlFromDiscovery(xml: string, app: CollaboraApp = 'presentation'): string | null {
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

// Open with the properties sidebar closed in every app — the embedded editor
// should start as clean as the rest of the platform. (Users who open it get
// their preference remembered by Collabora per browser.)
const UI_DEFAULTS = [
  'TextSidebar=false',
  'PresentationSidebar=false',
  'SpreadsheetSidebar=false',
  'DrawingSidebar=false',
].join(';')

/**
 * Full iframe form-POST URL for editing one attachment: the discovery urlsrc
 * plus our WOPISrc and UI defaults. Collabora tolerates trailing placeholder
 * tokens in urlsrc (<ui=UI_LLCC&>…); strip them before appending. Colors live
 * in the mounted branding.js (deploy/collabora-branding.js); the embed adds
 * the theme (bhsTheme, enforced by branding.js) client-side to match the app.
 * NEVER pass Collabora's own darkTheme param — the mere presence of the param
 * (even darkTheme=false) makes COOL default to dark AND clobbers ui_defaults.
 */
export function buildEditorUrl(editUrl: string, attachmentId: string): string {
  const cleaned = editUrl.replace(/<[^>]*>/g, '')
  const sep = !cleaned.includes('?')
    ? '?'
    : cleaned.endsWith('?') || cleaned.endsWith('&')
      ? ''
      : '&'
  const wopiSrc = `${wopiCallbackBase()}/wopi/files/${attachmentId}`
  return `${cleaned}${sep}WOPISrc=${encodeURIComponent(wopiSrc)}&ui_defaults=${encodeURIComponent(UI_DEFAULTS)}`
}
