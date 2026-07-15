import { readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import ts from 'typescript'

const WEB_ROOT = resolve(process.env.I18N_AUDIT_WEB_ROOT ?? resolve(import.meta.dirname, '..'))
const SOURCE_ROOTS = [resolve(WEB_ROOT, 'src/app'), resolve(WEB_ROOT, 'src/components')]

const USER_FACING_ATTRIBUTES = new Set([
  'actionLabel',
  'alt',
  'aria-label',
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
  'errorMessage',
  'heading',
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
  'submitLabel',
  'subtitle',
  'successMessage',
  'title',
  'tooltip',
])

const NON_PROSE_ELEMENTS = new Set(['code', 'kbd', 'pre', 'samp', 'script', 'style'])

type I18nCandidateKind = 'attribute' | 'expression' | 'jsx-text' | 'mixed-jsx' | 'template'

interface I18nCandidate {
  container?: string
  containerAsync?: boolean
  file: string
  kind: I18nCandidateKind
  line: number
  source: string
}

export function topLevelFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let current: ts.Node | undefined = node
  let result: ts.FunctionLikeDeclaration | null = null
  while (current && !ts.isSourceFile(current)) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      result = current
    }
    current = current.parent
  }
  return result
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

function sourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) files.push(...sourceFiles(path))
    else if (
      /\.(?:ts|tsx)$/.test(entry) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      files.push(path)
    }
  }
  return files
}

export function hasWords(value: string): boolean {
  const normalized = normalizeProse(value)
  return Boolean(normalized) && /[A-Za-zÀ-ÿ]/.test(normalized) && !/^https?:\/\//.test(normalized)
}

export function normalizeProse(value: string): string {
  return (
    value
      .replaceAll('&apos;', "'")
      .replaceAll('&#39;', "'")
      .replaceAll('&quot;', '"')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&nbsp;', ' ')
      .replaceAll('&rsquo;', '’')
      .replaceAll('&lsquo;', '‘')
      .replaceAll('&ldquo;', '“')
      .replaceAll('&rdquo;', '”')
      .replaceAll('&hellip;', '…')
      .replaceAll('&mdash;', '—')
      .replaceAll('&ndash;', '–')
      // Decode ampersands last so double-encoded text is not decoded twice.
      .replaceAll('&amp;', '&')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function elementName(node: ts.JsxElement | ts.JsxSelfClosingElement): string {
  const name = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
  return name.getText()
}

function containingElement(node: ts.Node): ts.JsxElement | ts.JsxSelfClosingElement | null {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) return current
    current = current.parent
  }
  return null
}

function elementAttributes(element: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxAttributes {
  return ts.isJsxElement(element) ? element.openingElement.attributes : element.attributes
}

function isAriaHidden(node: ts.Node, sourceFile: ts.SourceFile): boolean {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current)) {
      const hidden = elementAttributes(current).properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === 'aria-hidden' &&
          (!attribute.initializer ||
            (ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === 'true') ||
            (ts.isJsxExpression(attribute.initializer) &&
              attribute.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword)),
      )
      if (hidden) return true
    }
    current = current.parent
  }
  return false
}

export type DisplayLiteral =
  ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression

export function displayLiterals(expression: ts.Expression): DisplayLiteral[] {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return hasWords(expression.text) ? [expression] : []
  }
  if (ts.isTemplateExpression(expression)) {
    const text = `${expression.head.text}${expression.templateSpans
      .map((span) => span.literal.text)
      .join('')}`
    return hasWords(text) ? [expression] : []
  }
  if (ts.isParenthesizedExpression(expression)) return displayLiterals(expression.expression)
  if (ts.isConditionalExpression(expression)) {
    return [...displayLiterals(expression.whenTrue), ...displayLiterals(expression.whenFalse)]
  }
  if (
    ts.isBinaryExpression(expression) &&
    [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(
      expression.operatorToken.kind,
    )
  ) {
    return [...displayLiterals(expression.left), ...displayLiterals(expression.right)]
  }
  return []
}

export function displayLiteralSource(literal: DisplayLiteral, sourceFile: ts.SourceFile): string {
  if (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal)) {
    return normalizeProse(literal.text)
  }
  let value = literal.head.text
  for (const [index, span] of literal.templateSpans.entries()) {
    value += `{value${index}}${span.literal.text}`
  }
  return normalizeProse(value || literal.getText(sourceFile))
}

