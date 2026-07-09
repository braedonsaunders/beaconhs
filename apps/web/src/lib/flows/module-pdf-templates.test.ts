import { describe, expect, it } from 'vitest'
import { expandRepeatMarkers, renderTemplate } from '@beaconhs/email-render'
import { MODULE_PDF_TEMPLATE_SEEDS } from '@beaconhs/db/seed/pdf-templates'
import { MODULE_FLOW_PROFILES } from './module-profiles'

// CONTRACT TEST: every {{token}}, data-if gate, and data-each collection in the
// seeded per-module PDF documents must resolve against that module's flow
// profile — the exact keys its adapter's loadValues() returns. A template
// referencing a key the profile doesn't declare would silently print blanks.

const LOOP_META = new Set(['@index', '@number', '@first', '@last', 'this'])
const BLOCK_RE = /\{\{\{?\s*(\/?#?[\w@./-]+)(?:\s+([\w@./-]+))?\s*\}?\}\}/g

type Scope = { fields: Set<string>; collections: Map<string, Set<string>> }

function profileScope(subjectKey: string): Scope {
  const profile = MODULE_FLOW_PROFILES[subjectKey]
  if (!profile) throw new Error(`No flow profile for module '${subjectKey}'`)
  return {
    fields: new Set(profile.fields.map((f) => f.key)),
    collections: new Map(
      (profile.collections ?? []).map((c) => [c.key, new Set(c.fields.map((f) => f.key))]),
    ),
  }
}

/** Walk tokens with an #each scope stack; return the unresolvable ones. */
function unknownTokens(compiled: string, scope: Scope, extra: Set<string>): string[] {
  const bad: string[] = []
  const eachStack: string[] = []
  const validKey = (key: string): boolean => {
    if (extra.has(key) || LOOP_META.has(key)) return true
    const coll = eachStack[eachStack.length - 1]
    if (coll && scope.collections.get(coll)?.has(key)) return true
    // renderTemplate scope-chains to the outer record values.
    return scope.fields.has(key) || scope.collections.has(key)
  }
  for (const m of compiled.matchAll(BLOCK_RE)) {
    const head = m[1]!
    const arg = m[2]
    if (head === '#each') {
      if (!arg || !scope.collections.has(arg)) bad.push(`#each ${arg}`)
      eachStack.push(arg ?? '')
      continue
    }
    if (head === '/each') {
      eachStack.pop()
      continue
    }
    if (head === '#if') {
      if (!arg || !validKey(arg)) bad.push(`#if ${arg}`)
      continue
    }
    if (head === '/if' || head === 'else') continue
    if (!validKey(head)) bad.push(head)
  }
  return bad
}

/** Synthesize a full value map so a render exercises every branch. */
function sampleValues(scope: Scope): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const f of scope.fields) values[f] = `«${f}»`
  for (const [key, fields] of scope.collections) {
    const row: Record<string, unknown> = {}
    for (const f of fields) row[f] = `«${f}»`
    values[key] = [row, row]
  }
  return values
}

describe('seeded module PDF templates', () => {
  it('covers every templatable module subject', () => {
    const seeded = new Set(MODULE_PDF_TEMPLATE_SEEDS.map((t) => t.subjectKey))
    for (const key of Object.keys(MODULE_FLOW_PROFILES)) {
      expect(seeded, `missing seeded PDF template for module '${key}'`).toContain(key)
    }
  })

  for (const seed of MODULE_PDF_TEMPLATE_SEEDS) {
    describe(seed.key, () => {
      const scope = profileScope(seed.subjectKey)
      const compiled = expandRepeatMarkers(seed.html)

      it('expands all tr markers into blocks', () => {
        expect(compiled).not.toContain('data-each=')
        expect(compiled).not.toContain('data-if=')
      })

      it('references only keys the module profile declares', () => {
        expect(unknownTokens(compiled, scope, new Set())).toEqual([])
        // header/footer merge with the record values + page counters
        expect(unknownTokens(seed.header, scope, new Set(['page', 'pages']))).toEqual([])
      })

      it('renders a full sample record without leftovers', () => {
        const html = renderTemplate(compiled, sampleValues(scope), { escapeHtml: true })
        expect(html.length).toBeGreaterThan(400)
        expect(html).not.toMatch(/\{\{[#/]/)
      })
    })
  }
})
