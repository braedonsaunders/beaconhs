const MAX_TRAINING_URL_LENGTH = 4_096
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const VIMEO_ID = /^\d{1,12}$/
const RESERVED_HOST_SUFFIXES = [
  '.example',
  '.home',
  '.internal',
  '.invalid',
  '.lan',
  '.local',
  '.localhost',
  '.onion',
  '.test',
]

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
])
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'])

type TrainingVideoProvider = 'youtube' | 'vimeo'

type NormalizedTrainingExternalUrl = {
  url: string
  provider: TrainingVideoProvider | null
}

type TrainingExternalUrlOptions = {
  blockedOrigins?: Iterable<string>
}

function normalizedBlockedHostnames(values: Iterable<string> | undefined): Set<string> {
  const hostnames = new Set<string>()
  for (const value of values ?? []) {
    try {
      const url = new URL(value)
      // Cookies are host-based rather than port-based. Block every port on a
      // configured application/document-editor host, not only its exact URL.
      hostnames.add(url.hostname.toLowerCase().replace(/\.$/, ''))
    } catch {
      // Configuration is validated by the server-only policy. Render callers
      // still fail closed for every valid configured URL they were given.
    }
  }
  return hostnames
}

function assertExternalDnsHostname(hostnameRaw: string): string {
  const hostname = hostnameRaw.toLowerCase().replace(/\.$/, '')
  const labels = hostname.split('.')
  const isIpLiteral = hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(hostname)
  const isReserved =
    hostname === 'localhost' ||
    hostname === 'localhost.localdomain' ||
    RESERVED_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
    )
  const isDnsName =
    hostname.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))

  if (!hostname || isIpLiteral || isReserved || !isDnsName) {
    throw new Error('Training links must use an external public DNS hostname.')
  }
  return hostname
}

function youtubeVideo(url: URL, hostname: string): { id: string; suffix: string } {
  const segments = url.pathname.split('/').filter(Boolean)
  let id: string | null = null
  let preservePlayerParameters = false

  if (hostname === 'youtu.be' && segments.length === 1) {
    id = segments[0] ?? null
  } else if (
    (hostname === 'youtube.com' ||
      hostname === 'www.youtube.com' ||
      hostname === 'm.youtube.com') &&
    url.pathname === '/watch' &&
    url.searchParams.getAll('v').length === 1
  ) {
    id = url.searchParams.get('v')
  } else if (
    hostname !== 'youtu.be' &&
    segments.length === 2 &&
    (segments[0] === 'embed' || segments[0] === 'shorts')
  ) {
    id = segments[1] ?? null
    preservePlayerParameters = true
  }

  if (!id || !YOUTUBE_ID.test(id)) {
    throw new Error('Use a valid YouTube watch, short, or embed link.')
  }
  return { id, suffix: preservePlayerParameters ? `${url.search}${url.hash}` : '' }
}

function vimeoVideo(url: URL, hostname: string): { id: string; suffix: string } {
  const segments = url.pathname.split('/').filter(Boolean)
  const isPlayerUrl =
    hostname === 'player.vimeo.com' && segments[0] === 'video' && segments.length === 2
  const id = isPlayerUrl
    ? segments[1]
    : hostname !== 'player.vimeo.com' && segments.length === 1
      ? segments[0]
      : null

  if (!id || !VIMEO_ID.test(id)) {
    throw new Error('Use a valid Vimeo video or player link.')
  }
  return { id, suffix: isPlayerUrl ? `${url.search}${url.hash}` : '' }
}

/**
 * Canonical policy for tenant-authored training video and iframe links.
 *
 * This function is intentionally browser- and server-safe. Persistence adds
 * configured-origin and DNS checks in the server-only wrapper; renderers call
 * this same parser again so stale or manually inserted unsafe values fail
 * closed instead of reaching a media element.
 */
export function normalizeTrainingExternalUrl(
  input: string,
  options: TrainingExternalUrlOptions = {},
): NormalizedTrainingExternalUrl {
  const raw = input.trim()
  if (!raw || raw.length > MAX_TRAINING_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error('Training link is missing, too long, or contains invalid characters.')
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Training link must be a complete HTTPS URL.')
  }
  if (url.protocol !== 'https:') {
    throw new Error('Training links must use HTTPS.')
  }
  if (url.username || url.password) {
    throw new Error('Training links must not include a username or password.')
  }

  const hostname = assertExternalDnsHostname(url.hostname)
  if (normalizedBlockedHostnames(options.blockedOrigins).has(hostname)) {
    throw new Error('Training links cannot point to BeaconHS or its document editor.')
  }

  if (YOUTUBE_HOSTS.has(hostname)) {
    const video = youtubeVideo(url, hostname)
    return {
      url: `https://www.youtube-nocookie.com/embed/${video.id}${video.suffix}`,
      provider: 'youtube',
    }
  }
  if (VIMEO_HOSTS.has(hostname)) {
    const video = vimeoVideo(url, hostname)
    return {
      url: `https://player.vimeo.com/video/${video.id}${video.suffix}`,
      provider: 'vimeo',
    }
  }

  return { url: url.toString(), provider: null }
}

export function safeTrainingExternalUrl(
  input: string | null | undefined,
  options: TrainingExternalUrlOptions = {},
): NormalizedTrainingExternalUrl | null {
  if (!input) return null
  try {
    return normalizeTrainingExternalUrl(input, options)
  } catch {
    return null
  }
}

/**
 * Vetted video providers retain their own origin so their players can use
 * cookies/storage. Arbitrary embedded pages receive an opaque origin: scripts
 * work, but `allow-same-origin`, forms, pop-ups, and top navigation do not.
 */
export function trainingFrameSandbox(provider: TrainingVideoProvider | null): string {
  return provider
    ? 'allow-scripts allow-same-origin allow-presentation'
    : 'allow-scripts allow-presentation'
}
