import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { getAppMessages, systemMessageKey } from '@beaconhs/i18n/messages'
import { findRuntimeUserFacingLiterals } from '../../scripts/i18n-runtime-audit'
import { findUserFacingSourceLiterals } from '../../scripts/i18n-source-audit'
import { FRONTLINE_ARTICLES } from '../lib/manual/content/frontline'
import { GETTING_STARTED_ARTICLES } from '../lib/manual/content/getting-started'
import { KNOWLEDGE_ASSETS_ARTICLES } from '../lib/manual/content/knowledge-assets'
import { OVERSIGHT_ADMIN_ARTICLES } from '../lib/manual/content/oversight-admin'
import { WALKTHROUGHS } from '../lib/walkthroughs/registry'

const SOURCE_ROOT = resolve(import.meta.dirname, '..')
const UI_SOURCE_ROOT = resolve(SOURCE_ROOT, '../../../packages/ui/src')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry)
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')
        ? [path]
        : []
  })
}

function uiTranslationSources(): string[] {
  const sources: string[] = []
  for (const file of sourceFiles(UI_SOURCE_ROOT)) {
    const sourceFile = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 't'
      ) {
        const source = node.arguments[0]
        if (source && (ts.isStringLiteral(source) || ts.isNoSubstitutionTemplateLiteral(source))) {
          sources.push(source.text)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return sources
}

describe('i18n source coverage', () => {
  const generated = getAppMessages('en').Generated
  const runtimeCandidates = findRuntimeUserFacingLiterals()

  it('contains no untranslated JSX or user-facing attributes', () => {
    expect(findUserFacingSourceLiterals()).toEqual([])
    expect(findUserFacingSourceLiterals({ roots: [UI_SOURCE_ROOT], base: UI_SOURCE_ROOT })).toEqual(
      [],
    )
  }, 20_000)

  it('catalogs every programmatic label, prompt, message, and error', () => {
    const missing = runtimeCandidates.filter(
      (candidate) => !(systemMessageKey(candidate.source) in generated),
    )
    expect(missing).toEqual([])
  }, 20_000)

  it('contains every generated key referenced by application source', () => {
    const missing: Array<{ file: string; key: string }> = []
    for (const file of sourceFiles(SOURCE_ROOT)) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/["'](m_[a-f0-9]{14})["']/g)) {
        const key = match[1]!
        if (!(key in generated)) missing.push({ file, key })
      }
    }
    expect(missing).toEqual([])
  })

  it('uses request-aware metadata instead of static English metadata', () => {
    const offenders = sourceFiles(resolve(SOURCE_ROOT, 'app')).filter((file) =>
      /export const metadata\b/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
    expect(
      runtimeCandidates.filter((candidate) => candidate.container === 'generateMetadata'),
    ).toEqual([])
  })

  it('catalogs built-in user-guide articles and guided-tour steps', () => {
    const articles = [
      ...GETTING_STARTED_ARTICLES,
      ...FRONTLINE_ARTICLES,
      ...KNOWLEDGE_ASSETS_ARTICLES,
      ...OVERSIGHT_ADMIN_ARTICLES,
    ]
    const longFormCopy = [
      ...articles.map((article) => article.body),
      ...WALKTHROUGHS.flatMap((walkthrough) => walkthrough.steps.map((step) => step.body)),
    ]
    expect(longFormCopy.filter((copy) => !(systemMessageKey(copy) in generated))).toEqual([])
  })

  it('catalogs every framework-agnostic UI primitive string', () => {
    expect(uiTranslationSources().filter((copy) => !(systemMessageKey(copy) in generated))).toEqual(
      [],
    )
  })
})
