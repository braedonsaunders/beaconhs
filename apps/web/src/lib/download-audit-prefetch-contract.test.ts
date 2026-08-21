import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url))

function filesUnder(dir: string, suffix: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(path, suffix) : path.endsWith(suffix) ? [path] : []
  })
}

describe('audited file downloads reject Link prefetch', () => {
  const routes = filesUnder(join(WEB_ROOT, 'app'), 'route.ts').filter((file) => {
    const source = readFileSync(file, 'utf8')
    return source.includes('recordAudit') && /export async function GET\b/.test(source)
  })

  it('covers every GET that writes an audit row', () => {
    expect(routes.length).toBeGreaterThan(20)
  })

  it.each(routes.map((file) => [file.slice(WEB_ROOT.length), file]))(
    '%s calls isRouterPrefetch before doing work',
    (_label, file) => {
      const source = readFileSync(file, 'utf8')
      expect(source).toContain("from '@/lib/router-prefetch'")
      expect(source).toContain('isRouterPrefetch(')
      const prefetchAt = source.indexOf('isRouterPrefetch(')
      const auditAt = source.indexOf('recordAudit(')
      expect(prefetchAt).toBeGreaterThan(-1)
      expect(auditAt).toBeGreaterThan(prefetchAt)
    },
  )
})
