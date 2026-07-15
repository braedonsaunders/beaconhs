// Shared puppeteer browser instance. We launch lazily and keep it around for
// the lifetime of the worker process so successive renders don't pay the
// Chromium startup tax.

import { existsSync } from 'node:fs'
import puppeteer, { type Browser, type HTTPRequest, type Page } from 'puppeteer-core'
import { secureFetch } from '@beaconhs/sync/egress'

let browserPromise: Promise<Browser> | null = null
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024
const MAX_RESOURCE_REDIRECTS = 2
const RESOURCE_TIMEOUT_MS = 10_000
const MAX_REMOTE_RESOURCES = 100
const MAX_CONCURRENT_RESOURCES = 4
const MAX_TOTAL_RESOURCE_BYTES = 32 * 1024 * 1024
const MAX_REPORTED_RESOURCE_ERRORS = 20
const MAX_DOCUMENT_HTML_BYTES = 16 * 1024 * 1024
const ALLOWED_RESOURCE_TYPES = new Set(['image', 'stylesheet', 'font'])
type PdfResourceState = {
  errors: Error[]
  remoteRequests: number
  totalBytes: number
  activeRequests: number
  waiters: (() => void)[]
}
const resourceStates = new WeakMap<Page, PdfResourceState>()

function recordResourceError(state: PdfResourceState, error: unknown): void {
  if (state.errors.length >= MAX_REPORTED_RESOURCE_ERRORS) return
  state.errors.push(error instanceof Error ? error : new Error('PDF resource request failed'))
}

async function withResourceSlot<T>(
  state: PdfResourceState,
  operation: () => Promise<T>,
): Promise<T> {
  if (state.activeRequests >= MAX_CONCURRENT_RESOURCES) {
    await new Promise<void>((resolve) => state.waiters.push(resolve))
  } else {
    state.activeRequests += 1
  }
  try {
    return await operation()
  } finally {
    const next = state.waiters.shift()
    if (next) next()
    else state.activeRequests -= 1
  }
}

function configuredHttpOrigin(raw: string, name: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL for PDF rendering`)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an absolute HTTP(S) URL for PDF rendering`)
  }
  return url.origin
}

function configuredStorageOrigin(): string {
  const endpoint =
    process.env.R2_ENDPOINT ??
    (process.env.R2_ACCOUNT_ID && process.env.R2_ACCOUNT_ID !== 'local'
      ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
      : 'http://localhost:9000')
  return configuredHttpOrigin(endpoint, 'R2_ENDPOINT')
}

function configuredAppOrigin(): string {
  return configuredHttpOrigin(
    process.env.PUBLIC_APP_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.APP_URL ??
      'http://localhost:3000',
    'PUBLIC_APP_URL, NEXT_PUBLIC_APP_URL, or APP_URL',
  )
}

function hasAwsSignature(url: URL): boolean {
  return [...url.searchParams.entries()].some(
    ([name, value]) => name.toLowerCase() === 'x-amz-signature' && value.length > 0,
  )
}

type PdfResourceDecision = 'local' | 'app' | 'storage' | 'proxy' | 'block'

export function pdfResourceDecision(
  rawUrl: string,
  resourceType: string,
  method: string,
  storageOrigin = configuredStorageOrigin(),
  appOrigin = configuredAppOrigin(),
): PdfResourceDecision {
  if (!ALLOWED_RESOURCE_TYPES.has(resourceType) || method !== 'GET') return 'block'
  if (/^(?:data|blob|about):/i.test(rawUrl)) return 'local'
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return 'block'
  }
  if (url.username || url.password) return 'block'
  if (url.origin === storageOrigin && hasAwsSignature(url)) return 'storage'
  if (url.origin === appOrigin && ['http:', 'https:'].includes(url.protocol)) return 'app'
  return url.protocol === 'https:' ? 'proxy' : 'block'
}

function allowedContentType(resourceType: string, contentType: string): boolean {
  const normalized = contentType.split(';', 1)[0]!.trim().toLowerCase()
  if (resourceType === 'image') return normalized.startsWith('image/')
  if (resourceType === 'stylesheet') return normalized === 'text/css'
  return (
    normalized.startsWith('font/') ||
    normalized.startsWith('application/font') ||
    normalized === 'application/octet-stream' ||
    normalized === 'application/vnd.ms-fontobject'
  )
}

type PdfResourceResponse = {
  status: number
  contentType: string
  body: Buffer
}

