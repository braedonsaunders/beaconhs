import { describe, expect, it } from 'vitest'
import { injectPdfBase, pdfResourceDecision } from './util'

describe('PDF document base injection', () => {
  it('inserts after a real head tag and falls back to a safe prefix', () => {
    expect(
      injectPdfBase('<html><head data-x="1"><title>X</title></head></html>', 'https://app.test'),
    ).toBe('<html><head data-x="1"><base href="https://app.test/"><title>X</title></head></html>')
    expect(injectPdfBase('<html><header>Not head</header></html>', 'https://app.test')).toBe(
      '<base href="https://app.test/"><html><header>Not head</header></html>',
    )
    expect(
      injectPdfBase(`<${'headless'.repeat(20_000)}>`, 'https://app.test').startsWith(
        '<base href="https://app.test/">',
      ),
    ).toBe(true)
  })
})

describe('PDF resource policy', () => {
  const storageOrigin = 'http://minio.internal:9000'
  const appOrigin = 'http://web.internal:3000'

  it.each(['data:image/png;base64,AA==', 'blob:null/8f9f', 'about:blank'])(
    'allows page-local image resources: %s',
    (url) => {
      expect(pdfResourceDecision(url, 'image', 'GET', storageOrigin, appOrigin)).toBe('local')
    },
  )

  it('allows only signed GET requests to the configured private storage origin', () => {
    expect(
      pdfResourceDecision(
        `${storageOrigin}/bucket/photo.png?X-Amz-Signature=abc`,
        'image',
        'GET',
        storageOrigin,
        appOrigin,
      ),
    ).toBe('storage')
    expect(
      pdfResourceDecision(
        `${storageOrigin}/bucket/photo.png`,
        'image',
        'GET',
        storageOrigin,
        appOrigin,
      ),
    ).toBe('block')
    expect(
      pdfResourceDecision(
        `${storageOrigin}/bucket/photo.png?X-Amz-Signature=`,
        'image',
        'GET',
        storageOrigin,
        appOrigin,
      ),
    ).toBe('block')
  })

  it('allows resources only from the exact configured app origin', () => {
    expect(
      pdfResourceDecision(`${appOrigin}/brand/logo.png`, 'image', 'GET', storageOrigin, appOrigin),
    ).toBe('app')
    expect(
      pdfResourceDecision(
        'http://web.internal.evil.example/brand/logo.png',
        'image',
        'GET',
        storageOrigin,
        appOrigin,
      ),
    ).toBe('block')
  })

  it('proxies HTTPS image/font/style resources through pinned public egress', () => {
    expect(
      pdfResourceDecision(
        'https://cdn.example.org/photo.png',
        'image',
        'GET',
        storageOrigin,
        appOrigin,
      ),
    ).toBe('proxy')
    expect(
      pdfResourceDecision(
        'https://cdn.example.org/font.woff2',
        'font',
        'GET',
        storageOrigin,
        appOrigin,
      ),
    ).toBe('proxy')
    expect(
      pdfResourceDecision(
        'https://cdn.example.org/layout.css',
        'stylesheet',
        'GET',
        storageOrigin,
        appOrigin,
      ),
    ).toBe('proxy')
  })

  it.each([
    ['http://169.254.169.254/latest/meta-data', 'image', 'GET'],
    ['https://cdn.example.org/code.js', 'script', 'GET'],
    ['data:text/javascript,alert(1)', 'script', 'GET'],
    ['https://cdn.example.org/photo.png', 'image', 'POST'],
  ])('blocks unsupported request %s (%s %s)', (url, type, method) => {
    expect(pdfResourceDecision(url, type, method, storageOrigin, appOrigin)).toBe('block')
  })

  it('blocks credential-bearing URLs even when the origin otherwise matches', () => {
    expect(
      pdfResourceDecision(
        'http://user:password@web.internal:3000/logo.png',
        'image',
        'GET',
        storageOrigin,
        appOrigin,
      ),
    ).toBe('block')
  })
})
