import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  validateOptionalPersistedText,
  validateRequiredPersistedText,
} from './persisted-text-policy'

describe('persisted text policy', () => {
  it('trims valid required text without truncating it', () => {
    expect(
      validateRequiredPersistedText('  Operations  ', { label: 'Name', maxLength: 10 }),
    ).toEqual({ ok: true, value: 'Operations' })
  })

  it('rejects missing and non-text required values explicitly', () => {
    expect(
      validateRequiredPersistedText('   ', { label: 'Dashboard name', maxLength: 60 }),
    ).toEqual({
      ok: false,
      error: 'Dashboard name is required.',
    })
    expect(validateRequiredPersistedText(42, { label: 'Dashboard name', maxLength: 60 })).toEqual({
      ok: false,
      error: 'Dashboard name is required.',
    })
  })

  it('accepts the exact boundary and rejects the next character', () => {
    expect(validateRequiredPersistedText('a'.repeat(60), { label: 'Name', maxLength: 60 })).toEqual(
      {
        ok: true,
        value: 'a'.repeat(60),
      },
    )
    expect(validateRequiredPersistedText('a'.repeat(61), { label: 'Name', maxLength: 60 })).toEqual(
      {
        ok: false,
        error: 'Name must be 60 characters or fewer.',
      },
    )
  })

  it('normalizes blank optional text to null and rejects overlong descriptions', () => {
    expect(validateOptionalPersistedText('  ', { label: 'Description', maxLength: 500 })).toEqual({
      ok: true,
      value: null,
    })
    expect(
      validateOptionalPersistedText('x'.repeat(501), { label: 'Description', maxLength: 500 }),
    ).toEqual({ ok: false, error: 'Description must be 500 characters or fewer.' })
  })

  it('rejects invalid policy configuration instead of weakening the boundary', () => {
    expect(() => validateRequiredPersistedText('Name', { label: 'Name', maxLength: 0 })).toThrow(
      /Invalid persisted-text maximum/,
    )
  })

  it('keeps persisted-name truncation out of Insights and integration mutations', () => {
    const sources = [
      '../app/(app)/insights/_actions.ts',
      '../app/(app)/insights/cards/_actions.ts',
      '../app/(app)/admin/integrations/_actions.ts',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))

    for (const source of sources) {
      expect(source).not.toMatch(/\.slice\(0,\s*(?:60|120|200|500)\)/)
      expect(source).toContain('validateRequiredPersistedText')
    }
    expect(sources[1]).toContain('validateOptionalPersistedText')
  })

  it('declares matching browser limits for every edited input', () => {
    const dashboard = readFileSync(
      new URL('../app/(app)/insights/_workspace.tsx', import.meta.url),
      'utf8',
    )
    const card = readFileSync(
      new URL('../app/(app)/insights/cards/_studio/card-studio.client.tsx', import.meta.url),
      'utf8',
    )
    const connection = readFileSync(
      new URL('../app/(app)/admin/integrations/[id]/_connection-name-form.tsx', import.meta.url),
      'utf8',
    )

    expect(dashboard).toContain('maxLength={INSIGHT_DASHBOARD_NAME_MAX_LENGTH}')
    expect(card).toContain('maxLength={INSIGHT_CARD_NAME_MAX_LENGTH}')
    expect(card).toContain('maxLength={INSIGHT_CARD_DESCRIPTION_MAX_LENGTH}')
    expect(connection).toContain('maxLength={INTEGRATION_CONNECTION_NAME_MAX_LENGTH}')
  })
})
