import type { LookupAddress } from 'node:dns'
import { lookup as dnsLookup } from 'node:dns/promises'
import type { IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { checkServerIdentity } from 'node:tls'
import { domainToASCII } from 'node:url'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024
const DEFAULT_MAX_REQUEST_BYTES = 2 * 1024 * 1024
const MAX_TIMEOUT_MS = 120_000
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const MAX_REQUEST_BYTES = 16 * 1024 * 1024
const MAX_REDIRECTS = 5
const MAX_URL_LENGTH = 4_096
const MAX_HEADER_BYTES = 16 * 1024

const FORBIDDEN_REQUEST_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

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

const ipv4BlockList = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  ipv4BlockList.addSubnet(network, prefix, 'ipv4')
}

// Keep IPv6 rules separate. Node's BlockList treats IPv4 input as an
// IPv4-mapped IPv6 address when a mapped subnet is present, which would make a
// combined list reject every IPv4 address.
const ipv6BlockList = new BlockList()
for (const [network, prefix] of [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  ipv6BlockList.addSubnet(network, prefix, 'ipv6')
}
ipv6BlockList.addAddress('::1', 'ipv6')

export interface ResolvedPublicHost {
  hostname: string
  address: string
  family: 4 | 6
  ipLiteral: boolean
}

export type OutboundDnsResolver = (hostname: string) => Promise<readonly LookupAddress[]>

export interface ResolvePublicHostOptions {
  timeoutMs?: number
  resolver?: OutboundDnsResolver
}

export interface SecureFetchOptions {
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Headers | Record<string, string>
  body?: string | Uint8Array | ArrayBuffer | URLSearchParams | null
  timeoutMs?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
  maxRedirects?: number
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`)
  }
  return resolved
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

export function normalizeOutboundHostname(raw: string): string {
  const trimmed = stripIpv6Brackets(raw.trim()).replace(/\.$/, '')
  if (
    !trimmed ||
    trimmed.length > 253 ||
    /[%/\\?#@\s]/.test(trimmed) ||
    (!isIP(trimmed) && trimmed.includes(':'))
  ) {
    throw new Error('Outbound host is not valid.')
  }
  if (isIP(trimmed)) return trimmed.toLowerCase()

  const hostname = domainToASCII(trimmed).toLowerCase()
  if (
    !hostname ||
    hostname.length > 253 ||
    hostname.split('.').some((label) => !/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))
  ) {
    throw new Error('Outbound host is not valid.')
  }
  return hostname
}

export function isPublicIpAddress(raw: string): boolean {
  const address = stripIpv6Brackets(raw.trim())
  const family = isIP(address)
  if (family === 4) return !ipv4BlockList.check(address, 'ipv4')
  if (family === 6) return !ipv6BlockList.check(address, 'ipv6')
  return false
}

function assertPublicAddress(address: string): 4 | 6 {
  const family = isIP(address)
  if ((family !== 4 && family !== 6) || !isPublicIpAddress(address)) {
    throw new Error('Outbound host resolved to a blocked non-public address.')
  }
  return family
}

function assertPublicHostname(hostname: string): void {
  if (
    hostname === 'localhost' ||
    hostname === 'localhost.localdomain' ||
    RESERVED_HOST_SUFFIXES.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
    )
  ) {
    throw new Error('Outbound host is reserved for local or private use.')
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    timer.unref?.()
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function systemResolver(hostname: string): Promise<readonly LookupAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true })
}

export async function resolvePublicHost(
  rawHostname: string,
  options: ResolvePublicHostOptions = {},
): Promise<ResolvedPublicHost> {
  const hostname = normalizeOutboundHostname(rawHostname)
  const literalFamily = isIP(hostname)
  if (literalFamily === 4 || literalFamily === 6) {
    assertPublicAddress(hostname)
    return { hostname, address: hostname, family: literalFamily, ipLiteral: true }
  }

  assertPublicHostname(hostname)
  const timeoutMs = boundedInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    1,
    MAX_TIMEOUT_MS,
    'DNS timeout',
  )
  const addresses = await withTimeout(
    (options.resolver ?? systemResolver)(hostname),
    timeoutMs,
    'Outbound DNS lookup timed out.',
  )
  if (addresses.length === 0) throw new Error('Outbound host did not resolve to an address.')

  // Reject the entire hostname if any answer is private/special. Choosing only
  // a public answer would still permit rebinding or round-robin fallback to a
  // private address in a later implementation.
  const checked = addresses.map((entry) => {
    const family = assertPublicAddress(entry.address)
    if (entry.family !== family) throw new Error('Outbound DNS returned an invalid address family.')
    return { address: entry.address, family }
  })
  const selected = checked[0]
  if (!selected) throw new Error('Outbound host did not resolve to an address.')
  return { hostname, ...selected, ipLiteral: false }
}

function parseOutboundUrl(input: string | URL): URL {
  const raw = input instanceof URL ? input.href : input
  if (!raw || raw.length > MAX_URL_LENGTH) throw new Error('Outbound URL is missing or too long.')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Outbound URL is not valid.')
  }
  if (url.protocol !== 'https:') throw new Error('Outbound URL must use HTTPS.')
  if (url.username || url.password) throw new Error('Outbound URL must not include credentials.')
  if (url.port && (!Number.isInteger(Number(url.port)) || Number(url.port) < 1)) {
    throw new Error('Outbound URL port must be between 1 and 65535.')
  }
  normalizeOutboundHostname(url.hostname)
  url.hash = ''
  return url
}

function requestBodyBytes(body: SecureFetchOptions['body']): Buffer | undefined {
  if (body == null) return undefined
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof URLSearchParams) return Buffer.from(body.toString())
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
}

function normalizedHeaders(
  input: Headers | Record<string, string> | undefined,
): Record<string, string> {
  const headers = new Headers(input)
  const out: Record<string, string> = {}
  for (const [name, value] of headers) {
    if (FORBIDDEN_REQUEST_HEADERS.has(name)) {
      throw new Error(`Outbound request header "${name}" is not allowed.`)
    }
    out[name] = value
  }
  if (!headers.has('accept-encoding')) out['accept-encoding'] = 'identity'
  const headerBytes = Object.entries(out).reduce(
    (total, [name, value]) => total + Buffer.byteLength(name) + Buffer.byteLength(value) + 4,
    0,
  )
  if (headerBytes > MAX_HEADER_BYTES) {
    throw new Error(`Outbound request headers exceeded ${MAX_HEADER_BYTES} bytes.`)
  }
  return out
}

function responseHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item)
    } else if (value != null) {
      headers.set(name, String(value))
    }
  }
  return headers
}

interface RawResponse {
  status: number
  statusMessage: string
  headers: Headers
  body: Buffer
}

function requestOnce(
  url: URL,
  resolved: ResolvedPublicHost,
  method: NonNullable<SecureFetchOptions['method']>,
  headers: Record<string, string>,
  body: Buffer | undefined,
  maxResponseBytes: number,
  timeoutMs: number,
): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    let settled = false
    const finishError = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const finish = (value: RawResponse) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const requestHeaders: Record<string, string> = {
      ...headers,
      connection: 'close',
      host: url.host,
    }
    if (body) requestHeaders['content-length'] = String(body.length)

    const request = httpsRequest(
      {
        protocol: 'https:',
        hostname: resolved.address,
        family: resolved.family,
        port: url.port ? Number(url.port) : 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers: requestHeaders,
        agent: false,
        maxHeaderSize: MAX_HEADER_BYTES,
        rejectUnauthorized: true,
        servername: resolved.ipLiteral ? undefined : resolved.hostname,
        checkServerIdentity: (_hostname, cert) => checkServerIdentity(resolved.hostname, cert),
      },
      (response) => {
        const chunks: Buffer[] = []
        let bytes = 0
        const contentEncoding = String(response.headers['content-encoding'] ?? '')
          .trim()
          .toLowerCase()
        if (contentEncoding && contentEncoding !== 'identity') {
          const error = new Error('Outbound server ignored the identity encoding requirement.')
          response.destroy(error)
          finishError(error)
          return
        }

        const advertised = Number(response.headers['content-length'])
        if (method !== 'HEAD' && Number.isFinite(advertised) && advertised > maxResponseBytes) {
          const error = new Error(`Outbound response exceeded ${maxResponseBytes} bytes.`)
          response.destroy(error)
          finishError(error)
          return
        }

        response.on('data', (chunk: Buffer | Uint8Array | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          bytes += buffer.length
          if (bytes > maxResponseBytes) {
            const error = new Error(`Outbound response exceeded ${maxResponseBytes} bytes.`)
            response.destroy(error)
            finishError(error)
            return
          }
          chunks.push(buffer)
        })
        response.on('error', (error) => finishError(error))
        response.on('end', () => {
          finish({
            status: response.statusCode ?? 0,
            statusMessage: response.statusMessage ?? '',
            headers: responseHeaders(response.headers),
            body: Buffer.concat(chunks, bytes),
          })
        })
      },
    )

    const timer = setTimeout(() => {
      request.destroy(new Error(`Outbound request timed out after ${timeoutMs} ms.`))
    }, timeoutMs)
    timer.unref?.()
    request.on('error', (error) => finishError(error))
    if (body) request.write(body)
    request.end()
  })
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function responseFromRaw(raw: RawResponse): Response {
  if (raw.status < 200 || raw.status > 599) {
    throw new Error(`Outbound server returned unsupported HTTP status ${raw.status}.`)
  }
  const noBody = raw.status === 204 || raw.status === 205 || raw.status === 304
  const body = noBody ? null : Uint8Array.from(raw.body).buffer
  return new Response(body, {
    status: raw.status,
    statusText: raw.statusMessage,
    headers: raw.headers,
  })
}

/**
 * Make a bounded HTTPS request to a public host.
 *
 * Every redirect is resolved and validated again. The socket connects directly
 * to the selected DNS answer while TLS/SNI is verified against the original
 * hostname, closing the validation-to-connect DNS-rebinding gap.
 */
export async function secureFetch(
  input: string | URL,
  options: SecureFetchOptions = {},
): Promise<Response> {
  const timeoutMs = boundedInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    1,
    MAX_TIMEOUT_MS,
    'Request timeout',
  )
  const maxRequestBytes = boundedInteger(
    options.maxRequestBytes,
    DEFAULT_MAX_REQUEST_BYTES,
    0,
    MAX_REQUEST_BYTES,
    'Maximum request size',
  )
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    0,
    MAX_RESPONSE_BYTES,
    'Maximum response size',
  )
  const maxRedirects = boundedInteger(
    options.maxRedirects,
    2,
    0,
    MAX_REDIRECTS,
    'Maximum redirects',
  )
  let method = options.method ?? 'GET'
  let body = requestBodyBytes(options.body)
  if ((method === 'GET' || method === 'HEAD') && body) {
    throw new Error(`${method} outbound requests cannot include a body.`)
  }
  if ((body?.length ?? 0) > maxRequestBytes) {
    throw new Error(`Outbound request body exceeded ${maxRequestBytes} bytes.`)
  }
  const headers = normalizedHeaders(options.headers)
  const deadline = Date.now() + timeoutMs
  const visited = new Set<string>()
  let url = parseOutboundUrl(input)

  for (let redirectCount = 0; ; redirectCount++) {
    if (visited.has(url.href)) throw new Error('Outbound redirect loop detected.')
    visited.add(url.href)
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`Outbound request timed out after ${timeoutMs} ms.`)

    const resolved = await resolvePublicHost(url.hostname, { timeoutMs: remaining })
    const raw = await requestOnce(
      url,
      resolved,
      method,
      headers,
      body,
      maxResponseBytes,
      Math.max(1, deadline - Date.now()),
    )
    if (!isRedirect(raw.status)) return responseFromRaw(raw)

    const location = raw.headers.get('location')
    if (!location) throw new Error(`Outbound redirect ${raw.status} did not include a location.`)
    if (redirectCount >= maxRedirects) {
      throw new Error(`Outbound request exceeded ${maxRedirects} redirect(s).`)
    }
    const next = parseOutboundUrl(new URL(location, url))
    if (next.origin !== url.origin) {
      throw new Error('Cross-origin outbound redirects are not allowed.')
    }

    if (raw.status === 303 || ((raw.status === 301 || raw.status === 302) && method === 'POST')) {
      method = 'GET'
      body = undefined
      delete headers['content-type']
    }
    url = next
  }
}
