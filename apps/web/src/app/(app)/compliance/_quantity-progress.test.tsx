import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
  GeneratedText: () => null,
}))
import { QuantityProgress, quantityProgressPercent } from './_quantity-progress'
it('shows partial individual progress without letting one person cover someone else', () => {
  expect(
    quantityProgressPercent([
      { count: 2, expected: 5 },
      { count: 0, expected: 5 },
    ]),
  ).toBe(20)
  expect(
    quantityProgressPercent([
      { count: 10, expected: 5 },
      { count: 0, expected: 5 },
    ]),
  ).toBe(50)
  expect(quantityProgressPercent([])).toBe(0)
  const html = renderToStaticMarkup(<QuantityProgress count={4} expected={5} met />)
  expect(html).toContain('4')
  expect(html).toContain('5')
  expect(html).toContain('submitted')
  expect(html).toContain('Minimum met')
  expect(html).toContain('width:80%')
})
