type ContentSecurityPolicyOptions = {
  nonce: string
  isDevelopment: boolean
  collaboraUrl?: string
  storageEndpoint?: string
  sentryDsn?: string
}

function allowedOrigin(
  value: string | undefined,
  allowLoopbackHttp: boolean,
  allowCredentials = false,
): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!allowCredentials && (url.username || url.password)) return null
    if (url.protocol === 'https:') return url.origin
    const loopback =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
    return allowLoopbackHttp && url.protocol === 'http:' && loopback ? url.origin : null
  } catch {
    return null
  }
}

function uniqueSources(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

/**
 * Strict per-request CSP for rendered pages. Script execution is nonce-bound;
 * frames are limited to same-origin/blob/HTTPS and tenant-authored HTTPS frames
 * are separately sandboxed without forms, pop-ups, or top navigation.
 */
export function contentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  if (!/^[A-Za-z0-9_-]{22,128}$/.test(options.nonce)) {
    throw new Error('CSP nonce must be an unguessable URL-safe token')
  }

  const collaboraOrigin = allowedOrigin(options.collaboraUrl, options.isDevelopment)
  const storageOrigin = allowedOrigin(options.storageEndpoint, options.isDevelopment)
  // A Sentry DSN encodes its public project key as URL user info. Only the
  // credential-free origin enters CSP.
  const sentryOrigin = allowedOrigin(options.sentryDsn, false, true)
  const formSources = uniqueSources(["'self'", collaboraOrigin])
  const frameSources = uniqueSources([
    "'self'",
    collaboraOrigin,
    storageOrigin,
    'blob:',
    // Tenant-authored training embeds are restricted to HTTPS and rendered in
    // sandboxed frames. Keep the scheme source so existing approved providers
    // work without turning their origin into a script/form destination.
    'https:',
    'https://www.youtube.com',
    'https://www.youtube-nocookie.com',
    'https://player.vimeo.com',
    'https://www.openstreetmap.org',
  ])
  const connectSources = uniqueSources([
    "'self'",
    // Browser uploads use short-lived presigned PUT/part URLs against the
    // configured private S3-compatible store. Without this origin, CSP turns
    // every shared FileUpload request into a generic browser "Network error"
    // before MinIO/R2 ever receives it.
    storageOrigin,
    sentryOrigin,
    'https://nominatim.openstreetmap.org',
    'https://api.nango.dev',
    // Next.js HMR uses WebSockets locally. The application has no production
    // WebSocket client, so a scheme-wide production allowance is unnecessary.
    options.isDevelopment ? 'wss:' : null,
  ])
  const directives = [
    "default-src 'self'",
    // Turbopack injects some same-origin development chunks without propagating
    // Next's request nonce. `strict-dynamic` would make the otherwise-valid
    // `'self'` source inoperative and block those chunks. Keep production
    // nonce/strict-dynamic semantics exact; development is already a weaker
    // local-only context because source maps/HMR require unsafe-eval.
    `script-src 'self' 'nonce-${options.nonce}'${
      options.isDevelopment ? " 'unsafe-eval'" : " 'strict-dynamic'"
    }`,
    "script-src-attr 'none'",
    // The operational UI uses React style attributes and editor-generated
    // inline CSS. Keep scripts strict while allowing those non-executable styles.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    "media-src 'self' blob: data: https:",
    `connect-src ${connectSources.join(' ')}`,
    "worker-src 'self' blob:",
    `frame-src ${frameSources.join(' ')}`,
    `form-action ${formSources.join(' ')}`,
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "manifest-src 'self'",
    ...(options.isDevelopment ? [] : ['upgrade-insecure-requests']),
  ]
  return directives.map((directive) => `${directive};`).join(' ')
}

export function staticSecurityHeaders(isProduction: boolean): Array<{
  key: string
  value: string
}> {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    { key: 'Origin-Agent-Cluster', value: '?1' },
    {
      key: 'Permissions-Policy',
      value:
        'camera=(self), microphone=(self), geolocation=(self), display-capture=(), payment=(), usb=()',
    },
    ...(isProduction
      ? [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ]
      : []),
  ]
}
