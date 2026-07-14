import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))

function sourceFiles(directory: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'etl') continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(path))
    else if (['.ts', '.tsx'].includes(extname(entry.name)) && !entry.name.includes('.test.')) {
      out.push(path)
    }
  }
  return out
}

const files = [...sourceFiles(join(root, 'apps')), ...sourceFiles(join(root, 'packages'))]

describe('canonical person title cutover contract', () => {
  it('has no remaining people.jobTitle schema reads or writes', () => {
    const violations: string[] = []
    for (const path of files) {
      const source = readFileSync(path, 'utf8')
      const ast = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      )
      const visit = (node: ts.Node) => {
        if (
          ts.isPropertyAccessExpression(node) &&
          node.expression.getText(ast) === 'people' &&
          node.name.text === 'jobTitle'
        ) {
          const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
          violations.push(`${relative(root, path)}:${line}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    expect(violations).toEqual([])
  })

  it('derives every database-select jobTitle alias from the canonical relationship', () => {
    const violations: string[] = []
    for (const path of files) {
      const source = readFileSync(path, 'utf8')
      const ast = ts.createSourceFile(
        path,
        source,
        ts.ScriptTarget.Latest,
        true,
        path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      )
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'select' &&
          node.arguments[0] &&
          ts.isObjectLiteralExpression(node.arguments[0])
        ) {
          for (const property of node.arguments[0].properties) {
            if (!ts.isPropertyAssignment(property) || property.name.getText(ast) !== 'jobTitle') {
              continue
            }
            const initializer = property.initializer.getText(ast)
            if (
              !initializer.includes('primaryPersonTitleName(') &&
              initializer !== 'personTitles.name'
            ) {
              const line = ast.getLineAndCharacterOfPosition(property.getStart(ast)).line + 1
              violations.push(`${relative(root, path)}:${line} -> ${initializer}`)
            }
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    expect(violations).toEqual([])
  })
})
