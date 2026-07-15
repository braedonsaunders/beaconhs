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
// When COLLABORA_URL is unset, editing and presentation playback are disabled.
// There is deliberately no PDF/image fallback: the PPTX master is always
// rendered by Collabora so animations, transitions, timings, links, and media
// keep PowerPoint fidelity.

import { SaxesParser, type SaxesTagNS } from 'saxes'

/** Office app inside Collabora: Impress (slides) or Writer (documents). */
type CollaboraApp = 'presentation' | 'text'
type CollaboraAction = 'edit' | 'view'

const APP_MIME: Record<CollaboraApp, string> = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  text: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const APP_EXT: Record<CollaboraApp, string> = { presentation: 'pptx', text: 'docx' }
const RECOGNIZED_APP_MIMES = new Set(Object.values(APP_MIME))
const DISCOVERY_TTL_MS = 10 * 60 * 1000
const MAX_DISCOVERY_BYTES = 1024 * 1024
const MAX_DISCOVERY_ACTIONS = 4096
const MAX_DISCOVERY_DEPTH = 32
const MAX_DISCOVERY_ELEMENTS = 16_384
const RESERVED_EDITOR_QUERY_KEYS = new Set([
  'access_token',
  'access_token_ttl',
  'bhstheme',
  'darktheme',
  'ui_defaults',
  'wopisrc',
  'startpresentation',
])

interface DiscoveryAction {
  appName: string | undefined
  extension: string | undefined
  name: string | undefined
  url: string | undefined
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

const cached = new Map<string, { url: string; at: number }>()

function cacheKey(app: CollaboraApp, action: CollaboraAction): string {
  return `${app}:${action}`
}

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
  return getCollaboraActionUrl(app, 'edit')
}

/** Resolve the read-only Collabora view action used for real PPTX playback. */
export async function getCollaboraViewUrl(
  app: CollaboraApp = 'presentation',
): Promise<string | null> {
  return getCollaboraActionUrl(app, 'view')
}

async function getCollaboraActionUrl(
  app: CollaboraApp,
  action: CollaboraAction,
): Promise<string | null> {
  const base = process.env.COLLABORA_URL?.replace(/\/+$/, '')
  if (!base) return null
  const key = cacheKey(app, action)
  const hit = cached.get(key)
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.url

  try {
    const res = await fetch(`${base}/hosting/discovery`, {
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`discovery ${res.status}`)
    const body = await readLimitedDiscovery(res)
    const url = resolveCollaboraActionUrlBytes(body, base, app, action)
    if (!url) throw new Error(`no ${action} action in discovery`)
    cached.set(key, { url, at: Date.now() })
    return url
  } catch {
    return hit?.url ?? null
  }
}

async function readLimitedDiscovery(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  let bytes = 0
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      const body = new Uint8Array(bytes)
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.byteLength
      }
      return body
    }
    bytes += value.byteLength
    if (bytes > MAX_DISCOVERY_BYTES) {
      await reader.cancel()
      throw new Error('Collabora discovery response exceeded the byte limit')
    }
    chunks.push(value)
  }
}

function attributeValue(tag: SaxesTagNS, name: string): string | undefined {
  return Object.values(tag.attributes).find(
    (attribute) => attribute.local === name && attribute.uri === '',
  )?.value
}

function cleanDiscoveryActionUrl(value: string): string | null {
  const queryIndex = value.indexOf('?')
  const beforeQuery = queryIndex === -1 ? value : value.slice(0, queryIndex)
  if (beforeQuery.includes('<') || beforeQuery.includes('>')) return null
  if (queryIndex === -1) return value

  let cleaned = beforeQuery
  for (let index = queryIndex; index < value.length; index += 1) {
    const character = value[index]!
    if (character === '>') return null
    if (character !== '<') {
      cleaned += character
      continue
    }

    let end = index + 1
    let identifiesPlaceholder = false
    for (; end < value.length && end - index <= 128; end += 1) {
      const placeholderCharacter = value[end]!
      if (placeholderCharacter === '>') break
      if (placeholderCharacter === '<') return null
      const code = placeholderCharacter.charCodeAt(0)
      const allowed =
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        placeholderCharacter === '_' ||
        placeholderCharacter === '=' ||
        placeholderCharacter === '&' ||
        placeholderCharacter === '.' ||
        placeholderCharacter === '-'
      if (!allowed) return null
      if (placeholderCharacter === '_' || placeholderCharacter === '=') {
        identifiesPlaceholder = true
      }
    }
    if (end >= value.length || value[end] !== '>' || !identifiesPlaceholder) return null
    index = end
  }
  return cleaned
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '[::1]'
}

