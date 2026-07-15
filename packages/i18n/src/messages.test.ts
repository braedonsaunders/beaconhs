import { describe, expect, it } from 'vitest'
import en from './messages/en.json'
import es from './messages/es.json'
import fr from './messages/fr.json'
import { createSystemTranslator, systemMessageKey, translateSystemCopy } from './messages'

function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  )
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{value\d+\}/g)].map(([token]) => token).sort()
}

describe('application message catalogs', () => {
  it('keeps every locale structurally complete', () => {
    const english = leafPaths(en).sort()
    expect(leafPaths(fr).sort()).toEqual(english)
    expect(leafPaths(es).sort()).toEqual(english)
  })

  it('preserves generated-message placeholders in every locale', () => {
    for (const [key, english] of Object.entries(en.Generated)) {
      expect(placeholders(fr.Generated[key as keyof typeof fr.Generated])).toEqual(
        placeholders(english),
      )
      expect(placeholders(es.Generated[key as keyof typeof es.Generated])).toEqual(
        placeholders(english),
      )
    }
  })

  it('contains no translation-pipeline token artifacts', () => {
    for (const catalog of [fr.Generated, es.Generated]) {
      expect(Object.values(catalog).filter((value) => /XQPHTOKEN|PHQXZ|ZX PH/.test(value))).toEqual(
        [],
      )
    }
  })

  it('preserves the BeaconHS brand name in every locale', () => {
    for (const catalog of [en, fr, es]) {
      expect(catalog.Generated.m_1721f79d9a7f66).toBe('BeaconHS')
    }
  })

  it('translates known system copy and leaves tenant-authored copy intact', () => {
    expect(translateSystemCopy('fr', 'No data.')).not.toBe('No data.')
    expect(createSystemTranslator('es')('No data.')).not.toBe('No data.')
    expect(translateSystemCopy('fr', 'North Yard')).toBe('North Yard')
    expect(systemMessageKey('No data.')).toMatch(/^m_[a-f0-9]{14}$/)
  })
})
