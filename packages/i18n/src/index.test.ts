import { describe, expect, it } from 'vitest'
import {
  localeFromAcceptLanguage,
  localizeText,
  normalizeLocalePolicy,
  resolveLocale,
  resolveLocalePreferences,
} from './index'

describe('locale policy', () => {
  it('adds the default locale to the enabled set and rejects unknown locales', () => {
    expect(
      normalizeLocalePolicy({ defaultLocale: 'fr', enabledLocales: ['en', 'xx', 'en'] }),
    ).toEqual({ defaultLocale: 'fr', enabledLocales: ['en', 'fr'] })
  })

  it('uses an enabled user override', () => {
    expect(
      resolveLocale({ defaultLocale: 'en', enabledLocales: ['en', 'fr'], userLocale: 'fr' }),
    ).toBe('fr')
  })

  it('falls back to the tenant default for a disabled or invalid override', () => {
    expect(resolveLocale({ defaultLocale: 'fr', enabledLocales: ['fr'], userLocale: 'es' })).toBe(
      'fr',
    )
    expect(resolveLocale({ defaultLocale: 'wat', enabledLocales: [], userLocale: 'wat' })).toBe(
      'en',
    )
  })

  it('exposes only an enabled membership override in request preferences', () => {
    expect(
      resolveLocalePreferences({
        defaultLocale: 'fr',
        enabledLocales: ['fr'],
        userLocale: 'es',
      }),
    ).toEqual({
      locale: 'fr',
      defaultLocale: 'fr',
      enabledLocales: ['fr'],
      localeOverride: null,
    })
  })
})

describe('localeFromAcceptLanguage', () => {
  it('selects the highest-quality supported language and ignores unknown tags', () => {
    expect(localeFromAcceptLanguage('de-DE, fr-CA;q=0.8, en;q=0.6')).toBe('fr')
    expect(localeFromAcceptLanguage('es-MX;q=0.7, fr;q=0.9')).toBe('fr')
    expect(localeFromAcceptLanguage('fr;q=0, es;q=0.5')).toBe('es')
    expect(localeFromAcceptLanguage('de')).toBe('en')
  })
})

describe('localizeText', () => {
  it('uses effective locale, tenant default, English, then another supported translation', () => {
    expect(localizeText({ en: 'Inspection', fr: 'Inspection' }, 'fr', 'field')).toBe('Inspection')
    expect(localizeText({ es: 'Inspección' }, 'fr', 'field', 'es')).toBe('Inspección')
    expect(localizeText({ en: 'Inspection' }, 'es', 'field', 'fr')).toBe('Inspection')
    expect(localizeText({ fr: 'Inspection' }, 'es', 'field', 'en')).toBe('Inspection')
  })

  it('returns the explicit fallback for empty content', () => {
    expect(localizeText({ en: ' ' }, 'en', 'field')).toBe('field')
    expect(localizeText(null, 'en', 'field')).toBe('field')
  })
})
