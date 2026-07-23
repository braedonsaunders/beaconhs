import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { contentSecurityPolicy, staticSecurityHeaders } from './security-headers'

const NONCE = '0123456789abcdef0123456789abcdef'

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

describe('contentSecurityPolicy', () => {
  it('nonce-binds scripts and allows only reviewed frame/form origins', () => {
    const policy = contentSecurityPolicy({
      nonce: NONCE,
      isDevelopment: false,
      collaboraUrl: 'https://office.example.com/browser',
      storageEndpoint: 'https://objects.example.com/account',
      sentryDsn: 'https://public@example.ingest.sentry.io/123',
    })

    expect(policy).toContain(`script-src 'self' 'nonce-${NONCE}' 'strict-dynamic';`)
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).toContain("form-action 'self' https://office.example.com;")
    expect(policy).toContain(
      "frame-src 'self' https://office.example.com https://objects.example.com",
    )
    expect(policy).toContain('blob: https:')
    expect(policy).toContain(
      "connect-src 'self' https://objects.example.com https://example.ingest.sentry.io",
    )
    expect(policy).not.toContain('wss:')
    expect(policy).toContain("object-src 'none';")
    expect(policy).toContain('upgrade-insecure-requests;')
  })

  it('permits only loopback HTTP in development and ignores malformed origins', () => {
    const policy = contentSecurityPolicy({
      nonce: NONCE,
      isDevelopment: true,
      collaboraUrl: 'http://localhost:9980/path',
      storageEndpoint: 'http://10.0.0.10:9000',
      sentryDsn: 'not a URL',
    })

    expect(policy).toContain('http://localhost:9980')
    expect(policy).not.toContain('10.0.0.10')
    expect(policy).toContain("'unsafe-eval'")
    expect(policy).toContain('wss:')
    expect(policy).not.toContain("'strict-dynamic'")
    expect(policy).not.toContain('upgrade-insecure-requests')
  })

  it('rejects weak or header-unsafe nonces', () => {
    expect(() => contentSecurityPolicy({ nonce: 'short', isDevelopment: false })).toThrow()
    expect(() =>
      contentSecurityPolicy({ nonce: `${NONCE};script-src *`, isDevelopment: false }),
    ).toThrow()
  })

  it('does not leave custom inline app scripts without a request nonce', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(resolve(process.cwd(), 'src/app'))) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/<script\b[^>]*dangerouslySetInnerHTML/g)) {
        if (!match[0].includes('nonce=')) offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })

  it('does not load mutable latest-tag browser dependencies', () => {
    const appRoot = resolve(process.cwd(), 'src/app')
    const offenders = sourceFiles(appRoot).filter((file) =>
      /cdn\.jsdelivr\.net\/npm\/[^'"`\s]+@latest(?:\/|\+|$)/.test(readFileSync(file, 'utf8')),
    )

    expect(offenders).toEqual([])
  })
})

describe('staticSecurityHeaders', () => {
  it('adds HSTS only to production responses', () => {
    expect(staticSecurityHeaders(true)).toContainEqual({
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    })
    expect(
      staticSecurityHeaders(false).some((header) => header.key === 'Strict-Transport-Security'),
    ).toBe(false)
  })
})
