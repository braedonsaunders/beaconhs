import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'
import {
  displayLiteralSource,
  displayLiterals,
  hasWords,
  topLevelFunction,
  type DisplayLiteral,
} from './i18n-source-audit'

const WEB_ROOT = resolve(process.env.I18N_AUDIT_WEB_ROOT ?? resolve(import.meta.dirname, '..'))
const SOURCE_ROOT = resolve(WEB_ROOT, 'src')

export const USER_FACING_PROPERTIES = new Set([
  'actionLabel',
  'bodyText',
  'buttonLabel',
  'cancelLabel',
  'cancelText',
  'caption',
  'confirmLabel',
  'confirmText',
  'description',
  'dialogDescription',
  'dialogTitle',
  'emptyLabel',
  'emptyText',
  'error',
  'errorMessage',
  'heading',
  'header',
  'helperText',
  'hint',
  'label',
  'loadingLabel',
  'message',
  'noResultsText',
  'placeholder',
  'prompt',
  'searchPlaceholder',
  'srLabel',
  'subject',
  'submitLabel',
  'summary',
  'subtitle',
  'success',
  'successMessage',
  'text',
  'title',
  'tooltip',
  'warning',
])

const USER_FACING_CALLS = new Set([
  'alert',
  'confirm',
  'setError',
  'setMessage',
  'toast.error',
  'toast.info',
  'toast.success',
  'toast.warning',
  'window.alert',
  'window.confirm',
])

export interface RuntimeI18nCandidate {
  container?: string
  containerAsync?: boolean
  file: string
  kind: 'call' | 'property'
  line: number
  propertyOrCall: string
  source: string
}

function sourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) files.push(...sourceFiles(path))
    else if (
      /\.(?:ts|tsx)$/.test(entry) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx') &&
      !path.includes('/scripts/')
    ) {
      files.push(path)
    }
  }
  return files
}

function functionName(node: ts.FunctionLikeDeclaration): string {
  if ('name' in node && node.name) return node.name.getText()
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parent = node.parent
    if (ts.isVariableDeclaration(parent)) return parent.name.getText()
    if (ts.isPropertyAssignment(parent)) return parent.name.getText()
  }
  return 'default'
}

function humanSource(literal: DisplayLiteral, sourceFile: ts.SourceFile): string | null {
  const source = displayLiteralSource(literal, sourceFile)
  if (!hasWords(source)) return null
  if (
    !/[\s,.!?…:;()]/.test(source) &&
    source[0] === source[0]?.toLowerCase() &&
    !['yes', 'no', 'none'].includes(source)
  ) {
    return null
  }
  return source
}

function callName(expression: ts.LeftHandSideExpression, sourceFile: ts.SourceFile): string {
  return expression.getText(sourceFile)
}

function inspectFile(path: string): RuntimeI18nCandidate[] {
  const contents = readFileSync(path, 'utf8')
  const sourceFile = ts.createSourceFile(
    path,
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const file = relative(WEB_ROOT, path)
  const candidates: RuntimeI18nCandidate[] = []

  function add(
    node: ts.Node,
    literal: DisplayLiteral,
    kind: RuntimeI18nCandidate['kind'],
    propertyOrCall: string,
  ) {
    const source = humanSource(literal, sourceFile)
    if (!source) return
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const container = topLevelFunction(node)
    candidates.push({
      ...(container
        ? {
            container: functionName(container),
            containerAsync: container.modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
            ),
          }
        : {}),
      file,
      kind,
      line: line + 1,
      propertyOrCall,
      source,
    })
  }

  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sourceFile).replace(/^['"]|['"]$/g, '')
      if (USER_FACING_PROPERTIES.has(name)) {
        for (const literal of displayLiterals(node.initializer))
          add(node, literal, 'property', name)
      }
    }

    if (ts.isCallExpression(node)) {
      const name = callName(node.expression, sourceFile)
      if (USER_FACING_CALLS.has(name)) {
        for (const argument of node.arguments) {
          for (const literal of displayLiterals(argument)) add(node, literal, 'call', name)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return candidates
}

export function findRuntimeUserFacingLiterals(): RuntimeI18nCandidate[] {
  return sourceFiles(SOURCE_ROOT).flatMap(inspectFile)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const candidates = findRuntimeUserFacingLiterals()
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(candidates, null, 2)}\n`)
  } else {
    const counts = new Map<string, number>()
    for (const candidate of candidates) {
      const key = `${candidate.kind}:${candidate.propertyOrCall}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const [kind, count] of [...counts].sort((left, right) => right[1] - left[1])) {
      console.log(`${kind}: ${count}`)
    }
    console.log(`files: ${new Set(candidates.map((candidate) => candidate.file)).size}`)
    console.log(`unique strings: ${new Set(candidates.map((candidate) => candidate.source)).size}`)
  }
}