async function readBoundedBody(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESOURCE_BYTES) {
    throw new Error('PDF resource exceeded the maximum allowed size')
  }
  if (!response.body) return Buffer.alloc(0)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      total += result.value.byteLength
      if (total > MAX_RESOURCE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('PDF resource exceeded the maximum allowed size')
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

async function fetchPdfResource(
  rawUrl: string,
  resourceType: string,
  storageOrigin: string,
  appOrigin: string,
): Promise<PdfResourceResponse> {
  let url = new URL(rawUrl)
  for (let redirect = 0; redirect <= MAX_RESOURCE_REDIRECTS; redirect += 1) {
    const decision = pdfResourceDecision(url.href, resourceType, 'GET', storageOrigin, appOrigin)
    if (decision === 'block' || decision === 'local') {
      throw new Error('PDF resource redirect was blocked')
    }

    const response =
      decision === 'proxy'
        ? await secureFetch(url, {
            method: 'GET',
            timeoutMs: RESOURCE_TIMEOUT_MS,
            maxResponseBytes: MAX_RESOURCE_BYTES,
            maxRedirects: MAX_RESOURCE_REDIRECTS - redirect,
          })
        : await fetch(url, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(RESOURCE_TIMEOUT_MS),
          })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || redirect === MAX_RESOURCE_REDIRECTS) {
        throw new Error('PDF resource returned an invalid redirect')
      }
      url = new URL(location, url)
      continue
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !allowedContentType(resourceType, contentType)) {
      throw new Error(`PDF resource returned HTTP ${response.status} or an invalid content type`)
    }
    return {
      status: response.status,
      contentType,
      body: await readBoundedBody(response),
    }
  }
  throw new Error('PDF resource exceeded the redirect limit')
}

async function handlePdfResourceRequest(
  request: HTTPRequest,
  state: PdfResourceState,
  storageOrigin: string,
  appOrigin: string,
): Promise<void> {
  const decision = pdfResourceDecision(
    request.url(),
    request.resourceType(),
    request.method(),
    storageOrigin,
    appOrigin,
  )
  if (decision === 'local') {
    await request.continue()
    return
  }
  if (decision === 'block') {
    recordResourceError(
      state,
      new Error(`PDF resource request was blocked: ${request.resourceType()}`),
    )
    await request.abort('blockedbyclient')
    return
  }
  state.remoteRequests += 1
  if (state.remoteRequests > MAX_REMOTE_RESOURCES) {
    recordResourceError(state, new Error('PDF exceeded the remote resource count limit'))
    await request.abort('blockedbyclient')
    return
  }
  try {
    const response = await withResourceSlot(state, () =>
      fetchPdfResource(request.url(), request.resourceType(), storageOrigin, appOrigin),
    )
    if (state.totalBytes + response.body.length > MAX_TOTAL_RESOURCE_BYTES) {
      throw new Error('PDF exceeded the aggregate remote resource size limit')
    }
    state.totalBytes += response.body.length
    await request.respond({
      status: response.status,
      contentType: response.contentType,
      headers: { 'cache-control': 'no-store' },
      body: response.body,
    })
  } catch (error) {
    recordResourceError(state, error)
    await request.abort('blockedbyclient').catch(() => undefined)
  }
}

/** PUPPETEER_EXECUTABLE_PATH wins; otherwise probe the Docker image's
 *  chromium, then the usual macOS installs (local dev). */
function resolveExecutablePath(): string {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    // The Docker image's pinned Chrome-for-Testing shell (see Dockerfile).
    '/usr/local/bin/chrome-headless-shell',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter((p): p is string => Boolean(p))
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  throw new Error('No Chromium executable found for PDF rendering — set PUPPETEER_EXECUTABLE_PATH')
}

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: resolveExecutablePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
      ],
    })
  }
  return browserPromise
}

export async function newPdfPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage()
  const state: PdfResourceState = {
    errors: [],
    remoteRequests: 0,
    totalBytes: 0,
    activeRequests: 0,
    waiters: [],
  }
  resourceStates.set(page, state)
  const storageOrigin = configuredStorageOrigin()
  const appOrigin = configuredAppOrigin()
  await page.setRequestInterception(true)
  page.on('request', (request) => {
    void handlePdfResourceRequest(request, state, storageOrigin, appOrigin).catch(
      (error: unknown) => {
        recordResourceError(state, error)
        void request.abort('blockedbyclient').catch(() => undefined)
      },
    )
  })
  return page
}

export async function setPdfContent(
  page: Page,
  html: string,
  options: { waitForFonts?: boolean } = {},
): Promise<void> {
  if (Buffer.byteLength(html) > MAX_DOCUMENT_HTML_BYTES) {
    throw new Error('PDF HTML exceeds the 16 MiB render limit')
  }
  const documentHtml = injectPdfBase(html, configuredAppOrigin())
  await page.setContent(documentHtml, { waitUntil: 'load', timeout: 30_000 })
  if (options.waitForFonts) await page.evaluateHandle('document.fonts.ready')
  const state = resourceStates.get(page)
  if (state && state.errors.length > 0) {
    throw new AggregateError(state.errors, 'One or more PDF resources could not be loaded safely')
  }
}

/** Insert the application base URL after the first real `<head>` opening tag. */
export function injectPdfBase(html: string, appOrigin: string): string {
  const base = `<base href="${escapeHtml(appOrigin)}/">`
  const lower = html.toLowerCase()
  let cursor = 0
  while (cursor < lower.length) {
    const start = lower.indexOf('<head', cursor)
    if (start === -1) break
    const boundary = lower[start + 5]
    const isHeadTag =
      boundary === '>' ||
      boundary === ' ' ||
      boundary === '\t' ||
      boundary === '\r' ||
      boundary === '\n' ||
      boundary === '\f'
    if (isHeadTag) {
      const end = lower.indexOf('>', start + 5)
      if (end !== -1) return `${html.slice(0, end + 1)}${base}${html.slice(end + 1)}`
      break
    }
    cursor = start + 5
  }
  return `${base}${html}`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