function isMixedJsxText(node: ts.JsxText): boolean {
  const parent = node.parent
  if (!ts.isJsxElement(parent)) return false
  const meaningful = parent.children.filter((child) => {
    if (ts.isJsxText(child)) return hasWords(child.text)
    if (ts.isJsxExpression(child)) return child.expression !== undefined
    return true
  })
  return meaningful.length > 1
}

function inOptionElement(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isJsxElement(current) && elementName(current) === 'option') return true
    current = current.parent
  }
  return false
}

interface FileAudit {
  candidates: I18nCandidate[]
  optionLabels: I18nCandidate[]
}

function inspectFile(path: string, base: string): FileAudit {
  const contents = readFileSync(path, 'utf8')
  const sourceFile = ts.createSourceFile(
    path,
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const file = relative(base, path)
  const candidates: I18nCandidate[] = []
  const optionLabels: I18nCandidate[] = []

  function add(
    node: ts.Node,
    kind: I18nCandidateKind,
    source: string,
    sink: I18nCandidate[] = candidates,
  ) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    const container = topLevelFunction(node)
    sink.push({
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
      source: normalizeProse(source),
    })
  }

  function visit(node: ts.Node) {
    if (isAriaHidden(node, sourceFile)) return

    if (ts.isJsxText(node) && hasWords(node.text)) {
      const element = containingElement(node)
      if (element && NON_PROSE_ELEMENTS.has(elementName(element))) return
      // <option> labels are translated at render time by the Select/SearchSelect
      // primitives (exact-copy lookup), so plain source copy is required here —
      // wrapper elements would hide the options from Select's children parser.
      // They still must exist in the catalog; the coverage test enforces that.
      if (inOptionElement(node)) {
        add(node, 'jsx-text', node.text, optionLabels)
        return
      }
      add(node, isMixedJsxText(node) ? 'mixed-jsx' : 'jsx-text', node.text)
      return
    }

    if (ts.isJsxAttribute(node) && USER_FACING_ATTRIBUTES.has(node.name.getText(sourceFile))) {
      const element = containingElement(node)
      if (element && NON_PROSE_ELEMENTS.has(elementName(element))) return
      if (
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        hasWords(node.initializer.text)
      ) {
        add(node.initializer, 'attribute', node.initializer.text)
        return
      }
      if (node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        for (const literal of displayLiterals(node.initializer.expression)) {
          add(
            literal,
            ts.isTemplateExpression(literal) ? 'template' : 'expression',
            displayLiteralSource(literal, sourceFile),
          )
        }
        return
      }
    }

    if (ts.isJsxExpression(node) && node.expression && ts.isJsxElement(node.parent)) {
      const element = containingElement(node)
      if (element && NON_PROSE_ELEMENTS.has(elementName(element))) return
      const sink = inOptionElement(node) ? optionLabels : candidates
      for (const literal of displayLiterals(node.expression)) {
        add(
          literal,
          ts.isTemplateExpression(literal) ? 'template' : 'expression',
          displayLiteralSource(literal, sourceFile),
          sink,
        )
      }
      ts.forEachChild(node, visit)
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return { candidates, optionLabels }
}

type AuditOptions = {
  roots?: readonly string[]
  base?: string
}

export function findSourceAudit({ roots = SOURCE_ROOTS, base = WEB_ROOT }: AuditOptions = {}): {
  violations: I18nCandidate[]
  optionLabels: I18nCandidate[]
} {
  const audits = roots.flatMap((root) => sourceFiles(root)).map((path) => inspectFile(path, base))
  return {
    violations: audits.flatMap((audit) => audit.candidates),
    optionLabels: audits.flatMap((audit) => audit.optionLabels),
  }
}

export function findUserFacingSourceLiterals(options: AuditOptions = {}): I18nCandidate[] {
  return findSourceAudit(options).violations
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const candidates = findUserFacingSourceLiterals()
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(candidates, null, 2)}\n`)
  } else {
    const counts = new Map<I18nCandidateKind, number>()
    for (const candidate of candidates) {
      counts.set(candidate.kind, (counts.get(candidate.kind) ?? 0) + 1)
    }
    for (const kind of ['jsx-text', 'attribute', 'expression', 'mixed-jsx', 'template'] as const) {
      console.log(`${kind}: ${counts.get(kind) ?? 0}`)
    }
    console.log(`files: ${new Set(candidates.map((candidate) => candidate.file)).size}`)
    console.log(`unique strings: ${new Set(candidates.map((candidate) => candidate.source)).size}`)
  }
}
