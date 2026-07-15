import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRODUCT_NAME } from '../lib/brand'

const logoSource = readFileSync(new URL('./brand-logo.tsx', import.meta.url), 'utf8')
const generatedSource = readFileSync(new URL('../i18n/generated.tsx', import.meta.url), 'utf8')

describe('root brand provider contract', () => {
  it('keeps the brand splash independent from the application i18n provider', () => {
    expect(PRODUCT_NAME).toBe('BeaconHS')
    expect(logoSource).not.toContain('useGeneratedTranslations')
    expect(logoSource.match(/aria-label=\{PRODUCT_NAME\}/g)).toHaveLength(2)
  })

  it('does not initialize translation hooks for structural React nodes', () => {
    const valueComponent = generatedSource.indexOf('export function GeneratedValue')
    const structuralGuard = generatedSource.indexOf(
      "if (typeof value !== 'string')",
      valueComponent,
    )
    const translatedComponent = generatedSource.indexOf(
      'function TranslatedGeneratedValue',
      valueComponent,
    )

    expect(valueComponent).toBeGreaterThanOrEqual(0)
    expect(structuralGuard).toBeGreaterThan(valueComponent)
    expect(translatedComponent).toBeGreaterThan(structuralGuard)
  })
})