function validatedActionUrl(
  value: string,
  expectedBaseUrl: string,
  rejectReservedQuery: boolean,
): URL | null {
  const cleaned = cleanDiscoveryActionUrl(value.trim())
  if (!cleaned) return null

  try {
    const expected = new URL(expectedBaseUrl)
    const edit = new URL(cleaned)
    const hasReservedQueryKey = [...edit.searchParams.keys()].some((key) =>
      RESERVED_EDITOR_QUERY_KEYS.has(key.toLowerCase()),
    )
    const expectedProtocolIsSafe =
      expected.protocol === 'https:' ||
      (expected.protocol === 'http:' && isLoopbackHost(expected.hostname))
    if (
      !expectedProtocolIsSafe ||
      expected.username ||
      expected.password ||
      (expected.pathname !== '' && expected.pathname !== '/') ||
      expected.search ||
      expected.hash ||
      edit.origin !== expected.origin ||
      edit.username ||
      edit.password ||
      edit.hash ||
      !edit.pathname.startsWith('/browser/') ||
      (rejectReservedQuery && hasReservedQueryKey)
    ) {
      return null
    }
    return edit
  } catch {
    return null
  }
}

function parseDiscoveryActions(xml: string): DiscoveryAction[] | null {
  if (new TextEncoder().encode(xml).byteLength > MAX_DISCOVERY_BYTES) return null

  const actions: DiscoveryAction[] = []
  const parser = new SaxesParser({ xmlns: true, position: false })
  let depth = 0
  let elements = 0
  let rootSeen = false
  let netZoneDepth: number | null = null
  let appDepth: number | null = null
  let currentAppName: string | undefined

  try {
    parser.on('doctype', () => {
      throw new Error('DOCTYPE is not permitted in Collabora discovery XML')
    })
    parser.on('opentag', (tag) => {
      depth += 1
      elements += 1
      if (depth > MAX_DISCOVERY_DEPTH) {
        throw new Error('Collabora discovery exceeds the XML depth limit')
      }
      if (elements > MAX_DISCOVERY_ELEMENTS) {
        throw new Error('Collabora discovery exceeds the XML element limit')
      }
      if (depth === 1) {
        if (tag.local !== 'wopi-discovery') {
          throw new Error('Unexpected Collabora discovery root element')
        }
        rootSeen = true
      }

      if (tag.local === 'net-zone') {
        if (depth !== 2 || netZoneDepth !== null || appDepth !== null) {
          throw new Error('Invalid discovery net-zone hierarchy')
        }
        netZoneDepth = depth
      }

      if (tag.local === 'app') {
        if (netZoneDepth === null || depth !== netZoneDepth + 1 || appDepth !== null) {
          throw new Error('Invalid discovery app hierarchy')
        }
        const appName = attributeValue(tag, 'name')?.trim()
        if (!appName) throw new Error('Discovery app name is required')
        appDepth = depth
        currentAppName = appName
      }

      if (tag.local === 'action') {
        if (appDepth === null || depth !== appDepth + 1) {
          throw new Error('Invalid discovery action hierarchy')
        }
        if (actions.length >= MAX_DISCOVERY_ACTIONS) {
          throw new Error('Collabora discovery contains too many actions')
        }
        actions.push({
          appName: currentAppName,
          extension: attributeValue(tag, 'ext'),
          name: attributeValue(tag, 'name'),
          url: attributeValue(tag, 'urlsrc'),
        })
      }
    })
    parser.on('closetag', (tag) => {
      if (tag.local === 'app' && appDepth === depth) {
        appDepth = null
        currentAppName = undefined
      }
      if (tag.local === 'net-zone' && netZoneDepth === depth) netZoneDepth = null
      depth -= 1
    })
    parser.write(xml).close()
  } catch {
    return null
  }

  return rootSeen && depth === 0 && netZoneDepth === null && appDepth === null ? actions : null
}

