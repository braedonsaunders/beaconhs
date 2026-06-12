// Shared puppeteer browser instance. We launch lazily and keep it around for
// the lifetime of the worker process so successive renders don't pay the
// Chromium startup tax. Workers should call `closeBrowser()` on shutdown if
// they want to be polite.

import { existsSync } from 'node:fs'
import puppeteer, { type Browser } from 'puppeteer-core'

let browserPromise: Promise<Browser> | null = null

/** PUPPETEER_EXECUTABLE_PATH wins; otherwise probe the Docker image's
 *  chromium, then the usual macOS installs (local dev). */
function resolveExecutablePath(): string {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
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

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise
    await b.close()
    browserPromise = null
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
