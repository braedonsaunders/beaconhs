import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const APP_ROOT = fileURLToPath(new URL('../app', import.meta.url))
// Dynamic segments are UUID-backed unless they are deliberately classified as
// public tokens, slugs, keys, or finite text discriminators. A new segment must
// therefore make its storage contract explicit instead of silently bypassing
// this guard audit.
const TEXT_PARAM_NAMES = new Set([
  'entity',
  'key',
  'qrToken',
  'slug',
  'target',
  'templateKey',
  'token',
])
// Better Auth owns this table and deliberately uses a text primary key.
const TEXT_ID_ROUTES = new Set(['(app)/platform/users/[id]/page.tsx'])
const LOCAL_UUID_IMPLEMENTATION =
  /(?:const|export const|function|export function)\s+(?:UUID|UUID_RE|UUID_REGEX|uuidRe|uuidRegex|isUuid|isUUID)\b/
const UUID_LITERAL = /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

function dynamicRouteFiles(): string[] {
  return filesUnder(APP_ROOT).filter(
    (file) =>
      (basename(file) === 'page.tsx' || basename(file) === 'route.ts') &&
      relative(APP_ROOT, file).includes('['),
  )
}

function dynamicParamsFor(file: string): string[] {
  return [...relative(APP_ROOT, file).matchAll(/\[([^.[\]]+)\]/g)].map((match) => match[1]!)
}

function uuidParamsFor(file: string): string[] {
  if (TEXT_ID_ROUTES.has(relative(APP_ROOT, file))) return []
  return dynamicParamsFor(file).filter((param) => !TEXT_PARAM_NAMES.has(param))
}

function textParamsFor(file: string): string[] {
  if (TEXT_ID_ROUTES.has(relative(APP_ROOT, file))) return dynamicParamsFor(file)
  return dynamicParamsFor(file).filter((param) => TEXT_PARAM_NAMES.has(param))
}

function handlerChunks(source: string, isPage: boolean): string[] {
  if (isPage) {
    const start = source.indexOf('export default')
    return start === -1 ? [] : [source.slice(start)]
  }

  const starts = [
    ...source.matchAll(/export async function (?:GET|POST|PUT|PATCH|DELETE)\s*\(/g),
  ].map((match) => match.index)
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length))
}

function localParamNames(chunk: string): Map<string, string> {
  const mapping = new Map<string, string>()
  const destructuring = /const\s*{([^}]+)}\s*=\s*await\s*(?:[A-Za-z]+\.)?params\b/g
  for (const match of chunk.matchAll(destructuring)) {
    for (const member of match[1]!.split(',')) {
      const [routeName, localName] = member.split(':').map((part) => part.trim())
      if (routeName) mapping.set(routeName, localName || routeName)
    }
  }
  return mapping
}

function firstDataAccess(chunk: string): number {
  const match =
    /await\s+(?:authenticateApiKey|getCurrentUserId|getRequestContext|requireApiKeyAdmin|requireExportContext|requireModuleManage|requireRequestContext|withSuperAdmin|withTenant)\s*\(|\bctx\.db\s*\(/.exec(
      chunk,
    )
  return match?.index ?? -1
}

describe('dynamic UUID route guards', () => {
  it('does not impose UUID syntax on token-, slug-, key-, enum-, or text-id parameters', () => {
    const failures: string[] = []
    for (const file of dynamicRouteFiles()) {
      const textParams = textParamsFor(file)
      if (textParams.length === 0) continue
      const source = readFileSync(file, 'utf8')
      for (const chunk of handlerChunks(source, basename(file) === 'page.tsx')) {
        const locals = localParamNames(chunk)
        for (const routeParam of textParams) {
          const localParam = locals.get(routeParam)
          if (localParam && chunk.includes(`isUuid(${localParam})`)) {
            failures.push(`${relative(APP_ROOT, file)}: ${routeParam} is text-backed`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('uses the canonical UUID helper instead of route-local regex implementations', () => {
    const duplicateFiles = filesUnder(fileURLToPath(new URL('..', import.meta.url)))
      .filter((file) => /\.(?:ts|tsx)$/.test(file))
      .filter((file) => basename(file) !== 'list-params.ts')
      // This module validates a complete internal return URL with a stricter
      // version/variant-aware route regex; it is not a duplicate ID predicate.
      .filter((file) => !file.endsWith('/apps/_lib/return-to.ts'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return LOCAL_UUID_IMPLEMENTATION.test(source) || UUID_LITERAL.test(source)
      })
      .map((file) => relative(fileURLToPath(new URL('..', import.meta.url)), file))

    expect(duplicateFiles).toEqual([])
  })

  it('guards every UUID-backed dynamic parameter before route-level data access', () => {
    const failures: string[] = []

    for (const file of dynamicRouteFiles()) {
      const uuidParams = uuidParamsFor(file)
      if (uuidParams.length === 0) continue
      const source = readFileSync(file, 'utf8')
      const chunks = handlerChunks(source, basename(file) === 'page.tsx')
      if (chunks.length === 0) {
        failures.push(`${relative(APP_ROOT, file)}: handler not found`)
        continue
      }

      for (const chunk of chunks) {
        const locals = localParamNames(chunk)
        const dataAccess = firstDataAccess(chunk)
        for (const routeParam of uuidParams) {
          const localParam = locals.get(routeParam)
          const zodAttachmentGuard =
            routeParam === 'id' && chunk.indexOf('idSchema.safeParse(') !== -1
          const guard = localParam ? chunk.indexOf(`isUuid(${localParam})`) : -1
          const guardIndex = zodAttachmentGuard ? chunk.indexOf('idSchema.safeParse(') : guard
          if (guardIndex === -1 || (dataAccess !== -1 && guardIndex > dataAccess)) {
            failures.push(
              `${relative(APP_ROOT, file)}: ${routeParam} is not guarded before data access`,
            )
          }
        }
      }
    }

    expect(failures).toEqual([])
  })
})