/**
 * Select and validate the exact edit action BeaconHS will use. MIME actions
 * take precedence over the legacy extension layout, and the first semantic
 * match wins. An invalid first match fails closed instead of falling through
 * to a later URL. This prevents discovery XML from redirecting WOPI tokens to
 * another origin.
 */
export function resolveCollaboraEditUrl(
  xml: string,
  expectedBaseUrl: string,
  app: CollaboraApp = 'presentation',
): string | null {
  return resolveCollaboraActionUrl(xml, expectedBaseUrl, app, 'edit')
}

export function resolveCollaboraViewUrl(
  xml: string,
  expectedBaseUrl: string,
  app: CollaboraApp = 'presentation',
): string | null {
  return resolveCollaboraActionUrl(xml, expectedBaseUrl, app, 'view')
}

function resolveCollaboraActionUrl(
  xml: string,
  expectedBaseUrl: string,
  app: CollaboraApp,
  actionName: CollaboraAction,
): string | null {
  const actions = parseDiscoveryActions(xml)
  if (!actions) return null

  const selected =
    actions.find((action) => action.appName === APP_MIME[app] && action.name === actionName) ??
    actions.find(
      (action) =>
        action.extension === APP_EXT[app] &&
        action.name === actionName &&
        action.appName !== undefined &&
        !RECOGNIZED_APP_MIMES.has(action.appName),
    )
  if (!selected?.url) return null
  return validatedActionUrl(selected.url, expectedBaseUrl, true)?.toString() ?? null
}

/** Decode and resolve discovery bytes with the same strict contract used by deployment CI. */
export function resolveCollaboraEditUrlBytes(
  body: Uint8Array,
  expectedBaseUrl: string,
  app: CollaboraApp = 'presentation',
): string | null {
  return resolveCollaboraActionUrlBytes(body, expectedBaseUrl, app, 'edit')
}

function resolveCollaboraActionUrlBytes(
  body: Uint8Array,
  expectedBaseUrl: string,
  app: CollaboraApp,
  action: CollaboraAction,
): string | null {
  if (body.byteLength > MAX_DISCOVERY_BYTES) return null
  try {
    const xml = new TextDecoder('utf-8', { fatal: true }).decode(body)
    return resolveCollaboraActionUrl(xml, expectedBaseUrl, app, action)
  } catch {
    return null
  }
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
  return buildCollaboraUrl(editUrl, attachmentId, false)
}

/**
 * Full iframe form-POST URL for read-only, native Impress presentation mode.
 * `startPresentation=true` is a Collabora host parameter, not a simulated
 * BeaconHS slideshow: Impress owns every build, transition, timer, link, and
 * embedded-media interaction inside the frame.
 */
export function buildPresentationUrl(viewUrl: string, attachmentId: string): string {
  return buildCollaboraUrl(viewUrl, attachmentId, true)
}

function buildCollaboraUrl(
  actionUrl: string,
  attachmentId: string,
  startPresentation: boolean,
): string {
  const expectedBaseUrl = process.env.COLLABORA_URL
  const url = expectedBaseUrl ? validatedActionUrl(actionUrl, expectedBaseUrl, false) : null
  if (!url) throw new Error('Invalid Collabora action URL')
  for (const key of [...url.searchParams.keys()]) {
    if (RESERVED_EDITOR_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.delete(key)
  }
  url.hash = ''
  const wopiSrc = `${wopiCallbackBase()}/wopi/files/${encodeURIComponent(attachmentId)}`
  url.searchParams.set('WOPISrc', wopiSrc)
  url.searchParams.set('ui_defaults', UI_DEFAULTS)
  if (startPresentation) url.searchParams.set('startPresentation', 'true')
  return url.toString()
}
