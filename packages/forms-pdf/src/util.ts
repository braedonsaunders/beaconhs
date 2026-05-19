// Shared puppeteer browser instance. We launch lazily and keep it around for
// the lifetime of the worker process so successive renders don't pay the
// Chromium startup tax. Workers should call `closeBrowser()` on shutdown if
// they want to be polite.

import puppeteer, { type Browser } from 'puppeteer-core'

let browserPromise: Promise<Browser> | null = null

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium',
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
