import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('./upsert.ts', import.meta.url), 'utf8')

function functionSource(name: string, nextName: string): string {
  const start = source.indexOf(`async function ${name}`)
  const end = source.indexOf(`function ${nextName}`, start)
  assert.ok(start >= 0, `${name} must exist`)
  assert.ok(end > start, `${nextName} must follow ${name}`)
  return source.slice(start, end)
}

describe('people sync canonical title cutover', () => {
  it('reads the primary title relationship instead of the retired people column', () => {
    assert.match(source, /jobTitle: primaryPersonTitleName\(people\.id, people\.tenantId\)/)
    assert.doesNotMatch(source, /people\.jobTitle/)
  })

  it('tracks source ownership without deleting co-owned manual titles', () => {
    const body = functionSource('syncPrimaryPersonTitle', 'rememberPersonLookup')

    assert.match(body, /normalizedCatalogNameSql\(personTitles\.name\)/)
    assert.match(body, /normalizedCatalogNameSql\(sql`\$\{name\}`\)/)
    assert.match(body, /\.for\('key share'\)/)
    assert.match(body, /eq\(personTitleAssignments\.sourceConnectionId, ctx\.connectionId\)/)
    assert.match(body, /if \(owned\.isManuallyMaintained\)/)
    assert.match(body, /\.set\(\{ sourceConnectionId: null \}\)/)
    assert.match(body, /isManuallyMaintained: false/)
    assert.match(body, /\.set\(\{ titleIds: assignments\.map/)
  })

  it('checks target convergence instead of trusting rowHash alone', () => {
    assert.match(source, /decidePersonSync\(\{/)
    assert.match(source, /personScalarValuesMatch\(beforeRow, fields, metadata\)/)
    assert.match(source, /personTitleOwnershipMatches\(fields, titleState\)/)
  })

  it('uses the last persisted sync result as the manual-wins drift baseline', () => {
    const snapshot = functionSource('selectPreviousPersonSnapshot', 'personScalarValuesMatch')

    assert.match(snapshot, /eq\(syncRecordChanges\.dryRun, false\)/)
    assert.match(snapshot, /inArray\(syncRecordChanges\.action, \['created', 'updated'\]\)/)
    assert.match(source, /personMatchesPreviousSnapshot\(beforeRow, titleState, previousSnapshot\)/)
  })

  it('does not overwrite a differing manual person during natural-key adoption', () => {
    const adoption = functionSource('adoptNaturalPersonMatch', 'createPerson')

    assert.match(adoption, /selectPersonForUpdate\(tx, match\.id\)/)
    assert.match(adoption, /findCanonicalOwner\(tx, ctx, 'people', lockedMatch\.id\)/)
    assert.match(adoption, /decideNaturalPersonAdoption\(\{/)
    assert.match(adoption, /personScalarValuesMatch\(lockedMatch, fields, metadata\)/)
    assert.match(adoption, /personTitleValuesMatch\(fields, titleState\)/)
    assert.match(adoption, /action: 'conflict'/)
  })

  it('serializes title ownership changes through the parent person', () => {
    const body = functionSource('syncPrimaryPersonTitle', 'rememberPersonLookup')

    assert.match(body, /eq\(people\.tenantId, ctx\.tenantId\)/)
    assert.match(body, /eq\(people\.id, personId\)/)
    assert.match(body, /\.for\('update'\)/)
    assert.match(body, /Could not lock the person for title synchronization/)
  })

  it('normalizes source display text before resolving the unique catalogue key', () => {
    assert.match(source, /normalizeCatalogDisplayName\(jobTitle\)/)
    assert.match(source, /normalizeCatalogDisplayName\(data\.jobTitle\)/)
  })
})
