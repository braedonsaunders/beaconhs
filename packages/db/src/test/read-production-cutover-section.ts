import { readFileSync } from 'node:fs'

const productionCutover = readFileSync(
  new URL('../../drizzle/0005_production_cutover.sql', import.meta.url),
  'utf8',
)
const sourceName = /^\d{4}_[a-z0-9_]+\.sql$/

export function readProductionCutoverSection(sourceFile: string): string {
  if (!sourceName.test(sourceFile)) {
    throw new Error(`Invalid squashed migration source name: ${sourceFile}`)
  }

  const marker = `-- Squashed source: packages/db/drizzle/${sourceFile}`
  const start = productionCutover.indexOf(marker)
  if (start < 0) throw new Error(`Squashed migration section not found: ${sourceFile}`)

  const next = productionCutover.indexOf('\n-- Squashed source:', start + marker.length)
  return productionCutover.slice(start, next < 0 ? undefined : next)
}
